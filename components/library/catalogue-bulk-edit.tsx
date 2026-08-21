'use client'

/**
 * Bulk edit, next to bulk upload and worked the same way: download, change,
 * upload back.
 *
 * The difference is what comes down. Upload hands out an empty template; this
 * hands out the college's own books, every field filled, each line carrying the
 * Book ID it is saved under. That id is what lets a line be read as a
 * correction — including a corrected accession number, which an upload sheet
 * could only ever read as a new book.
 */

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/common/use-toast'
import { FilePenLine, Download, Upload, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import { BulkProgressDialog } from '@/components/library/bulk-progress-dialog'
import {
	TEMPLATE_COLUMNS,
	EDIT_ID_COLUMN,
	departmentsFor,
	templateColumnFor,
	BOOK_TYPE_LABELS,
	LANGUAGES,
} from '@/lib/library/catalogue-options'

interface RowFailure {
	row: number
	book_id: string
	accession_number: string
	error: string
}

interface EditResult {
	updated: number
	/** Copies whose title or author changed, so they left their old book */
	moved: number
	failed: number
	total: number
	failures: RowFailure[]
}

interface Props {
	institutionId: string | null
	/** Decides which departments the sheet accepts. */
	institutionCode: string | null | undefined
	/** Called after a successful edit so the list behind the dialog refreshes. */
	onSaved: () => void
	disabled?: boolean
}

/** Every column of the edit sheet: the Book ID first, then the usual ones. */
const EDIT_COLUMNS = [EDIT_ID_COLUMN, ...TEMPLATE_COLUMNS]

/** Books per request — same reasoning as the upload side: a bar that moves. */
const BATCH_SIZE = 50

/** Excel gives dates back as Date objects; the server wants YYYY-MM-DD. */
function cellToText(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (value instanceof Date) {
		const offset = value.getTimezoneOffset() * 60000
		return new Date(value.getTime() - offset).toISOString().split('T')[0]
	}
	return value.toString().trim()
}

export function CatalogueBulkEdit({ institutionId, institutionCode, onSaved, disabled }: Props) {
	const departments = departmentsFor(institutionCode)
	const { toast } = useToast()
	const fileInput = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	/** What the progress modal says it is doing — downloading, or saving. */
	const [busyTitle, setBusyTitle] = useState('Working')
	const [progress, setProgress] = useState({ done: 0, total: 0 })
	const [result, setResult] = useState<EditResult | null>(null)

	const downloadBooks = async () => {
		if (!institutionId) {
			toast({ title: '❌ Select a college first', variant: 'destructive' })
			return
		}

		try {
			// Nothing to count while the server is gathering the books, so the bar
			// runs without a number until the file is written
			setBusyTitle('Preparing the sheet')
			setProgress({ done: 0, total: 0 })
			setBusy(true)

			const res = await fetch(`/api/lib/catalogue/bulk-edit?institution_id=${institutionId}`)
			const data = await res.json()

			if (!res.ok) {
				toast({ title: '❌ ' + (data.error ?? 'Could not load the books'), variant: 'destructive' })
				return
			}

			const rows: Array<Record<string, string>> = data.rows ?? []
			if (rows.length === 0) {
				toast({ title: 'No books to edit yet', description: 'Add books first, then come back to edit them in bulk' })
				return
			}

			const headers = EDIT_COLUMNS.map(c => c.required ? `${c.header} *` : c.header)
			const body = rows.map(row => EDIT_COLUMNS.map(c => row[c.key] ?? ''))

			const books = XLSX.utils.aoa_to_sheet([headers, ...body])
			books['!cols'] = EDIT_COLUMNS.map(c => ({ wch: Math.max(16, c.header.length + 4) }))

			const guide = XLSX.utils.aoa_to_sheet([
				['Column', 'Must fill?', 'What to write'],
				...EDIT_COLUMNS.map(c => [c.header, c.required ? 'Yes' : 'Optional', c.note ?? '']),
				[],
				[
					'Departments',
					'',
					departments.length > 0
						? departments.join(', ')
						: 'Your list is not set up yet — type the department name and it will be accepted',
				],
				['Book Types', '', BOOK_TYPE_LABELS.join(', ')],
				['Languages', '', LANGUAGES.join(', ')],
				[],
				['Change any field you like and upload this same file back.'],
				['Never change or delete the Book ID column — that is how each line finds its book.'],
				['A line you do not want changed can be left exactly as it is, or the whole row deleted.'],
				['Changing Title or Author moves that copy out of its book and files it under the new name —'],
				['the old book\'s copy count drops by one. Every other field is a correction to the book itself.'],
				['Deleting a row here does not delete the book. Use the register to remove a copy.'],
			])
			guide['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 90 }]

			const book = XLSX.utils.book_new()
			XLSX.utils.book_append_sheet(book, books, 'Books')
			XLSX.utils.book_append_sheet(book, guide, 'How to edit')
			XLSX.writeFile(book, 'library-books-bulk-edit.xlsx')
		} catch (err) {
			toast({
				title: '❌ Could not build the sheet',
				description: err instanceof Error ? err.message : 'Try again',
				variant: 'destructive',
			})
		} finally {
			setBusy(false)
			setProgress({ done: 0, total: 0 })
		}
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
			setBusy(true)

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
			const keyByIndex = headerRow.map(h => templateColumnFor(EDIT_COLUMNS, h)?.key ?? null)

			const missing = EDIT_COLUMNS
				.filter(c => c.required && !keyByIndex.includes(c.key))
				.map(c => c.header)

			if (missing.length > 0) {
				toast({
					title: '❌ This is not the edit sheet',
					description: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the books again and edit that file.`,
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

			// Sent batch by batch so the screen can show how far it has got
			setBusyTitle('Saving changes')
			setProgress({ done: 0, total: rows.length })

			const total: EditResult = { updated: 0, moved: 0, failed: 0, total: rows.length, failures: [] }

			for (let start = 0; start < rows.length; start += BATCH_SIZE) {
				const batch = rows.slice(start, start + BATCH_SIZE)

				const res = await fetch('/api/lib/catalogue/bulk-edit', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ institution_id: institutionId, rows: batch, row_offset: start }),
				})
				const data = await res.json()

				if (!res.ok) {
					if (total.updated > 0) onSaved()
					toast({
						title: '❌ ' + (data.error ?? 'Edit failed'),
						description: total.updated > 0 ? `${total.updated} books were updated before this.` : undefined,
						variant: 'destructive',
					})
					return
				}

				total.updated += data.updated ?? 0
				total.moved += data.moved ?? 0
				total.failed += data.failed ?? 0
				total.failures.push(...(data.failures ?? []))

				setProgress({ done: Math.min(start + batch.length, rows.length), total: rows.length })
			}

			setResult(total)
			if (total.updated > 0) onSaved()
		} catch (err) {
			toast({
				title: '❌ Could not read the file',
				description: err instanceof Error ? err.message : 'Make sure it is the .xlsx edit sheet',
				variant: 'destructive',
			})
		} finally {
			setBusy(false)
			setProgress({ done: 0, total: 0 })
		}
	}

	return (
		<>
			<BulkProgressDialog
				open={busy}
				title={busyTitle}
				done={progress.done}
				total={progress.total}
				note={busyTitle === 'Saving changes' ? 'Changes already saved stay saved even if something fails later.' : undefined}
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
					<Button variant="outline" className="h-8 text-sm px-3" disabled={disabled || busy}>
						<FilePenLine className="h-4 w-4 mr-1.5" />
						<span className="hidden sm:inline">{busy ? 'Working...' : 'Bulk Edit'}</span>
						<span className="sm:hidden">Edit</span>
						<ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-72">
					<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
						Change many books at once
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={downloadBooks} className="gap-2 py-2.5">
						<Download className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Download books</p>
							<p className="text-xs text-muted-foreground">Every book in this library, with its Book ID</p>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => fileInput.current?.click()} className="gap-2 py-2.5">
						<Upload className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Upload edited sheet</p>
							<p className="text-xs text-muted-foreground">Any number of books in one file</p>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* What actually changed, and what did not */}
			<Dialog open={!!result} onOpenChange={o => { if (!o) setResult(null) }}>
				<DialogContent className="sm:max-w-[640px]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							{result && result.failed === 0
								? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
								: <AlertTriangle className="h-5 w-5 text-amber-500" />}
							Edit finished
						</DialogTitle>
						<DialogDescription>
							{result && (
								<>
									<span className="font-medium text-emerald-700">{result.updated}</span> book{result.updated !== 1 ? 's' : ''} updated
									{/* A moved copy is the one change that alters another book's
									    count, so it is said out loud rather than left to be noticed */}
									{result.moved > 0 && (
										<> — {result.moved} of them had a new title or author, so {result.moved === 1 ? 'it was' : 'they were'} taken out of the old book&apos;s copy count</>
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
										<TableRow key={`${f.row}-${f.book_id}`}>
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
							The changes that went through are saved. Fix only these rows and upload the sheet again.
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
