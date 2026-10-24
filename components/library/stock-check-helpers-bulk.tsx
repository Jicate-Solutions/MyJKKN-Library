'use client'

/**
 * Assign stock check helpers from a spreadsheet — beside the one-at-a-time
 * search in the helpers panel.
 *
 * One college on screen: the sheet is Name and Email, and everybody goes to
 * that college. All Institutions: the sheet adds an Institution column, and
 * each row goes to the college it names.
 *
 * The file is checked by the server first and nothing is written until the
 * super admin has seen which rows are ready. A row filled in wrongly can be
 * taken out, or moved to another college, right there — each change is checked
 * again, so what is assigned is always what was last checked. Only MyJKKN staff
 * are accepted.
 */

import { useState, useRef } from 'react'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
	Download, Upload, Loader2, Users, FileSpreadsheet, X, CheckCircle2, AlertTriangle, CalendarDays,
} from 'lucide-react'

interface CheckedRow {
	row: number
	name: string
	email: string
	institution_code: string
	status: 'ready' | 'needs_attention'
	reason: string | null
}

interface SheetRow {
	row: number
	name: string
	email: string
	institution: string
}

const MAX_DAYS = 120

const dayAfter = (days: number) =>
	new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const readable = (day: string) =>
	day ? new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const text = (value: unknown): string => (value ?? '').toString().trim()

/** Header text, without the required star and case, so a retyped header still reads. */
const plain = (value: unknown) => text(value).replace(/\*/g, '').trim().toLowerCase()

/** The numbered heading of each step in the dialog. */
function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
	return (
		<div className="flex items-start gap-2">
			<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green text-[11px] font-semibold text-white">
				{n}
			</span>
			<div className="min-w-0">
				<p className="text-sm font-medium leading-5">{title}</p>
				{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
			</div>
		</div>
	)
}

export function StockCheckHelpersBulk({
	institutionId,
	institutionCode,
	colleges,
	onDone,
}: {
	/** Empty for All Institutions — the sheet then names each row's college. */
	institutionId: string
	institutionCode: string
	/** College codes a row may be moved to, on All Institutions. */
	colleges: string[]
	onDone?: () => void
}) {
	const { toast } = useToast()
	const fileInput = useRef<HTMLInputElement>(null)
	const allColleges = !institutionId

	const [open, setOpen] = useState(false)
	const [until, setUntil] = useState(dayAfter(7))
	const [fileName, setFileName] = useState('')
	const [sheetRows, setSheetRows] = useState<SheetRow[]>([])
	const [checked, setChecked] = useState<CheckedRow[] | null>(null)
	const [busy, setBusy] = useState<'reading' | 'checking' | 'saving' | null>(null)
	const [dragging, setDragging] = useState(false)
	const [onlyAttention, setOnlyAttention] = useState(false)

	const reset = () => {
		setFileName('')
		setSheetRows([])
		setChecked(null)
		setOnlyAttention(false)
		if (fileInput.current) fileInput.current.value = ''
	}

	const downloadTemplate = async () => {
		const XLSX = await import('xlsx')
		const headers = allColleges ? ['Name *', 'Email *', 'Institution *'] : ['Name *', 'Email *']
		const example = allColleges
			? ['Viswanathan S', 'viswanathan.s@jkkn.ac.in', 'CET']
			: ['Viswanathan S', 'viswanathan.s@jkkn.ac.in']
		const rows = XLSX.utils.aoa_to_sheet([headers, example])
		rows['!cols'] = headers.map(() => ({ wch: 32 }))

		const guide = XLSX.utils.aoa_to_sheet([
			['Column', 'What to write'],
			['Name', 'The helper\'s name'],
			['Email', 'Their MyJKKN email — the one they sign in with. Only MyJKKN staff are accepted, not learners.'],
			...(allColleges
				? [['Institution', `The college whose shelves they will scan: ${colleges.join(', ') || 'COP, AHS, CAS, CET, CNR, COE or DCH'}`]]
				: []),
			[],
			[allColleges
				? 'Each row is assigned to the college in its Institution column.'
				: `Every row is assigned to ${institutionCode || 'the college on screen'}.`],
			['Row 2 is an example — delete it before uploading, or it will be assigned too.'],
			['The last day they may scan is chosen on the screen, for the whole file.'],
			['Do not rename or reorder the columns.'],
		])
		guide['!cols'] = [{ wch: 16 }, { wch: 100 }]

		const book = XLSX.utils.book_new()
		XLSX.utils.book_append_sheet(book, rows, 'Helpers')
		XLSX.utils.book_append_sheet(book, guide, 'How to fill')
		XLSX.writeFile(book, allColleges
			? 'stock-check-helpers-all-colleges-template.xlsx'
			: `stock-check-helpers-${(institutionCode || 'college').toLowerCase()}-template.xlsx`)
	}

	/** Sends the rows to the server — to check them, or to save the ready ones. */
	const send = async (rows: SheetRow[], save: boolean) => {
		const res = await fetch('/api/lib/stock/helpers/bulk', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ institution_id: institutionId || undefined, expires_on: until, rows, save }),
		})
		const body = await res.json()
		if (!res.ok) throw new Error(body.error || 'Could not check this file')
		return body as { rows: CheckedRow[]; ready: number; saved: number }
	}

	/** Checks the rows again after one was taken out or moved. */
	const recheck = async (rows: SheetRow[]) => {
		setSheetRows(rows)
		if (rows.length === 0) {
			reset()
			return
		}
		try {
			setBusy('checking')
			setChecked((await send(rows, false)).rows)
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not check this file',
				variant: 'destructive',
			})
		} finally {
			setBusy(null)
		}
	}

	const removeRow = (row: number) => recheck(sheetRows.filter(r => r.row !== row))

	const moveRow = (row: number, institution: string) =>
		recheck(sheetRows.map(r => (r.row === row ? { ...r, institution } : r)))

	const readFile = async (file: File) => {
		setChecked(null)
		try {
			setBusy('reading')
			const XLSX = await import('xlsx')
			const workbook = XLSX.read(await file.arrayBuffer())
			const sheet = workbook.Sheets[workbook.SheetNames[0]]
			const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
			if (grid.length < 2) throw new Error('The file has no rows under the headers')

			const headers = (grid[0] ?? []).map(plain)
			const nameAt = headers.indexOf('name')
			const emailAt = headers.indexOf('email')
			const institutionAt = headers.indexOf('institution')
			if (emailAt < 0) throw new Error('No Email column — please use the downloaded template')
			if (allColleges && institutionAt < 0) {
				throw new Error('No Institution column — with All Institutions the sheet must name each college')
			}

			const rows: SheetRow[] = []
			grid.slice(1).forEach((cells, index) => {
				const name = nameAt >= 0 ? text(cells[nameAt]) : ''
				const email = text(cells[emailAt])
				const institution = institutionAt >= 0 ? text(cells[institutionAt]).toUpperCase() : ''
				if (!name && !email && !institution) return
				rows.push({ row: index + 2, name, email, institution })
			})
			if (rows.length === 0) throw new Error('The file has no rows under the headers')

			setFileName(file.name)
			setSheetRows(rows)
			setBusy('checking')
			setChecked((await send(rows, false)).rows)
		} catch (err) {
			reset()
			toast({
				title: 'Could not read this file',
				description: err instanceof Error ? err.message : 'Make sure it is the .xlsx template',
				variant: 'destructive',
			})
		} finally {
			setBusy(null)
		}
	}

	const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (file) void readFile(file)
	}

	const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		setDragging(false)
		const file = event.dataTransfer.files?.[0]
		if (file && !busy) void readFile(file)
	}

	const assign = async () => {
		try {
			setBusy('saving')
			const result = await send(sheetRows, true)
			const skipped = result.rows.length - result.saved
			toast({
				title: `✅ ${result.saved} ${result.saved === 1 ? 'helper' : 'helpers'} can scan until ${readable(until)}`,
				description: skipped > 0 ? `${skipped} ${skipped === 1 ? 'row was' : 'rows were'} left out` : undefined,
				className: 'bg-green-50 border-green-200 text-green-800',
			})
			reset()
			setOpen(false)
			onDone?.()
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : 'Could not assign these helpers',
				variant: 'destructive',
			})
		} finally {
			setBusy(null)
		}
	}

	const ready = checked?.filter(row => row.status === 'ready').length ?? 0
	const attention = (checked?.length ?? 0) - ready
	const shown = checked?.filter(row => !onlyAttention || row.status !== 'ready') ?? []
	const working = busy === 'reading' || busy === 'checking'

	return (
		<>
			<Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
				<Users className="mr-1.5 h-3.5 w-3.5" />
				Bulk assign
			</Button>

			<Dialog open={open} onOpenChange={o => { if (busy === 'saving') return; setOpen(o); if (!o) reset() }}>
				<DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0">
					<DialogHeader className="border-b px-5 py-4">
						<DialogTitle className="flex items-center gap-2">
							<Users className="h-4 w-4 text-brand-green" />
							Bulk assign stock check helpers
							<Badge variant="outline" className="ml-1 font-normal">
								{allColleges ? 'All Institutions' : institutionCode || 'This college'}
							</Badge>
						</DialogTitle>
						<DialogDescription>
							{allColleges
								? 'Each row goes to the college named in its Institution column.'
								: `Every row goes to ${institutionCode || 'this college'}.`}
							{' '}Only MyJKKN staff can be assigned — learners are left out.
						</DialogDescription>
					</DialogHeader>

					<div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
						{/* Template and date, side by side */}
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2 rounded-md border p-3">
								<Step
									n={1}
									title="Download the template"
									hint={allColleges ? 'Columns: Name, Email, Institution' : 'Columns: Name, Email'}
								/>
								<Button variant="outline" size="sm" className="h-8" onClick={downloadTemplate}>
									<Download className="mr-1.5 h-3.5 w-3.5" />
									Download template
								</Button>
							</div>
							<div className="space-y-2 rounded-md border p-3">
								<Step n={2} title="Can scan until" hint="One date for everybody in the file" />
								<div className="relative w-48">
									<CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										type="date"
										value={until}
										min={dayAfter(0)}
										max={dayAfter(MAX_DAYS)}
										onChange={e => setUntil(e.target.value)}
										className="h-8 pl-8 text-sm"
									/>
								</div>
							</div>
						</div>

						{/* The file */}
						<div className="space-y-2">
							<Step n={3} title="Upload the filled file" />
							{fileName ? (
								<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
									<div className="flex min-w-0 items-center gap-2">
										<FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-green" />
										<span className="truncate text-sm font-medium" title={fileName}>{fileName}</span>
										<span className="shrink-0 text-xs text-muted-foreground">
											{sheetRows.length} {sheetRows.length === 1 ? 'row' : 'rows'}
										</span>
									</div>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										disabled={!!busy}
										onClick={() => fileInput.current?.click()}
									>
										Choose another file
									</Button>
								</div>
							) : (
								<div
									role="button"
									tabIndex={0}
									onClick={() => !busy && fileInput.current?.click()}
									onKeyDown={e => e.key === 'Enter' && !busy && fileInput.current?.click()}
									onDragOver={e => { e.preventDefault(); setDragging(true) }}
									onDragLeave={() => setDragging(false)}
									onDrop={handleDrop}
									className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
										dragging ? 'border-brand-green bg-brand-green/5' : 'hover:border-brand-green/60 hover:bg-muted/40'
									}`}
								>
									{working
										? <Loader2 className="h-6 w-6 animate-spin text-brand-green" />
										: <Upload className="h-6 w-6 text-muted-foreground" />}
									<p className="text-sm font-medium">
										{busy === 'checking' ? 'Checking with MyJKKN…' : busy === 'reading' ? 'Reading the file…' : 'Click to choose, or drop the file here'}
									</p>
									<p className="text-xs text-muted-foreground">.xlsx or .xls</p>
								</div>
							)}
							<input
								ref={fileInput}
								type="file"
								accept=".xlsx,.xls"
								className="hidden"
								onChange={handleFile}
							/>
						</div>

						{/* Review */}
						{checked && (
							<div className="space-y-2">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<Step
										n={4}
										title="Review"
										hint={allColleges
											? 'Wrong row? Change its college, or take it out with ✕'
											: 'Wrong row? Take it out with ✕'}
									/>
									<div className="flex flex-wrap items-center gap-2 text-xs">
										{busy === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
										<Badge variant="outline" className="border-brand-green/40 font-normal text-brand-green">
											<CheckCircle2 className="mr-1 h-3 w-3" />
											{ready} ready
										</Badge>
										{attention > 0 && (
											<>
												<Badge variant="outline" className="border-amber-300 font-normal text-amber-700 dark:text-amber-300">
													<AlertTriangle className="mr-1 h-3 w-3" />
													{attention} {attention === 1 ? 'needs' : 'need'} attention
												</Badge>
												<label className="flex items-center gap-1.5 text-muted-foreground">
													<Switch checked={onlyAttention} onCheckedChange={setOnlyAttention} />
													Only these
												</label>
											</>
										)}
									</div>
								</div>

								<div className={`max-h-80 overflow-auto rounded-md border ${busy === 'checking' ? 'opacity-60' : ''}`}>
									<table className="w-full text-sm">
										<thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
											<tr>
												<th className="w-12 px-3 py-2 text-left font-medium">Row</th>
												<th className="px-3 py-2 text-left font-medium">Helper</th>
												<th className="w-32 px-3 py-2 text-left font-medium">Institution</th>
												<th className="px-3 py-2 text-left font-medium">Status</th>
												<th className="w-10 px-2 py-2" />
											</tr>
										</thead>
										<tbody>
											{shown.map(row => {
												const sheetRow = sheetRows.find(r => r.row === row.row)
												return (
													<tr
														key={row.row}
														className={`border-t ${row.status === 'ready' ? '' : 'bg-amber-50/60 dark:bg-amber-900/10'}`}
													>
														<td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.row}</td>
														<td className="max-w-[260px] px-3 py-2">
															<p className="truncate font-medium" title={row.name}>{row.name || '—'}</p>
															<p className="truncate text-xs text-muted-foreground" title={row.email}>{row.email || '—'}</p>
														</td>
														<td className="px-3 py-2">
															{allColleges ? (
																<Select
																	value={colleges.includes(sheetRow?.institution ?? '') ? sheetRow?.institution : undefined}
																	onValueChange={value => moveRow(row.row, value)}
																	disabled={!!busy}
																>
																	<SelectTrigger className="h-8 w-28 text-xs">
																		<SelectValue placeholder={sheetRow?.institution || 'Choose'} />
																	</SelectTrigger>
																	<SelectContent>
																		{colleges.map(code => (
																			<SelectItem key={code} value={code}>{code}</SelectItem>
																		))}
																	</SelectContent>
																</Select>
															) : (
																<span className="text-xs">{row.institution_code || '—'}</span>
															)}
														</td>
														<td className="px-3 py-2 text-xs">
															{row.status === 'ready' ? (
																<span className="inline-flex items-center gap-1 text-brand-green">
																	<CheckCircle2 className="h-3.5 w-3.5" />
																	Ready
																</span>
															) : (
																<span className="inline-flex items-start gap-1 text-amber-700 dark:text-amber-300">
																	<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
																	{row.reason}
																</span>
															)}
														</td>
														<td className="px-2 py-2">
															<Button
																variant="ghost"
																size="icon"
																className="h-7 w-7 text-muted-foreground hover:text-red-600"
																title="Take this row out"
																disabled={!!busy}
																onClick={() => removeRow(row.row)}
															>
																<X className="h-3.5 w-3.5" />
															</Button>
														</td>
													</tr>
												)
											})}
										</tbody>
									</table>
								</div>
							</div>
						)}
					</div>

					<DialogFooter className="items-center gap-2 border-t px-5 py-3 sm:justify-between">
						<p className="text-xs text-muted-foreground">
							{checked
								? ready > 0
									? `${ready} ${ready === 1 ? 'helper' : 'helpers'} will scan until ${readable(until)}${attention > 0 ? ` · ${attention} left out` : ''}`
									: 'No row is ready yet'
								: 'Nothing is saved until you press Assign'}
						</p>
						<div className="flex gap-2">
							<Button variant="outline" disabled={busy === 'saving'} onClick={() => { setOpen(false); reset() }}>
								Cancel
							</Button>
							<Button disabled={!checked || ready === 0 || !until || !!busy} onClick={assign}>
								{busy === 'saving' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
								Assign {ready > 0 ? ready : ''} {ready === 1 ? 'helper' : 'helpers'}
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
