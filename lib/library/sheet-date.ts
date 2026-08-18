/**
 * Reading the date a librarian actually typed.
 *
 * The template asks for 2026-08-12, and the check used to accept nothing else.
 * But a date column in Excel comes back in whatever form the person's machine
 * uses — 18-08-2026, 18/08/2026, 2026/08/18, or the plain number Excel keeps
 * dates as internally — and a sheet of 1,999 books was refused entirely over a
 * column that was correct in every human sense.
 *
 * So any of those are read here and turned into the one form the database
 * stores. Day comes first when the order is ambiguous (18/08 and 08/08 alike),
 * because that is how a date is written here.
 */

/** Excel counts days from 1900-01-01, with a famous off-by-one for 1900 itself. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86400000

const pad = (value: number): string => value.toString().padStart(2, '0')

function build(year: number, month: number, day: number): string | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null

	// Rejects the 31st of a 30-day month and the 29th of a common February,
	// which the range check above lets through
	const asDate = new Date(Date.UTC(year, month - 1, day))
	if (asDate.getUTCFullYear() !== year || asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) {
		return null
	}

	return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Returns the date as YYYY-MM-DD, or null when the text is not a date at all.
 */
export function toSheetDate(value: unknown): string | null {
	const text = (value ?? '').toString().trim()
	if (!text) return null

	// Already in the form we store
	const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
	if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]))

	// Year first with slashes or dots: 2026/08/18, 2026.08.18
	const yearFirst = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
	if (yearFirst) return build(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]))

	// Day first, any of the three separators: 18-08-2026, 18/08/2026, 18.08.2026
	const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
	if (dayFirst) {
		const first = Number(dayFirst[1])
		const second = Number(dayFirst[2])
		const year = Number(dayFirst[3])

		// 08/18/2026 can only be month first, so read it that way rather than
		// refusing a date whose meaning is not in doubt
		if (first > 12 && second <= 12) return build(year, second, first)
		if (second > 12 && first <= 12) return build(year, first, second)

		return build(year, second, first)
	}

	// The number Excel keeps a date as when the cell was never formatted
	if (/^\d{5}$/.test(text)) {
		const serial = Number(text)
		const asDate = new Date(EXCEL_EPOCH_UTC + serial * MS_PER_DAY)
		return build(asDate.getUTCFullYear(), asDate.getUTCMonth() + 1, asDate.getUTCDate())
	}

	return null
}
