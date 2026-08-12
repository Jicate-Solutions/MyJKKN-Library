/**
 * The library's clock.
 *
 * The server runs on UTC, the library runs on IST. `new Date().toISOString()`
 * on a hosted server gives 11:23 for a 4:53 PM scan — five and a half hours
 * behind, silently, on every row. Gate times are read by inspectors and argued
 * about by students, so they have to be the time on the wall.
 *
 * Everything here is derived through Intl with an explicit time zone rather
 * than by adding 330 minutes, so it stays right regardless of where the server
 * is deployed or what its own clock is set to.
 */

const IST = 'Asia/Kolkata'

/** en-CA formats as YYYY-MM-DD, which is what a DATE column wants. */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: IST,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: IST,
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
})

/** Today in the library, as YYYY-MM-DD. */
export function istToday(at: Date = new Date()): string {
	return dateFormatter.format(at)
}

/** The time on the library wall, as HH:MM:SS — the shape a TIME column stores. */
export function istTimeNow(at: Date = new Date()): string {
	return timeFormatter.format(at)
}

/**
 * A stored TIME back into something readable: "04:53:07" → "4:53 PM".
 * Deliberately string-based; building a Date from a bare time would drag the
 * browser's own zone back into a value that is already local.
 */
export function formatClockTime(value: string | null | undefined): string {
	if (!value) return '—'
	const [rawHour, rawMinute] = value.split(':')
	const hour = Number(rawHour)
	const minute = Number(rawMinute)
	if (Number.isNaN(hour) || Number.isNaN(minute)) return value

	const suffix = hour < 12 ? 'AM' : 'PM'
	const display = hour % 12 === 0 ? 12 : hour % 12
	return `${display}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** How long someone stayed, for the register's last column. */
export function durationBetween(entry: string | null, exit: string | null): string {
	if (!entry || !exit) return '—'
	const toMinutes = (value: string) => {
		const [h, m] = value.split(':').map(Number)
		return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m
	}
	const from = toMinutes(entry)
	const to = toMinutes(exit)
	if (from === null || to === null || to < from) return '—'

	const minutes = to - from
	if (minutes < 60) return `${minutes} min`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}
