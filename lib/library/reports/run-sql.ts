/**
 * One read-only SELECT, run as one college. Server only.
 *
 * Everything goes through `lib_report_sql` in the database (migration
 * 20260905_lib_report_sql): the function points the query at that college's
 * report views, switches the transaction to read-only, caps the rows and the
 * time, and hands the rows back as JSON with the columns in the order the
 * query named them.
 */

import { getSupabaseServer } from '@/lib/supabase-server'
import { SQL_ROW_CAP } from './sql-guard'

export type Row = Record<string, unknown>

export class ReportSqlError extends Error {
	constructor(message: string, readonly status: number, readonly detail?: string) {
		super(message)
	}
}

/** The name the migration file carries, for the message when it has not been run. */
export const REPORT_MIGRATION = '20260905_lib_report_sql'

/**
 * Postgres's error, in the librarian's words where it can be.
 *
 * The raw message is passed along as `detail` — "column x does not exist" is
 * exactly what somebody writing SQL wants to see — but the headline says
 * which kind of thing went wrong.
 */
function explain(error: { code?: string; message?: string; details?: string; hint?: string }): ReportSqlError {
	const message = error.message ?? 'The query failed'
	const code = error.code ?? ''

	if (code === 'PGRST202' || /function .*lib_report_sql.* does not exist|Could not find the function/i.test(message)) {
		return new ReportSqlError(
			`The reports need a database update that has not been run yet — run ${REPORT_MIGRATION} and try again`,
			503, message
		)
	}
	if (code === '57014' || /statement timeout/i.test(message)) {
		return new ReportSqlError('The query took longer than 60 seconds and was stopped — narrow the dates or add a filter', 400, message)
	}
	if (code === '42P01' || /relation .* does not exist/i.test(message)) {
		return new ReportSqlError('That table is not one of the report tables — see the list beside the box', 400, message)
	}
	if (code === '42703' || /column .* does not exist/i.test(message)) {
		return new ReportSqlError('A column in the query does not exist', 400, message)
	}
	if (code === '42501' || /permission denied/i.test(message)) {
		return new ReportSqlError('The query reached something reports are not allowed to read', 400, message)
	}
	if (code === '25006' || /read-only transaction/i.test(message)) {
		return new ReportSqlError('Reports only read — that query tried to change something', 400, message)
	}
	if (code === '42601' || /syntax error/i.test(message)) {
		return new ReportSqlError('There is a mistake in the SQL', 400, message)
	}
	if (code.startsWith('42') || code.startsWith('22')) {
		return new ReportSqlError('The query could not be run as written', 400, message)
	}
	return new ReportSqlError('The query failed', 500, message)
}

/** How long the server waits for a report before giving up on it. */
export const SQL_TIMEOUT_MS = 60_000

/** The rows for one query, in one college. Throws a `ReportSqlError`. */
export async function runScopedSql<T extends Row = Row>(institutionId: string, sql: string, limit = SQL_ROW_CAP): Promise<T[]> {
	const supabase = getSupabaseServer()
	let data: unknown
	let error: { code?: string; message?: string } | null
	try {
		;({ data, error } = await supabase
			.rpc('lib_report_sql', {
				p_sql: sql,
				p_institution: institutionId,
				p_limit: Math.max(1, Math.min(limit, SQL_ROW_CAP)),
			})
			.abortSignal(AbortSignal.timeout(SQL_TIMEOUT_MS)))
	} catch (thrown) {
		// The wait ran out before the database answered
		if (thrown instanceof Error && /abort|timeout/i.test(thrown.name + thrown.message)) {
			throw new ReportSqlError('The query took longer than 60 seconds and was stopped — narrow the dates or add a filter', 400, thrown.message)
		}
		throw thrown
	}

	if (error) {
		if (/abort|timeout/i.test(error.message ?? '')) {
			throw new ReportSqlError('The query took longer than 60 seconds and was stopped — narrow the dates or add a filter', 400, error.message)
		}
		throw explain(error)
	}

	const rows = Array.isArray(data) ? data : []
	return rows as T[]
}

/**
 * Column names in the order the query gave them, from the first row.
 *
 * Names beginning with `_` are the query's own sorting helpers and are not
 * columns of the report: they are dropped here, from the names and the rows.
 */
export function shapeRows(rows: Row[]): { columns: string[]; rows: Row[] } {
	if (rows.length === 0) return { columns: [], rows: [] }
	const columns = Object.keys(rows[0]).filter(key => !key.startsWith('_'))
	const cleaned = rows.map(row => {
		const kept: Row = {}
		for (const column of columns) kept[column] = row[column]
		return kept
	})
	return { columns, rows: cleaned }
}
