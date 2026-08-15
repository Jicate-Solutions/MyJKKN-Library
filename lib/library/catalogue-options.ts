/**
 * The choices behind the accession register.
 *
 * The Add Title form and the bulk upload sheet both read from here, so a value
 * that is valid when typed by hand is valid when uploaded, and the template can
 * never drift from what the form accepts.
 *
 * Entering a book works the same way on every campus. Only the department list
 * differs, which is why it is keyed by institution code below and why the
 * database deliberately has no CHECK constraint on the column — a college whose
 * list is not here yet types its department instead of picking one, rather than
 * being blocked or offered another college's departments.
 */

/** Pharmacy, which also runs its own gate-entry screen. */
export const PHARMACY_CODE = 'COP'

export function usesPharmacyRegister(institutionCode: string | null | undefined): boolean {
	return institutionCode === PHARMACY_CODE
}

/** Every campus enters books through the accession register. */
export function usesAccessionRegister(): boolean {
	return true
}

/**
 * Departments by institution code, as each college gave them.
 *
 * Codes are the ones in this library's own `institutions.institution_code`:
 * AHS, CAS, CET, CNR, COE, COP, DCH. They are not the codes the COE project's
 * 20260106 migration uses — Nursing is CNR here and CON there, Dental is DCH
 * here and COD there — so read them from this database, never from that file.
 *
 * Arts & Science is one library under `CAS` but two colleges on the ground, so
 * its departments carry
 * "Aided" or "Self" — Commerce, English, Mathematics and Tamil exist on both
 * sides and would otherwise be indistinguishable in a report.
 */
export const DEPARTMENTS_BY_INSTITUTION: Record<string, readonly string[]> = {
	// Pharmacy
	COP: [
		'Pharmaceutics',
		'Pharmaceutical Chemistry',
		'Pharmaceutical Analysis',
		'Pharmacology',
		'Pharmacognosy',
		'Pharmacy Practice',
		'Regulatory Affairs',
		'PHARMD',
	],
	// Allied Health Sciences
	AHS: [
		'Department of Allied (UG)',
	],
	// Arts & Science — aided side, then self-financing side
	CAS: [
		'Aided — Botany',
		'Aided — Chemistry',
		'Aided — Chemistry (PG)',
		'Aided — Commerce',
		'Aided — Commerce (PG)',
		'Aided — Economics',
		'Aided — English',
		'Aided — Geography',
		'Aided — History',
		'Aided — History (PG)',
		'Aided — MASTER OF COMPUTER APPLICATIONS',
		'Aided — Mathematics',
		'Aided — Tamil',
		'Aided — Zoology',
		'Aided — Zoology (PG)',
		'Self — Commerce',
		'Self — Commerce (PG)',
		'Self — Computer Science',
		'Self — Computer Science (PG)',
		'Self — Department of Clinical and Lab Technology',
		'Self — English',
		'Self — English (PG)',
		'Self — Mathematics',
		'Self — Mathematics (PG)',
		'Self — Microbiology',
		'Self — Physics',
		'Self — Tamil',
		'Self — Textile Fashion Designing',
		'Self — Visual Communication',
	],
	// Education
	COE: [
		'Bachelor of Education',
		'Pedagogy of History',
	],
	// Engineering & Technology
	CET: [
		'Computer Science and Engineering',
		'Computer Science and Engineering (PG)',
		'Electrical and Electronics Engineering',
		'Electronics and Communication Engineering',
		'Information Technology',
		'Master of Business Administration (PG)',
		'Mechanical Engineering',
		'Science and Humanities',
	],
	// Nursing
	CNR: [
		'Adult Health Nursing',
		'Child Health Nursing',
		'Community Health Nursing',
		'Department of Nursing (UG)',
		'Medical Surgical Nursing',
		'Mental Health Nursing',
		'Nutrition and Dietetics',
		'Obstetrics and Gynaecological Nursing',
	],
	// Dental
	DCH: [
		'Conservative and Endodontics',
		'Department of Dentistry (UG)',
		'Oral and Maxillofacial Surgery',
		'Oral Medicine and Radiology',
		'Oral Pathology and Dental Anatomy',
		'Orthodontics',
		'Pediatrics',
		'Periodontics',
		'Prosthodontics',
		'Public Health Dentistry',
	],
}

/** Kept for the Pharmacy-specific callers that predate the per-college table. */
export const PHARMACY_DEPARTMENTS = DEPARTMENTS_BY_INSTITUTION.COP

/**
 * The departments this college picks from. Empty when the college has not given
 * a list yet — the form then takes typed text, which is
 * better than a dropdown holding somebody else's departments.
 */
export function departmentsFor(institutionCode: string | null | undefined): readonly string[] {
	if (!institutionCode) return []
	return DEPARTMENTS_BY_INSTITUTION[institutionCode.toUpperCase()] ?? []
}

/** Whether a typed or uploaded department is acceptable for this college. */
export function isValidDepartment(institutionCode: string | null | undefined, department: string): boolean {
	const list = departmentsFor(institutionCode)
	if (list.length === 0) return department.trim().length > 0
	return list.some(d => d.toLowerCase() === department.trim().toLowerCase())
}

/**
 * What the librarian calls the material, and the `resource_format` each one
 * maps to.
 *
 * The register speaks in Books/Magazine/Journals/Projects; the rest of the
 * system (search filters, scorecards, loan rules) speaks in resource_format.
 * Keeping both means the new field can be as specific as the register needs —
 * Magazine and Journals are two different things on the shelf — without any
 * existing screen having to learn a new vocabulary.
 */
export const BOOK_TYPES = [
	{ label: 'Books', format: 'book' },
	{ label: 'Magazine', format: 'periodical' },
	{ label: 'Journals', format: 'periodical' },
	{ label: 'Projects', format: 'thesis' },
	{ label: 'Others', format: 'other' },
] as const

/** Widened to string[] on purpose — it is checked against free text coming from Excel. */
export const BOOK_TYPE_LABELS: string[] = BOOK_TYPES.map(t => t.label)

/** Chosen from the list, or free text once "Others" is picked. */
export const OTHER_BOOK_TYPE = 'Others'

export function formatForBookType(bookType: string): string {
	const match = BOOK_TYPES.find(t => t.label.toLowerCase() === bookType.trim().toLowerCase())
	return match?.format ?? 'other'
}

/**
 * An ISBN identifies an edition, and only books have one — ISBNs began around
 * 1970 and were never issued to magazines, journals, project reports or the
 * loose material that lands under Others.
 */
export function isbnRequiredFor(bookType: string): boolean {
	return bookType.trim().toLowerCase() === 'books'
}

/** Magazines and journals carry an ISSN in the same place a book carries an ISBN. */
export function usesIssn(bookType: string): boolean {
	const type = bookType.trim().toLowerCase()
	return type === 'magazine' || type === 'journals'
}

/** Languages seen on the Pharmacy shelves, plus room to type anything else. */
export const LANGUAGES = [
	'English',
	'Tamil',
	'Hindi',
	'Malayalam',
	'Telugu',
	'Kannada',
	'Sanskrit',
	'French',
	'German',
	'Other',
] as const

/** Reference Only, worded the way the register words it. */
export const LENDABLE_OPTIONS = [
	{ label: 'Lendable', isReferenceOnly: false },
	{ label: 'Non-lendable', isReferenceOnly: true },
] as const

export function isReferenceOnlyFromLabel(label: string): boolean {
	return label.trim().toLowerCase() === 'non-lendable'
}

/**
 * The bulk upload sheet, column by column.
 *
 * `key` is what the API expects, `header` is what the librarian sees in Excel,
 * and `required` drives both the form's red asterisk and the row-by-row check
 * on upload — one definition, so a sheet that passes the template's rules
 * cannot then be rejected by the server for a different reason.
 */
export interface TemplateColumn {
	key: string
	header: string
	required: boolean
	/** Shown under the header row in the template's Instructions sheet. */
	note?: string
}

export const TEMPLATE_COLUMNS: TemplateColumn[] = [
	{ key: 'accession_number', header: 'Accession Number', required: true, note: 'The number written in the book. Must not repeat.' },
	{ key: 'title', header: 'Title', required: true },
	{ key: 'subtitle', header: 'Sub-Title', required: false, note: 'Optional' },
	{ key: 'author', header: 'Author', required: true },
	{ key: 'edition', header: 'Edition', required: true, note: 'e.g. 3rd' },
	{ key: 'publisher_name', header: 'Publisher Name', required: true },
	{ key: 'publisher_place', header: 'Place', required: true, note: 'City where it was published' },
	{ key: 'publication_year', header: 'Year', required: true, note: 'Four digits, e.g. 2024' },
	{ key: 'price', header: 'Price (INR)', required: true, note: 'Numbers only' },
	{ key: 'book_type', header: 'Book Type', required: true, note: BOOK_TYPE_LABELS.join(' / ') + ' — or type your own when it is none of these' },
	{ key: 'isbn', header: 'ISBN', required: false, note: 'Must be filled when Book Type is Books. Leave blank for the rest.' },
	{ key: 'issn', header: 'ISSN', required: false, note: 'For Magazine and Journals, if it has one. Books do not have an ISSN.' },
	{ key: 'language', header: 'Language', required: true, note: LANGUAGES.join(' / ') },
	{ key: 'pages', header: 'Total Pages', required: true, note: 'Numbers only' },
	{ key: 'call_number', header: 'Call Number', required: false, note: 'Optional' },
	{ key: 'classification_number', header: 'Classification Number', required: false, note: 'Optional' },
	{ key: 'reference_only', header: 'Reference Only', required: true, note: 'Lendable / Non-lendable' },
	{ key: 'accession_date', header: 'Date of Adding', required: true, note: 'YYYY-MM-DD, e.g. 2026-08-12' },
	// The note is filled in per college when the template is built — each one
	// has its own list, and printing another college's here would invite it
	{ key: 'department', header: 'Department', required: true, note: 'One of your college\'s departments' },
	{ key: 'book_location', header: 'Book Location', required: false, note: 'Optional — beero / rack / shelf' },
]

/** One filled row, so the librarian can see the shape rather than guess it. */
export const TEMPLATE_EXAMPLE: Record<string, string> = {
	accession_number: '1001',
	title: 'Textbook of Pharmacognosy',
	subtitle: 'Volume I',
	author: 'C.K. Kokate',
	edition: '3rd',
	publisher_name: 'Nirali Prakashan',
	publisher_place: 'Pune',
	publication_year: '2023',
	price: '750',
	isbn: '978-93-85790-00-1',
	book_type: 'Books',
	issn: '',
	language: 'English',
	pages: '624',
	call_number: '615.321 KOK',
	classification_number: '615.321',
	reference_only: 'Lendable',
	accession_date: '2026-08-12',
	department: 'Pharmacognosy',
	book_location: 'Beero 2 / Rack 3',
}

/**
 * The column that makes bulk edit possible: the id the database gave this copy
 * when it was accessioned.
 *
 * Everything else in the sheet can be retyped — this is what says *which* book
 * the retyped line belongs to. Without it an edited accession number would read
 * as a new book rather than a correction.
 */
export const EDIT_ID_COLUMN: TemplateColumn = {
	key: 'id',
	header: 'Book ID',
	required: true,
	note: 'Given by the system. Do not change or delete it — it is how the edit finds the book.',
}
