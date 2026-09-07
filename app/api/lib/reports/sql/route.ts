/**
 * A typed query, run: POST /api/lib/reports/sql
 *
 * Body: { institution_id, sql }
 *
 * For a librarian who knows SQL and wants an answer the ready-made reports do
 * not give. The query is checked here for the things a report has no business
 * saying, then run through the same database function as every other report
 * — one college's views, read-only, capped at 5,000 rows and 60 seconds. What
 * the database refuses is passed back in its own words, because that is what
 * somebody writing SQL needs to see.
 *
 * Librarian and above. Every run is written to the activity log with the
 * query itself, so what was asked of the data is never a mystery.
 */

import { NextResponse } from 'next/server'
import { guardCollection } from '@/lib/auth/api-guard'
import { hasAtLeast } from '@/lib/auth/server-access'
import { logActivity } from '@/lib/library/activity-log'
import { checkReportSql, SQL_ROW_CAP } from '@/lib/library/reports/sql-guard'
import { runScopedSql, shapeRows, ReportSqlError } from '@/lib/library/reports/run-sql'

export async function POST(request: Request) {
	try {
		const body = await request.json().catch(() => ({}))
		const guard = await guardCollection(request, body.institution_id ?? null)
		if (!guard.ok) return guard.response

		if (!hasAtLeast(guard.caller, 'librarian')) {
			return NextResponse.json({ error: 'Only library staff can run a query' }, { status: 403 })
		}
		if (!guard.institutionId) {
			return NextResponse.json({ error: 'Choose a college first — a query runs against one library at a time' }, { status: 400 })
		}

		const check = checkReportSql(String(body.sql ?? ''))
		if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

		const started = Date.now()
		let rows
		try {
			rows = await runScopedSql(guard.institutionId, check.sql)
		} catch (error) {
			if (error instanceof ReportSqlError) {
				void logActivity(request, {
					action: 'read',
					resource_type: 'report_sql',
					resource_id: '/reports',
					institution_id: guard.institutionId,
					status: 'error',
					error_message: error.detail ?? error.message,
					metadata: { sql: check.sql.slice(0, 4000) },
				})
				return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
			}
			throw error
		}

		const shaped = shapeRows(rows)

		void logActivity(request, {
			action: 'read',
			resource_type: 'report_sql',
			resource_id: '/reports',
			institution_id: guard.institutionId,
			metadata: { sql: check.sql.slice(0, 4000), rows: shaped.rows.length, ms: Date.now() - started },
		})

		return NextResponse.json({
			columns: shaped.columns,
			rows: shaped.rows,
			total: shaped.rows.length,
			truncated: shaped.rows.length >= SQL_ROW_CAP,
			ms: Date.now() - started,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		console.error('Unexpected error running a typed query:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
