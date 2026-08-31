/**
 * Department libraries — the shapes the screens and their routes agree on.
 *
 * Kept in a file of its own rather than added to `types/lib.ts` so nothing
 * already in use changes shape. A department library is a `lib_locations` row
 * with `location_kind = 'department'`, which is why these types read as a
 * location wearing a department's clothes.
 */

/** A MyJKKN department, with whatever this library has put inside it. */
export interface DepartmentRow {
	/** MyJKKN's department id. Stable, and what the library row is tied to. */
	myjkkn_department_id: string
	department_code: string
	department_name: string
	/** MyJKKN's short form, e.g. "HAP". Null where it has none. */
	display_name: string | null
	degree_name: string | null
	/** False when MyJKKN has deactivated the department. Shown, not hidden. */
	is_active_in_myjkkn: boolean

	/** Null until somebody sets a library up for this department. */
	library: DepartmentLibrary | null
}

/** The library inside a department: one row of `lib_locations`. */
export interface DepartmentLibrary {
	id: string
	institution_id: string
	/** Always `DEPT-<department code>`, so it reads correctly on shelf reports. */
	location_code: string
	location_name: string
	department_code: string | null
	department_name: string | null
	myjkkn_department_id: string | null

	/**
	 * The DEFAULT for books sent here. Off means they arrive reference-only,
	 * which is how a department library is normally run. What circulation
	 * actually enforces is each copy's own switch — that is what lets one or two
	 * books be issued without opening the whole department.
	 */
	is_lendable: boolean
	is_active: boolean
	sort_order: number

	incharge_myjkkn_id: string | null
	incharge_name: string | null
	incharge_designation: string | null
	incharge_email: string | null
	incharge_assigned_at: string | null
	incharge_assigned_by: string | null

	created_at: string

	/** Filled in by the list route, not stored. */
	book_count?: number
	/** How many of those may be issued rather than consulted on the spot. */
	issuable_count?: number
}

/** One copy sitting in a department library. */
export interface DepartmentBook {
	id: string
	accession_number: string
	barcode: string | null
	copy_number: number
	status: string
	/** On for a copy that may be issued; off for reference only. */
	is_lendable: boolean
	condition: string
	accession_date: string | null
	title: string
	author: string | null
	call_number: string | null
	isbn: string | null
	resource_format: string | null
	/** Set when the copy is currently out with a member. */
	on_loan_to: string | null
	due_date: string | null
}

/** A copy in the main library, offered for sending out. */
export interface TransferCandidate {
	id: string
	accession_number: string
	copy_number: number
	status: string
	is_lendable: boolean
	title: string
	author: string | null
	call_number: string | null
	location_name: string | null
	location_code: string | null
}

/** One movement between the main library and a department. */
export interface DepartmentTransfer {
	id: string
	direction: 'to_department' | 'to_main'
	department_name: string | null
	incharge_name: string | null
	accession_number: string | null
	title: string | null
	reference_only: boolean
	remarks: string | null
	moved_at: string
	moved_by_name: string | null
}

/** A person MyJKKN says teaches at this college, offered as an in-charge. */
export interface InchargeCandidate {
	myjkkn_id: string
	display_name: string
	member_number: string
	role_label: string
	email: string | null
	photo_url: string | null
}
