/**
 * What a report's dropdowns may offer: GET /api/lib/reports/options
 *
 *   ?institution_id=…&lists=book_type,department
 *
 * The Book Type, Department, Fiscal year and Order number filters used to be
 * typed boxes matching on "any part of it", which asked the librarian to know
 * the spelling and punished them for a stray space. They are dropdowns now, and
 * these are the choices: read from this college's own rows, so the list is
 * always exactly what is there and never a guess written into the code.
 *
 * Everything goes through the same scoped, read-only function the reports
 * themselves use, so one college can never be offered another's departments.
 * The SQL below is fixed text — nothing from the request reaches it except
 * which of these named lists to run.
 */

import { NextResponse } from 'next/server'
import { guardCollection } from '@/lib/auth/api-guard'
import { runScopedSql, ReportSqlError } from '@/lib/library/reports/run-sql'
import type { LookupList } from '@/lib/library/reports/catalog'

/**
 * Long enough that no real library is cut off.
 *
 * A dropdown is a list somebody reads, so it cannot be unbounded — but seven
 * colleges between them hold a few dozen book types and departments, and the
 * longest of these, the order numbers, runs to tens.
 */
const MAX_CHOICES = 1000

/** One fixed query per list. A value is only ever offered, never accepted from here. */
const LISTS: Record<LookupList, string> = {
	// What the title was catalogued as.
	book_type: `
		select distinct book_type as v
		  from lib_catalogue_records
		 where book_type is not null and btrim(book_type) <> ''
		 order by 1
		 limit ${MAX_CHOICES}`,

	// The department a title was bought for, as the catalogue records it.
	department: `
		select distinct department as v
		  from lib_catalogue_records
		 where department is not null and btrim(department) <> ''
		 order by 1
		 limit ${MAX_CHOICES}`,

	// The department a copy sits in, which is a location and a different list —
	// see the note on LookupList.
	location_department: `
		select distinct coalesce(department_name, location_name) as v
		  from lib_locations
		 where location_kind = 'department'
		   and btrim(coalesce(department_name, location_name, '')) <> ''
		 order by 1
		 limit ${MAX_CHOICES}`,

	// Newest year first: that is the one being asked about.
	fiscal_year: `
		select distinct fiscal_year as v
		  from lib_budget_heads
		 where fiscal_year is not null and btrim(fiscal_year) <> ''
		 order by 1 desc
		 limit ${MAX_CHOICES}`,

	// The same orders the report itself counts — a cancelled one is not offered.
	order_number: `
		select distinct order_number as v
		  from lib_procurement_orders
		 where order_status <> 'cancelled'
		   and order_number is not null and btrim(order_number) <> ''
		 order by 1 desc
		 limit ${MAX_CHOICES}`,
}

const isList = (name: string): name is LookupList => name in LISTS

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!guard.institutionId) {
			return NextResponse.json(
				{ error: 'Choose a college first — these are one library\'s own values' },
				{ status: 400 }
			)
		}

		const wanted = (searchParams.get('lists') ?? '')
			.split(',')
			.map(name => name.trim())
			.filter(isList)

		if (wanted.length === 0) {
			return NextResponse.json({ error: 'Which list?' }, { status: 400 })
		}

		// Each list is its own query, and they have nothing to do with each
		// other, so they go together rather than one after the next.
		const answers = await Promise.all(
			[...new Set(wanted)].map(async name => {
				const rows = await runScopedSql(guard.institutionId as string, LISTS[name].trim())

				// One entry per value, whatever case it was typed in. Pharmacy holds
				// both "Pharmaceutics" and "PHARMACEUTICS" — one department, written
				// by different people over the years — and offering the librarian the
				// same department twice, each returning half the copies, would be a
				// worse filter than the typed box this replaced. The report matches
				// case-insensitively to suit, so either spelling finds them all.
				const bySpelling = new Map<string, string>()
				for (const row of rows) {
					const value = (row.v ?? '').toString().trim()
					if (value && !bySpelling.has(value.toLowerCase())) {
						bySpelling.set(value.toLowerCase(), value)
					}
				}
				return [name, [...bySpelling.values()]] as const
			})
		)

		return NextResponse.json(Object.fromEntries(answers))
	} catch (error) {
		// The reports migration not having been run is the usual one, and it says
		// which file to run rather than answering 500.
		if (error instanceof ReportSqlError) {
			return NextResponse.json({ error: error.message }, { status: error.status })
		}
		console.error('Unexpected error reading report options:', error)
		return NextResponse.json({ error: 'Could not read the choices' }, { status: 500 })
	}
}
