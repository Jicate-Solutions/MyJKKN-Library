'use client'

/**
 * One button for the whole sheet route: download the template, fill it, upload
 * it back through the same menu.
 *
 * The template is built from TEMPLATE_COLUMNS — the list the form and the
 * server both validate against — so a sheet that came out of this button can
 * never carry a column the server does not know.
 */

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/common/use-toast'
import { FileSpreadsheet, Download, Upload, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
	TEMPLATE_COLUMNS,
	TEMPLATE_EXAMPLE,
	BULK_ROW_LIMIT,
	departmentsFor,
	BOOK_TYPE_LABELS,
	LANGUAGES,
} from '@/lib/library/catalogue-options'

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

/** "Publisher Name" and "publisher name " are the same column to us. */
function normaliseHeader(header: string): string {
	return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function CatalogueBulkUpload({ institutionId, institutionCode, onUploaded, disabled }: Props) {
	const departments = departmentsFor(institutionCode)
	const { toast } = useToast()
	const fileInput = useRef<HTMLInputElement>(null)
	const [uploading, setUploading] = useState(false)
	const [result, setResult] = useState<UploadResult | null>(null)

	const downloadTemplate = () => {
		const headers = TEMPLATE_COLUMNS.map(c => c.required ? `${c.header} *` : c.header)
		const example = TEMPLATE_COLUMNS.map(c => TEMPLATE_EXAMPLE[c.key] ?? '')

		const books = XLSX.utils.aoa_to_sheet([headers, example])
		// Wide enough to read the header without dragging every column open
		books['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(16, c.header.length + 4) }))

		const guide = XLSX.utils.aoa_to_sheet([
			['Column', 'Must fill?', 'What to write'],
			...TEMPLATE_COLUMNS.map(c => [c.header, c.required ? 'Yes' : 'Optional', c.note ?? '']),
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
			['Row 2 is a filled example — delete it before uploading, or leave it and it will be saved as a book.'],
			[`Up to ${BULK_ROW_LIMIT} books in one file.`],
			['Do not rename or reorder the columns.'],
		])
		guide['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 90 }]

		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, books, 'Books')
		XLSX.utils.book_append_sheet(book, guide, 'How to fill')
		XLSX.writeFile(book, 'library-book-upload-template.xlsx')
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
			const headerRow = (grid[0] as unknown[]).map(h => normaliseHeader(cellToText(h).replace(/\*/g, '')))
			const keyByIndex = headerRow.map(h => TEMPLATE_COLUMNS.find(c => normaliseHeader(c.header) === h)?.key ?? null)

			const missing = TEMPLATE_COLUMNS
				.filter(c => c.required && !keyByIndex.includes(c.key))
				.map(c => c.header)

			if (missing.length > 0) {
				toast({
					title: '❌ This is not the template',
					description: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template and fill that.`,
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

			const res = await fetch('/api/lib/catalogue/bulk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ institution_id: institutionId, rows }),
			})
			const data = await res.json()

			if (!res.ok) {
				toast({ title: '❌ ' + (data.error ?? 'Upload failed'), variant: 'destructive' })
				return
			}

			setResult(data)
			if (data.created > 0) onUploaded()
		} catch (err) {
			toast({
				title: '❌ Could not read the file',
				description: err instanceof Error ? err.message : 'Make sure it is the .xlsx template',
				variant: 'destructive',
			})
		} finally {
			setUploading(false)
		}
	}

	return (
		<>
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
						Add many books at once
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={downloadTemplate} className="gap-2 py-2.5">
						<Download className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Download template</p>
							<p className="text-xs text-muted-foreground">Excel file with one example filled in</p>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => fileInput.current?.click()} className="gap-2 py-2.5">
						<Upload className="h-4 w-4 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Upload filled sheet</p>
							<p className="text-xs text-muted-foreground">Up to {BULK_ROW_LIMIT} books in one file</p>
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
