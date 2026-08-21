/**
 * Turning a typed supplier name into the supplier row it means.
 *
 * The register asks for the vendor by name, because that is what the librarian
 * has in front of them — a delivery note, not a database id. Acquisition →
 * Suppliers is not in use on any campus yet, so a dropdown there would offer
 * nothing and the vendor could not be recorded at all.
 *
 * So a name that is already on this college's list is matched to it, and a name
 * that is not is added. The supplier list therefore fills itself as magazines
 * are entered, and is already populated on the day that screen is put to work —
 * rather than being a form nobody can get past.
 *
 * Matching ignores capitals and stray spaces, so "universal book agency" and
 * "Universal  Book Agency" are one vendor and not three.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Capitals and repeated spaces are noise when deciding if two names are one vendor. */
export function normaliseSupplierName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * A code for a vendor that arrived without one.
 *
 * Built from the name so it is recognisable in the Suppliers screen, and kept
 * short because the column is displayed beside the name. Uniqueness is handled
 * by the caller, which retries on a clash.
 */
function codeFromName(name: string, attempt: number): string {
	const base = name
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 20) || 'SUPPLIER'
	return attempt === 0 ? base : `${base}-${attempt + 1}`
}

export interface SupplierLookup {
	/** The id for a typed name, or null when the name is blank. */
	resolve(name: unknown): Promise<string | null>
}

/**
 * Reads this college's suppliers once, then answers by name — so a sheet of two
 * thousand rows costs one query rather than two thousand.
 */
export async function supplierLookupFor(
	supabase: SupabaseClient,
	institutionId: string
): Promise<SupplierLookup> {
	const byName = new Map<string, string>()

	const { data } = await supabase
		.from('lib_suppliers')
		.select('id, supplier_name, supplier_code')
		.eq('institution_id', institutionId)

	for (const supplier of data || []) {
		// The code is accepted too: a librarian copying from a purchase order may
		// write either, and both name one vendor.
		if (supplier.supplier_name) byName.set(normaliseSupplierName(supplier.supplier_name), supplier.id)
		if (supplier.supplier_code) byName.set(normaliseSupplierName(supplier.supplier_code), supplier.id)
	}

	return {
		async resolve(rawName: unknown): Promise<string | null> {
			const name = (rawName ?? '').toString().trim()
			if (!name) return null

			const key = normaliseSupplierName(name)
			const known = byName.get(key)
			if (known) return known

			// New to this college. Tried a few times because two rows of the same
			// sheet can produce the same code, and because another college's code
			// is no obstacle — the unique key is (institution, code).
			for (let attempt = 0; attempt < 5; attempt++) {
				const { data: created, error } = await supabase
					.from('lib_suppliers')
					.insert({
						institution_id: institutionId,
						supplier_code: codeFromName(name, attempt),
						supplier_name: name,
						is_active: true,
					})
					.select('id')
					.single()

				if (created) {
					byName.set(key, created.id)
					return created.id
				}

				// Somebody else inserted the same vendor between the read and the
				// write — find theirs rather than making a second one.
				if (error?.code === '23505') {
					const { data: existing } = await supabase
						.from('lib_suppliers')
						.select('id')
						.eq('institution_id', institutionId)
						.ilike('supplier_name', name)
						.maybeSingle()

					if (existing) {
						byName.set(key, existing.id)
						return existing.id
					}
					continue
				}

				break
			}

			// A vendor that could not be saved must never cost the library the book
			// it was entering. The copy goes in without one.
			return null
		},
	}
}

/**
 * The same thing for a single book being entered by hand.
 *
 * A blank name costs nothing — it returns before reading anything, so a book,
 * a project or anything else that never carries a supplier adds no query to the
 * Add Title path.
 */
export async function supplierIdForName(
	supabase: SupabaseClient,
	institutionId: string,
	rawName: unknown
): Promise<string | null> {
	const name = (rawName ?? '').toString().trim()
	if (!name) return null

	const lookup = await supplierLookupFor(supabase, institutionId)
	return lookup.resolve(name)
}
