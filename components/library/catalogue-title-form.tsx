'use client'

/**
 * The Add Title form, as the accession register wants it. Every campus enters
 * books this way.
 *
 * The order follows the register itself: the number and the book, then what it
 * physically is, then who published it, then where it lives in the library. A
 * librarian copying from the register reads straight down and types straight
 * down.
 *
 * The only per-college part is the department list — see `departmentsFor`.
 */

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	departmentsFor,
	BOOK_TYPES,
	LANGUAGES,
	LENDABLE_OPTIONS,
	OTHER_BOOK_TYPE,
	isbnRequiredFor,
	usesIssn,
	usesSupplier,
	usesBookOnlyFields,
	departmentRequiredFor,
	usesTypedAccessionNumber,
	usesPageCount,
	usesShelfMarks,
	usesPeriodicalScope,
	PERIODICAL_SCOPES,
	isReferenceOnlyForced,
	isPeriodicalType,
	PERIODICAL_ACCESSION_PREFIX,
} from '@/lib/library/catalogue-options'

export interface TitleFormFields {
	accession_number: string
	accession_date: string
	title: string
	subtitle: string
	author: string
	edition: string
	publisher_name: string
	publisher_place: string
	publication_year: string
	price: string
	isbn: string
	issn: string
	book_type: string
	book_type_other: string
	/** National or International. Magazines and journals only — see the field. */
	periodical_scope: string
	language: string
	pages: string
	call_number: string
	classification_number: string
	is_reference_only: boolean
	department: string
	book_location: string
	/**
	 * The vendor this copy came from, as the librarian writes it. Asked for on
	 * magazines and journals only, and typed rather than chosen — see the field
	 * itself for why.
	 */
	supplier_name: string
}

interface Props<T extends TitleFormFields> {
	form: T
	setForm: React.Dispatch<React.SetStateAction<T>>
	errors: Record<string, string>
	/** Hidden while editing — an existing copy's number is changed on its own page. */
	showCopySection: boolean
	/** Decides which department list the form offers. */
	institutionCode: string | null | undefined
}

function Required() {
	return <span className="text-red-500">*</span>
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
	return (
		<div className="space-y-4 pt-2 first:pt-0 [&:not(:first-child)]:border-t">
			<div className="pt-2 first:pt-0">
				<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
				{hint && <p className="text-xs text-muted-foreground/80 mt-1">{hint}</p>}
			</div>
			{children}
		</div>
	)
}

export function CatalogueTitleForm<T extends TitleFormFields>({
	form, setForm, errors, showCopySection, institutionCode,
}: Props<T>) {
	const set = (patch: Partial<TitleFormFields>) => setForm(f => ({ ...f, ...patch }))
	const departments = departmentsFor(institutionCode)
	const departmentRequired = departmentRequiredFor(form.book_type)
	const showSupplier = showCopySection && usesSupplier(form.book_type)
	/** Author, Edition/Issue and Price belong to a book, not to a periodical. */
	const bookOnly = usesBookOnlyFields(form.book_type)
	/** A book's number is written inside it; a magazine's is allotted. */
	const typedAccession = usesTypedAccessionNumber(form.book_type)
	const showPages = usesPageCount(form.book_type)
	/** Call Number and Classification Number — a shelved book's, not a periodical's. */
	const showShelfMarks = usesShelfMarks(form.book_type)
	/** National or International — asked of a magazine or journal, never of a book. */
	const showPeriodicalScope = usesPeriodicalScope(form.book_type)
	const lendingFixed = isReferenceOnlyForced(form.book_type)

	/**
	 * Choosing Magazine or Journals settles Reference Only on the spot.
	 *
	 * Set here rather than only on save so the librarian sees the answer the
	 * moment they pick the type, instead of a field that says Lendable and then
	 * saves as something else. Switching back to Books leaves the value alone —
	 * the field is editable again, and a non-lendable book is a real thing.
	 */
	const chooseBookType = (value: string) =>
		set(isReferenceOnlyForced(value)
			? { book_type: value, is_reference_only: true }
			: { book_type: value })

	const field = (name: keyof TitleFormFields, label: string, required: boolean, extra?: {
		placeholder?: string
		type?: string
		mono?: boolean
	}) => (
		<div className="space-y-2">
			<Label className="text-sm font-semibold">{label} {required && <Required />}</Label>
			<Input
				type={extra?.type}
				value={form[name] as string}
				onChange={e => set({ [name]: e.target.value } as Partial<TitleFormFields>)}
				className={`${extra?.mono ? 'font-mono' : ''} ${errors[name as string] ? 'border-red-500' : ''}`}
				placeholder={extra?.placeholder}
			/>
			{errors[name as string] && <p className="text-xs text-red-500">{errors[name as string]}</p>}
		</div>
	)

	return (
		<>
			{/* First, because the rest of the form follows from it: a book is asked
			    for its ISBN and its department, a magazine or journal for its ISSN
			    and its supplier. Asking this last would mean fields changing under
			    a librarian who had already filled them in. */}
			<Section title="What Are You Adding?">
				<div className="space-y-2">
					<Label className="text-sm font-semibold">Book Type <Required /></Label>
					<Select value={form.book_type} onValueChange={chooseBookType}>
						<SelectTrigger className={errors.book_type ? 'border-red-500' : ''}>
							<SelectValue placeholder="Choose" />
						</SelectTrigger>
						<SelectContent>
							{BOOK_TYPES.map(t => <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>)}
						</SelectContent>
					</Select>
					{errors.book_type
						? <p className="text-xs text-red-500">{errors.book_type}</p>
						: <p className="text-xs text-muted-foreground">
							{isPeriodicalType(form.book_type)
								? `A magazine or journal is asked for its ISSN and its supplier, is numbered ${PERIODICAL_ACCESSION_PREFIX}1, ${PERIODICAL_ACCESSION_PREFIX}2… automatically, and never leaves the library.`
								: 'This decides what the rest of the form asks for.'}
						</p>}
				</div>

				{/* Straight after Book Type, because it is the same question asked one
				    level down — and a librarian who has just chosen Journals is
				    already looking here. Not shown for a book: nobody classes a
				    textbook as national or international. */}
				{showPeriodicalScope && (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Journal/Magazine Type <Required /></Label>
						<Select value={form.periodical_scope} onValueChange={v => set({ periodical_scope: v })}>
							<SelectTrigger className={errors.periodical_scope ? 'border-red-500' : ''}>
								<SelectValue placeholder="Choose" />
							</SelectTrigger>
							<SelectContent>
								{PERIODICAL_SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
							</SelectContent>
						</Select>
						{errors.periodical_scope
							? <p className="text-xs text-red-500">{errors.periodical_scope}</p>
							: <p className="text-xs text-muted-foreground">
								Whether this is a national or an international title — the split the
								library is asked for in its yearly returns.
							</p>}
					</div>
				)}

				{/* Only asked once Others is chosen, so the common case stays two clicks */}
				{form.book_type === OTHER_BOOK_TYPE && (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">What kind? <Required /></Label>
						<Input
							value={form.book_type_other}
							onChange={e => set({ book_type_other: e.target.value })}
							className={errors.book_type_other ? 'border-red-500' : ''}
							placeholder="Type what this material is"
						/>
						{errors.book_type_other && <p className="text-xs text-red-500">{errors.book_type_other}</p>}
					</div>
				)}
			</Section>

			{showCopySection && (
				<Section title="The Book in Hand" hint="Saving records this book as copy 1. Further copies are added from the title's own page.">
					{/* Nobody writes an accession number on the cover of a magazine, so
					    asking for one would only get an invented number typed in. The
					    register allots the next in this college's own JM series on saving,
					    so the field is not shown at all rather than shown as something the
					    librarian can neither fill in nor change — the book type's own hint
					    above already says the number is coming. */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{typedAccession &&
							field('accession_number', 'Accession Number', true, { placeholder: 'The number written in this book', mono: true })}
						{field('accession_date', 'Date of Adding', true, { type: 'date' })}
					</div>
				</Section>
			)}

			<Section title="Book Details">
				{field('title', 'Title', true, { placeholder: 'Full title as printed on the book' })}
				{field('subtitle', 'Sub-Title', false, { placeholder: 'Optional' })}
				{/* Not asked of a magazine or journal: it has an author per article
				    rather than one of its own, and its issue numbers are recorded
				    issue by issue under Periodicals, not once against the title. */}
				{bookOnly && (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{field('author', 'Author', true, { placeholder: 'e.g. C.K. Kokate' })}
						{field('edition', 'Edition/Issue', true, { placeholder: 'e.g. 3rd' })}
					</div>
				)}
			</Section>

			<Section title="What It Is">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Language <Required /></Label>
						<Select value={form.language} onValueChange={v => set({ language: v })}>
							<SelectTrigger className={errors.language ? 'border-red-500' : ''}>
								<SelectValue placeholder="Choose" />
							</SelectTrigger>
							<SelectContent>
								{LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
							</SelectContent>
						</Select>
						{errors.language && <p className="text-xs text-red-500">{errors.language}</p>}
					</div>
					{/* A book has one page count for its whole life. A magazine title
					    will hold a hundred issues of different lengths, so a single
					    figure written against the title says nothing — the same reason
					    its issue number is not asked for here. */}
					{showPages && field('pages', 'Total Pages', true, { type: 'number', placeholder: 'e.g. 624' })}
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Reference Only {!lendingFixed && <Required />}</Label>
						{/* Not a choice for a magazine or journal: every college keeps
						    the current issues in the reading room and they do not go
						    out. Left editable, one mis-click would put a journal on
						    loan, and once it is out the desk cannot tell it apart from
						    a book that was meant to go. */}
						<Select
							value={form.is_reference_only ? 'Non-lendable' : 'Lendable'}
							onValueChange={v => set({ is_reference_only: v === 'Non-lendable' })}
							disabled={lendingFixed}
						>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{LENDABLE_OPTIONS.map(o => <SelectItem key={o.label} value={o.label}>{o.label}</SelectItem>)}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{lendingFixed
								? 'Magazines and journals stay in the reading room, so this is fixed at Non-lendable and cannot be issued or returned.'
								: 'Non-lendable books stay in the library and cannot be issued.'}
						</p>
					</div>
				</div>
			</Section>

			<Section title="Publication">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('publisher_name', 'Publisher Name', true, { placeholder: 'e.g. Nirali Prakashan' })}
					{field('publisher_place', 'Place', true, { placeholder: 'City' })}
				</div>

				{/* A magazine or journal arrives from a vendor, and the library pays
				    that vendor for the subscription. A book does not carry one here —
				    its supplier belongs to the purchase order.

				    Typed, not chosen from a list: Acquisition → Suppliers is not in
				    use yet, so a dropdown would offer nothing and the librarian
				    could not record the vendor at all. What is typed is remembered
				    under this college's suppliers, so the list fills itself and is
				    already there when that screen is put to work. */}
				{showSupplier && (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Supplier</Label>
						<Input
							value={form.supplier_name}
							onChange={e => set({ supplier_name: e.target.value })}
							placeholder="e.g. Universal Book Agency"
						/>
						<p className="text-xs text-muted-foreground">
							Who this magazine or journal comes from. Leave it blank if it is not bought from a vendor.
						</p>
					</div>
				)}

				{/* What a library pays for a magazine or journal is a year's
				    subscription, recorded against that subscription — not a cover
				    price against the title, so it is not asked for here. */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('publication_year', 'Year', true, { placeholder: '2024' })}
					{bookOnly && field('price', 'Price (INR)', true, { type: 'number', placeholder: '0.00' })}
				</div>

				{/* A book carries an ISBN, a magazine or journal carries an ISSN, and
				    neither exists on a project report. Asking for the wrong one is
				    how blank and invented numbers get typed in — and an invented
				    number would group two unrelated books into one title. */}
				{usesIssn(form.book_type) ? (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">ISSN</Label>
						<Input
							value={form.issn}
							onChange={e => set({ issn: e.target.value })}
							className="font-mono"
							placeholder="XXXX-XXXX"
						/>
						<p className="text-xs text-muted-foreground">
							Leave it blank if this issue does not print one.
						</p>
					</div>
				) : (
					<div className="space-y-2">
						<Label className="text-sm font-semibold">
							ISBN {isbnRequiredFor(form.book_type) && <Required />}
						</Label>
						<Input
							value={form.isbn}
							onChange={e => set({ isbn: e.target.value })}
							className={`font-mono ${errors.isbn ? 'border-red-500' : ''}`}
							placeholder="978-..."
						/>
						{errors.isbn
							? <p className="text-xs text-red-500">{errors.isbn}</p>
							: <p className="text-xs text-muted-foreground">
								{isbnRequiredFor(form.book_type)
									? 'Two books sharing an ISBN are the same book, so this is what groups copies together.'
									: 'Only fill this if the material actually prints one.'}
							</p>}
					</div>
				)}
			</Section>

			<Section title="Where It Belongs">
				<div className="space-y-2">
					{/* A book belongs to a department; a magazine or journal sits in the
					    reading room, so it is offered rather than demanded. */}
					<Label className="text-sm font-semibold">Department {departmentRequired && <Required />}</Label>
					{/* A college whose list we have picks from it; one whose list has
					    not come in yet types the name. Offering another college's
					    departments would be worse than offering none. */}
					{departments.length > 0 ? (
						<Select
							value={form.department || 'none'}
							onValueChange={v => set({ department: v === 'none' ? '' : v })}
						>
							<SelectTrigger className={errors.department ? 'border-red-500' : ''}>
								<SelectValue placeholder="Choose department" />
							</SelectTrigger>
							<SelectContent>
								{/* Offered only where it is allowed to be blank, so a book
								    cannot quietly end up without one. */}
								{!departmentRequired && <SelectItem value="none">No department</SelectItem>}
								{departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
							</SelectContent>
						</Select>
					) : (
						<>
							<Input
								value={form.department}
								onChange={e => set({ department: e.target.value })}
								className={errors.department ? 'border-red-500' : ''}
								placeholder="Type the department name"
							/>
							<p className="text-xs text-muted-foreground">
								Your college&apos;s department list is not set up yet, so type it for now.
							</p>
						</>
					)}
					{errors.department && <p className="text-xs text-red-500">{errors.department}</p>}
				</div>
				{field('book_location', 'Book Location', false, { placeholder: 'e.g. Beero 2 / Rack 3' })}
				{/* Where a book sits on the shelf. A magazine or journal is not shelved
				    by a class mark — the current issues stand in the reading room by
				    title and the bound volumes by year — so neither number is asked for
				    here, and nothing is stored for them either. */}
				{showShelfMarks && (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{field('call_number', 'Call Number', false, { placeholder: '615.321 KOK', mono: true })}
						{field('classification_number', 'Classification Number', false, { placeholder: '615.321', mono: true })}
					</div>
				)}
			</Section>
		</>
	)
}
