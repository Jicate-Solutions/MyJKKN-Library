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
	// Arts & Science — the sections its own library shelves by, given by the
	// college itself. Not split into aided and self-financing: the library is
	// one, and a book on its shelf belongs to a subject, not to a funding side.
	CAS: [
		'English',
		'Miscellaneous',
		'General',
		'History',
		'Zoology',
		'Economics',
		'Commerce',
		'Mathematics',
		'Computer Science',
		'Chemistry',
		'Physics',
		'Tamil',
		'Geography',
		'Botany',
		'Main Library',
		'Nutrition and Dietetics',
		'Textile & Fashion Designing',
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
	// Dental — the college's own list, in their order and their spelling
	DCH: [
		'Anatomy',
		'Physiology',
		'Biochemistry',
		'Pharmacology',
		'Microbiology',
		'Oral pathology',
		'Oral histology',
		'Preventive and community dentistry',
		'Dental Materials',
		'General Dentistry',
		'General medicine',
		'General Surgery',
		'Implant Dentistry',
		'Oral Surgery',
		'General Pathology',
		'Conservative dentistry and Endodontics',
		'Oral Medicine',
		'Orthodontics',
		'Pedodontics',
		'Periodontics',
		'Prosthodontics',
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

/**
 * Magazine and Journals are the two types the register treats as periodicals.
 *
 * Projects and Others deliberately stay on the book side: they are entered once,
 * the way they always were, and nothing about them changes here.
 */
export function isPeriodicalType(bookType: string): boolean {
	return usesIssn(bookType)
}

/**
 * A magazine or journal comes from a vendor, issue after issue, and the library
 * needs to know which one — it is the same vendor the subscription is paid to.
 * A book is bought once and its supplier belongs to the purchase order, not to
 * the shelf, which is why the field is asked for on one and not the other.
 */
export function usesSupplier(bookType: string): boolean {
	return isPeriodicalType(bookType)
}

/**
 * Author, Edition/Issue and Price — a book's fields, and not a periodical's.
 *
 * The catalogue registers a magazine or journal once, as a title. What arrives
 * afterwards is issues: Volume 12 Issue 4, then Issue 5, and after a year's
 * worth they are bound into one volume. All of that is recorded per issue under
 * Periodicals, where it belongs — so asking for an issue number here would mean
 * writing one number onto a title that will hold a hundred of them.
 *
 * Author goes with it: a journal has no single author, it has an author per
 * article. So does Price: what is paid is a year's subscription, recorded
 * against that subscription, not a cover price against the title.
 */
export function usesBookOnlyFields(bookType: string): boolean {
	return !isPeriodicalType(bookType)
}

/** The same three, by column key, for the sheet that has to leave them out. */
export const BOOK_ONLY_KEYS: string[] = ['author', 'edition', 'price']

/**
 * Every book on the shelf is owned by a department. A magazine or journal sits
 * in the reading room for the whole college, so the register does not make the
 * librarian invent a department for it.
 */
export function departmentRequiredFor(bookType: string): boolean {
	return !isPeriodicalType(bookType)
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
	/**
	 * Older wordings of the same column, still accepted on upload.
	 *
	 * A header printed into thousands of sheets cannot be renamed and then
	 * refused — a librarian holding a part-filled sheet from last week would be
	 * told it "is not the template". The new wording is what gets downloaded;
	 * the old one keeps working.
	 */
	altHeaders?: string[]
}

/** Spaces, capitals and punctuation are noise when matching a column header. */
export function normaliseTemplateHeader(header: string): string {
	return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The column a sheet's header stands for, whatever wording it was written in. */
export function templateColumnFor(
	columns: TemplateColumn[],
	header: string
): TemplateColumn | undefined {
	const wanted = normaliseTemplateHeader(header)
	return columns.find(column =>
		normaliseTemplateHeader(column.header) === wanted ||
		(column.altHeaders ?? []).some(alt => normaliseTemplateHeader(alt) === wanted)
	)
}

export const TEMPLATE_COLUMNS: TemplateColumn[] = [
	{ key: 'accession_number', header: 'Accession Number', required: true, note: 'The number written in the book. Must not repeat.' },
	{ key: 'title', header: 'Title', required: true },
	{ key: 'subtitle', header: 'Sub-Title', required: false, note: 'Optional' },
	{ key: 'author', header: 'Author', required: true },
	// A book has an edition, a magazine or journal has an issue — one column
	// holds whichever the material has, so the header says both
	{ key: 'edition', header: 'Edition/Issue', required: true, note: 'For a book the edition, e.g. 3rd. For a magazine or journal the issue, e.g. Vol 12 Issue 4', altHeaders: ['Edition'] },
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
	{ key: 'accession_date', header: 'Date of Adding', required: true, note: '2026-08-12 or 12-08-2026 — day first when there is a doubt' },
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
 * Who supplies a magazine or journal. Asked for by name, not by any id — the
 * librarian filling a sheet knows the vendor's name and nothing else.
 *
 * A name new to this college is added to its supplier list rather than refused:
 * Acquisition → Suppliers is not in use yet, so there is no list to be spelt
 * correctly against, and a sheet must not be rejected for saying something true.
 */
export const SUPPLIER_COLUMN: TemplateColumn = {
	key: 'supplier',
	header: 'Supplier',
	required: false,
	note: 'The vendor this comes from, written as it appears on the invoice. Leave blank if there is none.',
	altHeaders: ['Supplier Name', 'Vendor'],
}

/**
 * The two sheets, because the two kinds of material genuinely differ.
 *
 * A book has an ISBN and belongs to a department. A magazine or journal has an
 * ISSN, comes from a supplier, and sits in the reading room rather than under
 * any one department. One sheet carrying every column would ask each librarian
 * to leave a third of it blank and to work out which third — so there are two,
 * both cut from the list above so neither can drift away from it.
 */
export type CatalogueSheetKind = 'books' | 'periodicals'

export const CATALOGUE_SHEET_LABELS: Record<CatalogueSheetKind, string> = {
	books: 'Books',
	periodicals: 'Magazine & Journals',
}

export function templateColumnsFor(kind: CatalogueSheetKind): TemplateColumn[] {
	if (kind === 'books') {
		// No ISSN: a book was never issued one, and an empty column invites a
		// number copied from somewhere else.
		return TEMPLATE_COLUMNS
			.filter(column => column.key !== 'issn')
			.map(column => column.key === 'isbn'
				? { ...column, required: true, note: 'Every book has one. It is what groups copies of the same book together.' }
				: column)
	}

	const columns: TemplateColumn[] = []
	for (const column of TEMPLATE_COLUMNS) {
		// No ISBN on a periodical, and the department is not forced
		if (column.key === 'isbn') continue
		// Nor an author, an issue number or a price — see usesBookOnlyFields. A
		// sheet carrying them would ask the librarian to write one issue number
		// against a title that will go on to hold a hundred.
		if (BOOK_ONLY_KEYS.includes(column.key)) continue
		if (column.key === 'issn') {
			columns.push({ ...column, note: 'The ISSN printed on the issue. Leave blank if it does not print one.' })
			continue
		}
		if (column.key === 'department') {
			columns.push({ ...column, required: false, note: 'Optional — fill it only if your library shelves this under one department.' })
			continue
		}
		columns.push(column)
		// Beside the publisher, where the librarian is already looking
		if (column.key === 'publisher_place') columns.push(SUPPLIER_COLUMN)
	}
	return columns
}

/**
 * The rules one uploaded row is judged by, chosen from what the row says it is.
 *
 * This is what lets a single sheet hold both — and what stops a Books sheet from
 * demanding a department of the one magazine somebody typed into it.
 */
export function templateColumnsForBookType(bookType: string): TemplateColumn[] {
	if (isPeriodicalType(bookType)) return templateColumnsFor('periodicals')
	// ISBN is required of Books alone. Projects and Others go on the Books sheet
	// and were never issued one, so the column stays optional for them.
	return templateColumnsFor('books').map(column =>
		column.key === 'isbn' ? { ...column, required: isbnRequiredFor(bookType) } : column
	)
}

/** The filled example row for each sheet, so the shape is seen and not guessed. */
export function templateExampleFor(kind: CatalogueSheetKind): Record<string, string> {
	if (kind === 'books') return TEMPLATE_EXAMPLE
	// No author, issue number or price: those columns are not on this sheet
	return {
		...TEMPLATE_EXAMPLE,
		author: '',
		edition: '',
		price: '',
		title: 'Dental Clinics of North America',
		subtitle: '',
		publisher_name: 'Elsevier',
		publisher_place: 'Philadelphia',
		publication_year: '2024',
		isbn: '',
		issn: '0011-8532',
		book_type: 'Journals',
		pages: '180',
		call_number: '',
		classification_number: '',
		reference_only: 'Non-lendable',
		department: '',
		supplier: 'Universal Book Agency',
		book_location: 'Reading Room / Rack 1',
	}
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
