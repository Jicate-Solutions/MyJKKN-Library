/**
 * The reports that cannot be plain SQL, because who a person is lives in
 * MyJKKN, not in this database. Server only.
 *
 * Programme and role are MyJKKN's answer, read from the college roll already
 * held in memory for the desk and the members page. Where a report needs both
 * a count from the database and a programme from the roll, the count is read
 * through the same scoped SQL function as every other report, and the two are
 * put together here.
 */

import { collegeDirectory, type DirectoryPerson } from '@/lib/library/myjkkn-directory'
import { getSupabaseServer } from '@/lib/supabase-server'
import { runScopedSql } from './run-sql'
import { checkParams, type Params } from './definitions'
import { reportById } from './catalog'

export type Row = Record<string, unknown>

type CodeReport = (institutionId: string, params: Params) => Promise<Row[]>

const categoryWord = (person: DirectoryPerson) => person.person_kind === 'learner' ? 'Learner' : 'Staff'

/** What the library knows about each person, keyed by MyJKKN id. */
async function libraryFacts(institutionId: string) {
	const rows = await runScopedSql<{ myjkkn_id: string; out_now: number; owing: number; loans_ever: number }>(
		institutionId,
		`select b.myjkkn_id,
		        (select count(*) from lib_lending_transactions t where t.member_id = b.id and t.transaction_status in ('active', 'overdue')) as out_now,
		        (select count(*) from lib_lending_transactions t where t.member_id = b.id) as loans_ever,
		        coalesce((select sum(lc.net_payable) from lib_late_charges lc where lc.member_id = b.id and lc.payment_status in ('unpaid', 'partial')), 0) as owing
		   from lib_borrowers b`
	)
	return new Map(rows.map(r => [r.myjkkn_id, r]))
}

const CODE: Record<string, CodeReport> = {

	'mem-roll': async (institutionId, p) => {
		const [people, facts] = await Promise.all([collegeDirectory(institutionId), libraryFacts(institutionId)])
		return people
			.filter(person => p.category === 'all' || person.person_kind === p.category)
			.map(person => {
				const fact = facts.get(person.myjkkn_id)
				return {
					'Member #': person.member_number,
					'Name': person.display_name,
					'Category': categoryWord(person),
					'Programme / Role': person.role_label,
					'Email': person.email ?? '',
					'Phone': person.phone ?? '',
					'Has borrowed': fact ? 'Yes' : '',
					'Out now': fact?.out_now ?? 0,
					'Owing (₹)': Number(fact?.owing ?? 0),
				}
			})
	},

	'mem-nocard': async institutionId => {
		const people = await collegeDirectory(institutionId)
		return people
			.filter(person => !person.member_number)
			.map(person => ({
				'Name': person.display_name,
				'Category': categoryWord(person),
				'Programme / Role': person.role_label,
				'Email': person.email ?? '',
				'MyJKKN id': person.myjkkn_id,
			}))
	},

	'mem-duplicate': async institutionId => {
		const people = await collegeDirectory(institutionId)
		const byNumber = new Map<string, DirectoryPerson[]>()
		for (const person of people) {
			const key = person.member_number.trim().toLowerCase()
			if (!key) continue
			byNumber.set(key, [...(byNumber.get(key) ?? []), person])
		}
		const rows: Row[] = []
		for (const [, group] of byNumber) {
			if (group.length < 2) continue
			for (const person of group) {
				rows.push({
					'Member #': person.member_number,
					'Shared by': group.length,
					'Name': person.display_name,
					'Category': categoryWord(person),
					'Programme / Role': person.role_label,
					'Email': person.email ?? '',
					'MyJKKN id': person.myjkkn_id,
				})
			}
		}
		return rows.sort((a, b) => String(a['Member #']).localeCompare(String(b['Member #'])))
	},

	'circ-by-programme': async (institutionId, p) => {
		const [people, loans] = await Promise.all([
			collegeDirectory(institutionId),
			runScopedSql<{ myjkkn_id: string; member_category: string; loans: number; members: number; overdue_now: number }>(
				institutionId,
				`select b.myjkkn_id, b.member_category, count(*) as loans,
				        count(*) filter (where t.transaction_status in ('active', 'overdue') and t.due_date < current_date) as overdue_now
				   from lib_lending_transactions t
				   join lib_borrowers b on b.id = t.member_id
				  where (t.issued_at at time zone 'Asia/Kolkata')::date between '${p.from}'::date and '${p.to}'::date
				  group by b.myjkkn_id, b.member_category`
			),
		])
		return groupByProgramme(people, loans, 'Loans')
	},

	'gate-by-programme': async (institutionId, p) => {
		const [people, visits] = await Promise.all([
			collegeDirectory(institutionId),
			runScopedSql<{ myjkkn_id: string; member_category: string; loans: number }>(
				institutionId,
				`select coalesce(v.myjkkn_id, v.member_number) as myjkkn_id, v.member_category, count(*) as loans
				   from lib_member_visits v
				  where v.visit_date between '${p.from}'::date and '${p.to}'::date
				  group by 1, 2`
			),
		])
		return groupByProgramme(people, visits, 'Visits')
	},

	'od-by-programme': async institutionId => {
		const [people, overdue] = await Promise.all([
			collegeDirectory(institutionId),
			runScopedSql<{ myjkkn_id: string; member_category: string; loans: number }>(
				institutionId,
				`select b.myjkkn_id, b.member_category, count(*) as loans
				   from lib_lending_transactions t
				   join lib_borrowers b on b.id = t.member_id
				  where t.transaction_status in ('active', 'overdue') and t.due_date < current_date
				  group by b.myjkkn_id, b.member_category`
			),
		])
		return groupByProgramme(people, overdue, 'Overdue books')
	},
}

/**
 * Counts per person become counts per programme or role.
 *
 * A person the roll no longer has — left the college, or a legacy borrower —
 * is counted under their category with "(not in MyJKKN now)" so the totals
 * still add up to what the database holds.
 */
function groupByProgramme(
	people: DirectoryPerson[],
	counts: { myjkkn_id: string; member_category: string; loans: number }[],
	countLabel: string
): Row[] {
	const roles = new Map<string, DirectoryPerson>()
	const byNumber = new Map<string, DirectoryPerson>()
	for (const person of people) {
		roles.set(person.myjkkn_id, person)
		if (person.member_number) byNumber.set(person.member_number.trim().toLowerCase(), person)
	}

	const groups = new Map<string, { category: string; label: string; count: number; people: number }>()
	for (const row of counts) {
		const person = roles.get(row.myjkkn_id) ?? byNumber.get(String(row.myjkkn_id ?? '').trim().toLowerCase())
		const category = person ? (person.person_kind === 'learner' ? 'Learner' : 'Staff') : row.member_category === 'facilitator' ? 'Staff' : 'Learner'
		const label = person?.role_label ?? '(not in MyJKKN now)'
		const key = `${category}|${label}`
		const group = groups.get(key) ?? { category, label, count: 0, people: 0 }
		group.count += Number(row.loans)
		group.people += 1
		groups.set(key, group)
	}

	return [...groups.values()]
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
		.map(group => ({
			'Category': group.category,
			'Programme / Role': group.label,
			[countLabel]: group.count,
			'People': group.people,
			[`${countLabel} per person`]: Math.round((group.count / Math.max(group.people, 1)) * 10) / 10,
		}))
}

export const hasCodeReport = (id: string): boolean => id in CODE

export async function runCodeReport(id: string, institutionId: string, raw: Record<string, string | undefined>): Promise<Row[]> {
	const report = reportById(id)
	if (!report) throw new Error('No such report')
	const run = CODE[id]
	if (!run) throw new Error('This report is not a code report')
	const params = checkParams(report, raw)
	// Touch the client once so a misconfigured server fails here, not deep inside
	getSupabaseServer()
	return run(institutionId, params)
}
