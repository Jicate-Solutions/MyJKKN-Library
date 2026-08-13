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
	language: string
	pages: string
	call_number: string
	classification_number: string
	is_reference_only: boolean
	department: string
	book_location: string
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

export function CatalogueTitleForm<T extends TitleFormFields>({ form, setForm, errors, showCopySection, institutionCode }: Props<T>) {
	const set = (patch: Partial<TitleFormFields>) => setForm(f => ({ ...f, ...patch }))
	const departments = departmentsFor(institutionCode)

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
			{showCopySection && (
				<Section title="The Book in Hand" hint="Saving records this book as copy 1. Further copies are added from the title's own page.">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{field('accession_number', 'Accession Number', true, { placeholder: 'The number written in this book', mono: true })}
						{field('accession_date', 'Date of Adding', true, { type: 'date' })}
					</div>
				</Section>
			)}

			<Section title="Book Details">
				{field('title', 'Title', true, { placeholder: 'Full title as printed on the book' })}
				{field('subtitle', 'Sub-Title', false, { placeholder: 'Optional' })}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('author', 'Author', true, { placeholder: 'e.g. C.K. Kokate' })}
					{field('edition', 'Edition', true, { placeholder: 'e.g. 3rd' })}
				</div>
			</Section>

			<Section title="What It Is">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Book Type <Required /></Label>
						<Select value={form.book_type} onValueChange={v => set({ book_type: v })}>
							<SelectTrigger className={errors.book_type ? 'border-red-500' : ''}>
								<SelectValue placeholder="Choose" />
							</SelectTrigger>
							<SelectContent>
								{BOOK_TYPES.map(t => <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>)}
							</SelectContent>
						</Select>
						{errors.book_type && <p className="text-xs text-red-500">{errors.book_type}</p>}
					</div>
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
				</div>

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

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('pages', 'Total Pages', true, { type: 'number', placeholder: 'e.g. 624' })}
					<div className="space-y-2">
						<Label className="text-sm font-semibold">Reference Only <Required /></Label>
						<Select
							value={form.is_reference_only ? 'Non-lendable' : 'Lendable'}
							onValueChange={v => set({ is_reference_only: v === 'Non-lendable' })}
						>
							<SelectTrigger><SelectValue /></SelectTrigger>
							<SelectContent>
								{LENDABLE_OPTIONS.map(o => <SelectItem key={o.label} value={o.label}>{o.label}</SelectItem>)}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Non-lendable books stay in the library and cannot be issued.
						</p>
					</div>
				</div>
			</Section>

			<Section title="Publication">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('publisher_name', 'Publisher Name', true, { placeholder: 'e.g. Nirali Prakashan' })}
					{field('publisher_place', 'Place', true, { placeholder: 'City' })}
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('publication_year', 'Year', true, { placeholder: '2024' })}
					{field('price', 'Price (INR)', true, { type: 'number', placeholder: '0.00' })}
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
					<Label className="text-sm font-semibold">Department <Required /></Label>
					{/* A college whose list we have picks from it; one whose list has
					    not come in yet types the name. Offering another college's
					    departments would be worse than offering none. */}
					{departments.length > 0 ? (
						<Select value={form.department} onValueChange={v => set({ department: v })}>
							<SelectTrigger className={errors.department ? 'border-red-500' : ''}>
								<SelectValue placeholder="Choose department" />
							</SelectTrigger>
							<SelectContent>
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
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{field('call_number', 'Call Number', false, { placeholder: '615.321 KOK', mono: true })}
					{field('classification_number', 'Classification Number', false, { placeholder: '615.321', mono: true })}
				</div>
			</Section>
		</>
	)
}
