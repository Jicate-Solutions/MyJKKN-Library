/**
 * What a typed query may say before it is sent to the database.
 *
 * The database is the real guard — the query runs as a role that can only
 * read one college's views, inside a read-only transaction — so nothing here
 * is what keeps the data safe. This is what keeps the answer useful: a query
 * refused for a reason a librarian can act on, rather than a Postgres
 * permission error three layers down.
 */

export const SQL_MAX_LENGTH = 20_000
export const SQL_ROW_CAP = 5000

/** Words that have no place in a report, wherever they appear. */
const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|copy|vacuum|analyze|analyse|cluster|reindex|refresh|lock|call|do|listen|notify|unlisten|set|reset|discard|load|import|execute|prepare|deallocate|declare|fetch|move|close|savepoint|rollback|commit|begin|start|abort|checkpoint|security|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink|xp_cmdshell)\b/i

export interface SqlCheck {
	ok: boolean
	/** The query as it will be sent: trimmed, one trailing semicolon removed. */
	sql: string
	error?: string
}

/** Strips string literals and quoted names, so a word inside them is not read as a keyword. */
function withoutLiterals(sql: string): string {
	return sql
		.replace(/'(?:[^']|'')*'/g, "''")
		.replace(/"(?:[^"]|"")*"/g, '""')
}

export function checkReportSql(input: string): SqlCheck {
	let sql = (input ?? '').replace(/\r\n/g, '\n').trim()

	if (!sql) return { ok: false, sql, error: 'Type a query first' }
	if (sql.length > SQL_MAX_LENGTH) {
		return { ok: false, sql, error: `That is over ${SQL_MAX_LENGTH.toLocaleString('en-IN')} characters — shorten it` }
	}

	// Comments are dropped rather than refused: a pasted query often carries one
	sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim()
	sql = sql.replace(/;\s*$/, '').trim()

	if (!sql) return { ok: false, sql, error: 'Type a query first' }

	const bare = withoutLiterals(sql)

	if (bare.includes(';')) {
		return { ok: false, sql, error: 'One statement at a time — remove the extra semicolon' }
	}
	if (!/^(select|with)\b/i.test(bare)) {
		return { ok: false, sql, error: 'Only a SELECT can run here — start the query with SELECT or WITH' }
	}
	const bad = bare.match(FORBIDDEN)
	if (bad) {
		return { ok: false, sql, error: `"${bad[1].toUpperCase()}" is not allowed in a report — reports only read` }
	}
	if (/\bpublic\s*\./i.test(bare)) {
		return { ok: false, sql, error: 'Write the table name on its own, without "public." — the report views are already this college\'s' }
	}
	if (/\b(pg_catalog|information_schema)\s*\./i.test(bare) || /\bpg_[a-z_]+\b/i.test(bare)) {
		return { ok: false, sql, error: 'System tables are not part of the reports — use the lib_ tables' }
	}

	return { ok: true, sql }
}
