/**
 * One report, run: GET /api/lib/reports/run?report=<id>&institution_id=…&<filters>
 *
 * The report id names one of the reports in `lib/library/reports/catalog.ts`;
 * the rest of the query string is that report's filters. The answer is the
 * same shape for every report — columns in order, rows, and whether the row
 * cap was hit — so the page draws them all the same way.
 *
 * The desk works one college at a time and so does this: "All Institutions"
 * is refused, because a report that silently mixed seven libraries would be
 * worse than no report.
 */

import { NextResponse } from 'next/server'
import { guardCollection } from '@/lib/auth/api-guard'
import { logActivity } from '@/lib/library/activity-log'
import { reportById } from '@/lib/library/reports/catalog'
import { buildReportSql, hasSql } from '@/lib/library/reports/definitions'
import { hasCodeReport, runCodeReport } from '@/lib/library/reports/code-reports'
import { runScopedSql, shapeRows, ReportSqlError } from '@/lib/library/reports/run-sql'
import { SQL_ROW_CAP } from '@/lib/library/reports/sql-guard'

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		if (!guard.institutionId) {
			return NextResponse.json({ error: 'Choose a college first — reports are built one library at a time' }, { status: 400 })
		}

		const id = (searchParams.get('report') ?? '').trim()
		const report = reportById(id)
		if (!report) return NextResponse.json({ error: 'No such report' }, { status: 404 })

		const raw: Record<string, string | undefined> = {}
		for (const param of report.params) raw[param.key] = searchParams.get(param.key) ?? undefined

		const started = Date.now()
		let rows
		if (hasSql(id)) {
			const built = buildReportSql(id, raw)
			rows = await runScopedSql(guard.institutionId, built.sql)
		} else if (hasCodeReport(id)) {
			rows = await runCodeReport(id, guard.institutionId, raw)
		} else {
			return NextResponse.json({ error: 'This report has no body yet' }, { status: 501 })
		}

		const shaped = shapeRows(rows)

		// Reads are logged too: which report was pulled, when, with which filters
		void logActivity(request, {
			action: 'read',
			resource_type: 'report',
			resource_id: '/reports',
			institution_id: guard.institutionId,
			metadata: { report: id, filters: raw, rows: shaped.rows.length, ms: Date.now() - started },
		})

		return NextResponse.json({
			report: { id: report.id, title: report.title, tab: report.tab },
			filters: raw,
			columns: shaped.columns,
			rows: shaped.rows,
			total: shaped.rows.length,
			truncated: shaped.rows.length >= SQL_ROW_CAP,
			generated_at: new Date().toISOString(),
		})
	} catch (error) {
		if (error instanceof ReportSqlError) {
			console.error('Report SQL failed:', error.detail)
			return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
		}
		if (error instanceof Error && /required|must be|not one of|after To|No such report/.test(error.message)) {
			return NextResponse.json({ error: error.message }, { status: 400 })
		}
		console.error('Unexpected error running a report:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
