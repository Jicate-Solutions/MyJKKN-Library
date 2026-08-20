'use client'

/**
 * Reporting what happened on screen.
 *
 * Two ways to send, chosen by how much the line matters:
 *
 *   * `log()` goes on its own, straight away — an export, a failed action,
 *     anything somebody may later ask about by name.
 *   * `queueLog()` waits a moment for company. Page views and menu clicks
 *     arrive in bursts as a librarian moves around, and sending a request for
 *     each one would put more traffic on the wire than the work itself.
 *
 * Nothing here can break a page: every send is wrapped, failures are dropped,
 * and no caller ever waits on the result.
 */

export type ActivityAction =
	| 'create' | 'update' | 'delete' | 'read'
	| 'navigation' | 'page_view' | 'click' | 'search'
	| 'file_import' | 'file_export' | 'file_upload' | 'file_download'
	| 'auth_login' | 'auth_logout' | 'auth_session_refresh' | 'auth_session_expired'

export interface ActivityEntry {
	action: ActivityAction
	resource_type?: string | null
	resource_id?: string | null
	institution_id?: string | null
	status?: 'success' | 'error' | 'pending'
	error_message?: string | null
	metadata?: Record<string, unknown>
}

/** Small enough that a burst still lands quickly, large enough to be worth batching. */
const MAX_BATCH = 10
/** Long enough to collect a burst, short enough that nothing is lost on a page change. */
const BATCH_DELAY_MS = 100

class ActivityLogService {
	private queue: ActivityEntry[] = []
	private timer: ReturnType<typeof setTimeout> | null = null
	private sending = false

	/**
	 * Which library the person is looking at.
	 *
	 * Set by the screens; the server keeps whatever arrives, so a line can be
	 * read back by the college it belongs to.
	 */
	private institutionId: string | null = null

	setInstitution(institutionId: string | null) {
		this.institutionId = institutionId
	}

	/** Sent on its own, now. */
	async log(entry: ActivityEntry): Promise<void> {
		try {
			await fetch('/api/lib/logs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(this.decorate(entry)),
			})
		} catch {
			// A page must never break because its telemetry did
		}
	}

	/** Queued, and sent with whatever else arrives in the next moment. */
	queueLog(entry: ActivityEntry): void {
		this.queue.push(this.decorate(entry))

		if (this.queue.length >= MAX_BATCH) {
			void this.flush()
			return
		}
		if (!this.timer) {
			this.timer = setTimeout(() => { void this.flush() }, BATCH_DELAY_MS)
		}
	}

	private decorate(entry: ActivityEntry): ActivityEntry {
		return {
			...entry,
			institution_id: entry.institution_id ?? this.institutionId,
			metadata: entry.metadata ?? {},
		}
	}

	/** Sends what is waiting, then keeps going while more has arrived meanwhile. */
	private async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		if (this.sending || this.queue.length === 0) return

		this.sending = true
		const entries = this.queue.splice(0, MAX_BATCH)

		try {
			await fetch('/api/lib/logs/batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ entries }),
			})
		} catch {
			// Dropped on purpose: retrying screen movement is not worth a queue
			// that grows while the network is down
		} finally {
			this.sending = false
			if (this.queue.length > 0) void this.flush()
		}
	}

	// ── The named events, so no caller writes an action string by hand ──

	logNavigation(toPath: string, detail: { from_path?: string; menu_title?: string; menu_section?: string } = {}) {
		this.queueLog({ action: 'navigation', resource_type: 'page', resource_id: toPath, metadata: detail })
	}

	logPageView(path: string, title?: string) {
		this.queueLog({ action: 'page_view', resource_type: 'page', resource_id: path, metadata: title ? { title } : {} })
	}

	logClick(element: string, path: string, detail: Record<string, unknown> = {}) {
		this.queueLog({ action: 'click', resource_type: 'ui_element', resource_id: path, metadata: { element, ...detail } })
	}

	logSearch(resourceType: string, terms: Record<string, unknown>, results?: number) {
		this.queueLog({
			action: 'search',
			resource_type: resourceType,
			resource_id: typeof window === 'undefined' ? null : window.location.pathname,
			metadata: { ...terms, ...(results === undefined ? {} : { results }) },
		})
	}

	/**
	 * An import or export. A partly failed import is recorded as an error, so it
	 * shows up in the day's error count instead of reading as a clean run.
	 */
	logFileOperation(
		operation: 'file_import' | 'file_export' | 'file_upload' | 'file_download',
		resourceType: string,
		detail: { records_count?: number; error_count?: number; file_name?: string; [key: string]: unknown } = {}
	) {
		void this.log({
			action: operation,
			resource_type: resourceType,
			resource_id: typeof window === 'undefined' ? null : window.location.pathname,
			status: (detail.error_count ?? 0) > 0 ? 'error' : 'success',
			error_message: (detail.error_count ?? 0) > 0 ? `${detail.error_count} row(s) failed` : null,
			metadata: detail,
		})
	}

	logError(resourceType: string, message: string, detail: Record<string, unknown> = {}) {
		void this.log({
			action: 'read',
			resource_type: resourceType,
			resource_id: typeof window === 'undefined' ? null : window.location.pathname,
			status: 'error',
			error_message: message,
			metadata: detail,
		})
	}

	logAuth(event: 'login' | 'logout' | 'session_refresh' | 'session_expired', detail: Record<string, unknown> = {}) {
		void this.log({
			action: `auth_${event}` as ActivityAction,
			resource_type: 'session',
			resource_id: typeof window === 'undefined' ? null : window.location.pathname,
			metadata: detail,
		})
	}
}

/** One queue for the tab — several would defeat the batching. */
export const activityLog = new ActivityLogService()
