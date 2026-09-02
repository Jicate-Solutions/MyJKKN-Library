'use client'

/**
 * One button for the whole sheet route: download the template, fill it, upload
 * it back through the same menu.
 *
 * The template is built from TEMPLATE_COLUMNS — the list the form and the
 * server both validate against — so a sheet that came out of this button can
 * never carry a column the server does not know.
 *
 * Cut per sheet by `uploadColumnsFor`, so each one asks exactly what the Add
 * Title form asks for that material and nothing more. A magazine sheet
 * therefore has no Accession Number, Total Pages, Call Number, Classification
 * Number or Reference Only column: the form does not ask a magazine for any of
 * them, and a column whose answer is thrown away is a column that should not
 * have been printed.
 */

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/common/use-toast'
import { FileSpreadsheet, Download, Upload, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import { BulkProgressDialog } from '@/components/library/bulk-progress-dialog'
import {
	uploadColumnsFor,
	templateExampleFor,
	departmentsFor,
	templateColumnFor,
	bookTypesForSheet,
	CATALOGUE_SHEET_LABELS,
	LANGUAGES,
	type CatalogueSheetKind,
	type TemplateColumn,
} from '@/lib/library/catalogue-options'

/** Both sheets, so an upload can be matched against whichever one it came from. */
const SHEET_KINDS: CatalogueSheetKind[] = ['books', 'periodicals']

/** Every column either sheet can carry, for reading a file's headers back. */
const ALL_COLUMNS: TemplateColumn[] = (() => {
	const byKey = new Map<string, TemplateColumn>()
	for (const kind of SHEET_KINDS) {
		for (const column of uploadColumnsFor(kind)) {
			if (!byKey.has(column.key)) byKey.set(column.key, column)
		}
	}
	return [...byKey.values()]
})()

/**
 * Books per request.
 *
 * The sheet is sent in batches for one reason: a single request tells the
 * screen nothing until it is over, and a librarian watching a still page for a
 * minute assumes it has hung. Small enough that the bar moves, large enough
 * that a full sheet is not a hundred round trips.
 */
const BATCH_SIZE = 50

interface RowFailure {
	row: number
	accession_number: string
	error: string
}

interface UploadResult {
	created: number
	/** Books that were the first of their title */
	new_titles: number
	/** Books that joined a title already on the shelf as another copy */
	copies_added: number
	failed: number
	total: number
	failures: RowFailure[]
}

interface Props {
	institutionId: string | null
	/** Decides which departments the template lists and the sheet accepts. */
	institutionCode: string | null | undefined
	/** Called after a successful upload so the list behind the dialog refreshes. */
	onUploaded: () => void
	disabled?: boolean
}

/** Excel gives dates back as Date objects; the server wants YYYY-MM-DD. */
function cellToText(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (value instanceof Date) {
		const offset = value.getTimezoneOffset() * 60000
		return new Date(value.getTime() - offset).toISOString().split('T')[0]
	}
	return value.toString().trim()
}

export function CatalogueBulkUpload({ institutionId, institutionCode, onUploaded, disabled }: Props) {
	const departments = departmentsFor(institutionCode)
	const { toast } = useToast()
	const fileInput = useRef<HTMLInputElement>(null)
	const [uploading, setUploading] = useState(false)
	const [progress, setProgress] = useState({ done: 0, total: 0 })
	const [result, setResult] = useState<UploadResult | null>(null)

	const downloadTemplate = (kind: CatalogueSheetKind) => {
		const columns = uploadColumnsFor(kind)
		const example = templateExampleFor(kind)
		const isBooks = kind === 'books'
		const label = CATALOGUE_SHEET_LABELS[kind]

		const headers = columns.map(c => c.required ? `${c.header} *` : c.header)
		const exampleRow = columns.map(c => example[c.key] ?? '')

		const rows = XLSX.utils.aoa_to_sheet([headers, exampleRow])
		// Wide enough to read the header without dragging every column open
		rows['!cols'] = columns.map(c => ({ wch: Math.max(16, c.header.length + 4) }))

		const guide = XLSX.utils.aoa_to_sheet([
			['Column', 'Must fill?', 'What to write'],
			...columns.map(c => [c.header, c.required ? 'Yes' : 'Optional', c.note ?? '']),
			[],
			[
				'Departments',
				'',
				departments.length > 0
					? departments.join(', ')
					: 'Your list is not set up yet — type the department name and it will be accepted',
			],
			[
				'Book Types',
				'',
				isBooks
					? 'Books / Projects / Others — put magazines and journals on the Magazine & Journals sheet instead'
					: 'Magazine / Journals — put books on the Books sheet instead',
			],
			['Languages', '', LANGUAGES.join(', ')],
			[],
			[`This is the ${label} sheet. It takes only these Book Types: ${bookTypesForSheet(kind).join(', ')}. A row saying anything else is skipped and reported.`],
			['Row 2 is a filled example — delete it before uploading, or leave it and it will be saved.'],
			['As many rows as you like in one file — a long sheet simply takes longer.'],
			['Do not rename or reorder the columns.'],
		])
		guide['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 90 }]

		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, rows, isBooks ? 'Books' : 'Magazines & Journals')
		XLSX.utils.book_append_sheet(book, guide, 'How to fill')
		XLSX.writeFile(book, isBooks
			? 'library-book-upload-template.xlsx'
			: 'library-magazine-journal-upload-template.xlsx')
	}

	const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		// Cleared straight away so picking the same file twice still fires onChange
		event.target.value = ''
		if (!file) return

		if (!institutionId) {
			toast({ title: '❌ Select a college first', variant: 'destructive' })
			return
		}

		try {
			setUploading(true)

			const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
			const sheet = workbook.Sheets[workbook.SheetNames[0]]
			const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })

			if (grid.length < 2) {
				toast({ title: '❌ The sheet has a header but no books under it', variant: 'destructive' })
				return
			}

			// Match the file's headers back to our keys, so a column the librarian
			// moved still lands in the right place and a stray extra column is
			// ignored rather than shifting everything after it.
			// A column renamed since a sheet was downloaded is still recognised —
			// "Edition" and "Edition/Issue" are the same column
			const headerRow = (grid[0] as unknown[]).map(h => cellToText(h).replace(/\*/g, ''))
			const keyByIndex = headerRow.map(h => templateColumnFor(ALL_COLUMNS, h)?.key ?? null)

			// Either sheet is accepted, so the file is measured against both and
			// judged by whichever it is closer to. A Books sheet is then never told
			// it is missing an ISSN column, nor a magazine sheet an ISBN one.
			const shortfalls = SHEET_KINDS.map(kind => ({
				kind,
				missing: uploadColumnsFor(kind)
					.filter(c => c.required && !keyByIndex.includes(c.key))
					.map(c => c.header),
			}))
			const closest = shortfalls.reduce((best, next) =>
				next.missing.length < best.missing.length ? next : best
			)

			if (closest.missing.length > 0) {
				toast({
					title: '❌ This is not a template',
					description: `Closest to the ${CATALOGUE_SHEET_LABELS[closest.kind]} sheet, but missing: ${closest.missing.join(', ')}. Download a template and fill that.`,
					variant: 'destructive',
				})
				return
			}

			const rows = grid.slice(1)
				.map(line => {
					const row: Record<string, string> = {}
					keyByIndex.forEach((key, index) => {
						if (key) row[key] = cellToText((line as unknown[])[index])
					})
					return row
				})
				// A row where every cell is blank is spacing, not a book
				.filter(row => Object.values(row).some(v => v !== ''))

			if (rows.length === 0) {
				toast({ title: '❌ No filled rows found in the sheet', variant: 'destructive' })
				return
			}

			// Sent batch by batch so the screen can show how far it has got. The
			// counts add up across batches; a batch that fails outright stops the
			// run rather than leaving the librarian to guess where it stopped.
			setProgress({ done: 0, total: rows.length })

			const total: UploadResult = {
				created: 0, new_titles: 0, copies_added: 0,
				failed: 0, total: rows.length, failures: [],
			}

			for (let start = 0; start < rows.length; start += BATCH_SIZE) {
				const batch = rows.slice(start, start + BATCH_SIZE)

				const res = await fetch('/api/lib/catalogue/bulk', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						institution_id: institutionId,
						rows: batch,
						row_offset: start,
						// Which template this file is, worked out from its own headers above.
						// The server refuses a row that belongs on the other sheet, and it
						// cannot tell from a bare list of rows which sheet they came from.
						sheet_kind: closest.kind,
					}),
				})
				const data = await res.json()

				if (!res.ok) {
					if (total.created > 0) onUploaded()
					toast({
						title: '❌ ' + (data.error ?? 'Upload failed'),
						description: total.created > 0 ? `${total.created} books were added before this.` : undefined,
						variant: 'destructive',
					})
					return
				}

				total.created += data.created ?? 0
				total.new_titles += data.new_titles ?? 0
				total.copies_added += data.copies_added ?? 0
				total.failed += data.failed ?? 0
				total.failures.push(...(data.failures ?? []))

				setProgress({ done: Math.min(start + batch.length, rows.length), total: rows.length })
			}

			setResult(total)
			if (total.created > 0) onUploaded()
		} catch (err) {
			toast({
				title: '❌ Could not read the file',
				description: err instanceof Error ? err.message : 'Make sure it is the .xlsx template',
				variant: 'destructive',
			})
		} finally {
			setUploading(false)
			setProgress({ done: 0, total: 0 })
		}
	}

	return (
		<>
			<BulkProgressDialog
				open={uploading}
				title="Adding books"
				done={progress.done}
				total={progress.total}
				note="Books already added are saved even if something fails later."
			/>

			<input
				ref={fileInput}
				type="file"
				accept=".xlsx,.xls"
				className="hidden"
				onChange={handleFile}
			/>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="h-8 text-sm px-3" disabled={disabled || uploading}>
						<FileSpreadsheet className="h-4 w-4 mr-1.5" />
						<span className="hidden sm:inline">{uploading ? 'Uploading...' : 'Bulk Upload'}</span>
						<span className="sm:hidden">Bulk</span>
						<ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-72">
					<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
						Add many at once
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{/* Two sheets, because the two ask for different things: a book has
					    an ISBN and a department, a magazine or journal an ISSN and a
					    supplier. One sheet would leave a third of every row blank. */}
					<DropdownMenuItem onClick={() => downloadTemplate('books')} className="gap-2 py-2.5">
						<Download className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Template — Books</p>
							<p className="text-xs text-muted-foreground">ISBN and department. Projects and Others go here too.</p>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => downloadTemplate('periodicals')} className="gap-2 py-2.5">
						<Download className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Template — Magazine &amp; Journals</p>
							<p className="text-xs text-muted-foreground">ISSN and supplier, department optional</p>
						</div>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => fileInput.current?.click()} className="gap-2 py-2.5">
						<Upload className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Upload filled sheet</p>
							<p className="text-xs text-muted-foreground">Either sheet, any number of rows</p>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* What actually went in, and what did not */}
			<Dialog open={!!result} onOpenChange={o => { if (!o) setResult(null) }}>
				<DialogContent className="sm:max-w-[640px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							{result && result.failed === 0
								? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
								: <AlertTriangle className="h-5 w-5 text-amber-500" />}
							Upload finished
						</DialogTitle>
						<DialogDescription>
							{result && (
								<>
									<span className="font-medium text-emerald-700">{result.created}</span> book{result.created !== 1 ? 's' : ''} added
									{/* Copies matter here: a sheet of 40 rows that makes 12 titles is
									    not a mistake, it is 28 duplicate copies correctly recognised —
									    but the librarian should be told, not left to notice */}
									{result.copies_added > 0 && (
										<> — {result.new_titles} new title{result.new_titles !== 1 ? 's' : ''},{' '}
											{result.copies_added} added as another copy of a book already held</>
									)}
									{result.failed > 0 && (
										<> · <span className="font-medium text-red-600">{result.failed}</span> skipped out of {result.total}</>
									)}
								</>
							)}
						</DialogDescription>
					</DialogHeader>

					{result && result.failures.length > 0 && (
						<div className="rounded-md border max-h-[320px] overflow-auto">
							<Table>
								<TableHeader className="sticky top-0 bg-muted/50">
									<TableRow>
										<TableHead className="text-xs font-semibold w-16">Row</TableHead>
										<TableHead className="text-xs font-semibold w-32">Accession</TableHead>
										<TableHead className="text-xs font-semibold">Why it was skipped</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{result.failures.map(f => (
										<TableRow key={`${f.row}-${f.accession_number}`}>
											<TableCell className="text-sm tabular-nums">{f.row}</TableCell>
											<TableCell className="text-sm font-mono">{f.accession_number || '—'}</TableCell>
											<TableCell className="text-sm text-muted-foreground">{f.error}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}

					{result && result.failed > 0 && (
						<p className="text-xs text-muted-foreground">
							The books that went in are saved. Fix only these rows in your sheet and upload it again —
							anything already added will be reported as a repeated accession number, not added twice.
						</p>
					)}

					<DialogFooter>
						<Button onClick={() => setResult(null)}>Close</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
