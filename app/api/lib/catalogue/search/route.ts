/**
 * The OPAC search: GET /api/lib/catalogue/search
 *
 * What a reader standing at the catalogue terminal actually types is anything
 * they happen to know — half a title, an author's surname, the publisher, the
 * ISBN, or the number written inside a book they have in their hand. So all of
 * those are searched, not the title alone.
 *
 * The accession number is the one that does not live on the record: it belongs
 * to the physical copy, in lib_items. It is looked up there and folded into the
 * same answer, so "101" finds the book that copy belongs to.
 *
 * Every result carries how many copies exist and how many are on the shelf,
 * because a catalogue that cannot say whether the book is in is not much use.
 * Scoped to one institution like everything else — seven libraries, seven
 * catalogues, and a reader at Pharmacy is never shown a book at Dental.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'
import { guardCollection } from '@/lib/auth/api-guard'
import { fetchAllRows } from '@/lib/library/fetch-all'

/** Everything the OPAC card needs to describe a book. */
const RECORD_FIELDS = `
	id, institution_id, title, subtitle, resource_format, isbn, issn, edition,
	volume_number, publication_year, language, classification_number, call_number,
	subject_headings, publisher_name, publisher_place, series_title, pages,
	is_reference_only, is_active, author, department, book_type, book_location,
	authors:lib_catalogue_authors(id, author_name, author_type, sort_order)
`

/**
 * Ids per `in(...)`, so a request URL never grows past what PostgREST accepts.
 */
const ID_CHUNK = 100

/**
 * Above this many matching titles, the copies are read a campus at a time
 * rather than a hundred titles at a time.
 *
 * Counting copies means reading lib_items. Asked title by title that is one
 * request per hundred titles — fine for a search that finds twenty books, and
 * two hundred requests for "show me every book in Arts & Science". Past this
 * point one sweep of the campus's copies is far less work than the chunks, and
 * the tally that comes out of it is identical either way.
 */
const CHUNKS_OVER_SWEEP = 300

/**
 * Makes a typed phrase safe to drop into a PostgREST `or(...)` filter.
 *
 * Commas, dots, brackets and quotes are all syntax there — one of them in a
 * search box would break the whole query — and `%` and `_` are ilike wildcards,
 * so a stray one turns any search into "match everything". The semicolon goes
 * too: paired with a trailing double dash it forms the shape of a SQL injection
 * attempt, and Supabase's own protection rejects the request outright before it
 * is ever run. Nothing could come of it either way — the value is bound, never
 * pasted into SQL — but a reader typing a semicolon deserves results rather
 * than an error.
 *
 * Each becomes a wildcard instead of being dropped, which is what a reader
 * means anyway: "K.M. Varghese" then still finds "K M VARGHESE COMPANY", and
 * "Pharmacology; a textbook" still finds itself.
 */
function forFilter(term: string): string {
	return term.replace(/[,.()"';\\%_[\]{}]/g, '%')
}

/** Splits ids into `in(...)`-sized groups. */
function chunk<T>(values: T[], size: number): T[][] {
	const groups: T[][] = []
	for (let i = 0; i < values.length; i += size) groups.push(values.slice(i, i + size))
	return groups
}

interface ItemRow {
	catalogue_record_id: string | null
	accession_number: string | null
	status: string | null
}

/** Only the parts of a record this route reads by name; the rest passes through. */
interface RecordRow {
	id: string
	title: string | null
	[field: string]: unknown
}

export async function GET(request: Request) {
	try {
		const supabase = getSupabaseServer()
		const { searchParams } = new URL(request.url)
		const guard = await guardCollection(request, searchParams.get('institution_id'))
		if (!guard.ok) return guard.response

		const institutionId = guard.institutionId
		const q = (searchParams.get('q') ?? searchParams.get('search') ?? '').trim()
		const resourceFormat = searchParams.get('resource_format')
		const language = searchParams.get('language')
		const availability = searchParams.get('availability')

		// Nothing asked for at all: an empty answer, not the whole shelf
		if (!q && !resourceFormat && !language) {
			return NextResponse.json({ data: [], total: 0, query: '' })
		}

		/**
		 * A record query narrowed to this campus and the chosen filters.
		 *
		 * Every read of lib_catalogue_records below starts here, so a book can
		 * never reach a reader at another college, and the format and language
		 * chosen apply no matter which of the three searches found the book.
		 */
		const records$ = (fields: string) => {
			let query = supabase.from('lib_catalogue_records').select(fields).eq('is_active', true)
			if (institutionId) query = query.eq('institution_id', institutionId)
			if (resourceFormat) query = query.eq('resource_format', resourceFormat)
			if (language) query = query.eq('language', language)
			return query
		}

		let recordIds: string[] = []

		if (q) {
			const safe = forFilter(q)

			// Every text field a reader might half-remember. Year is a number, so
			// it only joins in when what was typed could actually be a year.
			const fields = [
				'title', 'subtitle', 'author', 'publisher_name', 'publisher_place',
				'isbn', 'issn', 'edition', 'volume_number', 'call_number',
				'classification_number', 'series_title', 'language', 'department',
				'book_type', 'book_location',
			]
			const conditions = fields.map(f => `${f}.ilike.%${safe}%`)
			if (/^\d{4}$/.test(q) && Number(q) >= 1000 && Number(q) <= 2999) {
				conditions.push(`publication_year.eq.${q}`)
			}

			// Three ways in, asked at once: the record's own fields, the separate
			// authors table, and the accession number on the physical copy. Each
			// is read in slices, because the database hands back a thousand rows
			// at a time and a broad search finds more than that — a reader asking
			// for every book by a common name must not be shown the first
			// thousand as though it were all of them.
			const [byField, byAuthor, byAccession] = await Promise.all([
				fetchAllRows<{ id: string }>(range =>
					records$('id')
						.or(conditions.join(','))
						.order('title', { ascending: true })
						.range(range.from, range.to) as unknown as PromiseLike<{ data: { id: string }[] | null; error: unknown }>
				),
				fetchAllRows<{ catalogue_record_id: string | null }>(range => {
					let authorQuery = supabase
						.from('lib_catalogue_authors')
						.select('catalogue_record_id')
						.ilike('author_name', `%${safe}%`)
					if (institutionId) authorQuery = authorQuery.eq('institution_id', institutionId)
					return authorQuery.range(range.from, range.to)
				}),
				fetchAllRows<{ catalogue_record_id: string | null }>(range => {
					let itemQuery = supabase
						.from('lib_items')
						.select('catalogue_record_id')
						.or(`accession_number.ilike.%${safe}%,barcode.ilike.%${safe}%`)
					if (institutionId) itemQuery = itemQuery.eq('institution_id', institutionId)
					return itemQuery.range(range.from, range.to)
				}),
			])

			const failure = byField.error ?? byAuthor.error ?? byAccession.error
			if (failure) {
				console.error('Error searching the catalogue:', failure)
				return NextResponse.json({ error: 'Search failed' }, { status: 500 })
			}

			const seen = new Set<string>()
			for (const row of byField.data) seen.add(row.id)
			for (const row of byAuthor.data) {
				if (row.catalogue_record_id) seen.add(row.catalogue_record_id)
			}
			for (const row of byAccession.data) {
				if (row.catalogue_record_id) seen.add(row.catalogue_record_id)
			}
			recordIds = [...seen]
		}

		// Records themselves. With no words typed this is a plain browse by
		// format or language; with words it is the merged set from above, read
		// back in full and re-filtered so a match found through an author or an
		// accession number still obeys the format and language chosen.
		const records: RecordRow[] = []

		if (!q) {
			const { data, error } = await fetchAllRows<RecordRow>(range =>
				records$(RECORD_FIELDS)
					.order('title', { ascending: true })
					.range(range.from, range.to) as unknown as PromiseLike<{ data: RecordRow[] | null; error: unknown }>
			)

			if (error) {
				console.error('Error browsing the catalogue:', error)
				return NextResponse.json({ error: 'Search failed' }, { status: 500 })
			}
			records.push(...data)
		} else if (recordIds.length > 0) {
			const groups = await Promise.all(
				chunk(recordIds, ID_CHUNK).map(ids =>
					fetchAllRows<RecordRow>(range =>
						records$(RECORD_FIELDS)
							.in('id', ids)
							.range(range.from, range.to) as unknown as PromiseLike<{ data: RecordRow[] | null; error: unknown }>
					)
				)
			)

			for (const group of groups) {
				if (group.error) {
					console.error('Error reading catalogue matches:', group.error)
					return NextResponse.json({ error: 'Search failed' }, { status: 500 })
				}
				records.push(...group.data)
			}
		}

		// Copies on the shelf. The registry counts a copy as available when its
		// status says so, and this counts the same way, so the two screens can
		// never disagree about the same book.
		//
		// Read in slices throughout: a hundred titles can easily hold more than
		// a thousand copies between them, and a tally built from a truncated
		// read would quietly under-report what is on the shelf.
		const counts = new Map<string, { total: number; available: number; accessions: string[] }>()

		if (records.length > 0) {
			const ids = records.map(r => r.id)

			// The sweep is not conditional on a campus being chosen: a super admin
			// browsing all seven at once is exactly the case with the most titles
			// to tally, and it was the one case left reading them a hundred at a
			// time. Without a campus the sweep simply covers every campus, and the
			// `wanted` filter below keeps the tally identical either way.
			const sweepInstead = records.length > CHUNKS_OVER_SWEEP

			const itemGroups = sweepInstead
				? [
						await fetchAllRows<ItemRow>(range => {
							let sweep = supabase
								.from('lib_items')
								.select('catalogue_record_id, accession_number, status')
							if (institutionId) sweep = sweep.eq('institution_id', institutionId)
							return sweep
								.order('accession_number', { ascending: true })
								.range(range.from, range.to)
						}),
					]
				: await Promise.all(
						chunk(ids, ID_CHUNK).map(group =>
							fetchAllRows<ItemRow>(range => {
								let itemQuery = supabase
									.from('lib_items')
									.select('catalogue_record_id, accession_number, status')
									.in('catalogue_record_id', group)
								if (institutionId) itemQuery = itemQuery.eq('institution_id', institutionId)
								return itemQuery
									.order('accession_number', { ascending: true })
									.range(range.from, range.to)
							})
						)
					)

			// Sweeping the campus brings back copies of titles this search never
			// matched, so only the ones asked about are tallied.
			const wanted = sweepInstead ? new Set(ids) : null

			for (const group of itemGroups) {
				if (group.error) {
					console.error('Error counting copies:', group.error)
					return NextResponse.json({ error: 'Search failed' }, { status: 500 })
				}
				for (const item of group.data) {
					const key = item.catalogue_record_id
					if (!key) continue
					if (wanted && !wanted.has(key)) continue
					const tally = counts.get(key) ?? { total: 0, available: 0, accessions: [] }
					tally.total++
					if (item.status === 'available') tally.available++
					if (item.accession_number) tally.accessions.push(item.accession_number)
					counts.set(key, tally)
				}
			}
		}

		const needle = q.toLowerCase()

		let results = records.map(record => {
			const tally = counts.get(record.id) ?? { total: 0, available: 0, accessions: [] }
			return {
				...record,
				title: record.title,
				item_count: tally.total,
				available_count: tally.available,
				accession_numbers: tally.accessions,
			}
		})

		if (availability === 'available') results = results.filter(r => r.available_count > 0)
		else if (availability === 'unavailable') results = results.filter(r => r.available_count === 0)

		// Closest answer first. Somebody who types an accession number wants that
		// exact copy's book at the top, not alphabetical order.
		if (needle) {
			const rank = (record: (typeof results)[number]): number => {
				const title = String(record.title ?? '').toLowerCase()
				if (record.accession_numbers.some(a => a.toLowerCase() === needle)) return 0
				if (title === needle) return 1
				if (title.startsWith(needle)) return 2
				if (title.includes(needle)) return 3
				return 4
			}
			results.sort((a, b) => {
				const byRank = rank(a) - rank(b)
				if (byRank !== 0) return byRank
				return String(a.title ?? '').localeCompare(String(b.title ?? ''))
			})
		}

		// Every match, however many. The page pages through them itself.
		return NextResponse.json({
			data: results,
			total: results.length,
			query: q,
		})
	} catch (error) {
		console.error('Unexpected error during catalogue search:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
