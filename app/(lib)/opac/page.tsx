'use client'

import { useState, useCallback } from 'react'
import { useInstitutionFilter } from '@/hooks/use-institution-filter'
import { useToast } from '@/hooks/common/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
	Search, BookOpen, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { LibCatalogueRecord, LibResourceFormat } from '@/types/lib'

const FORMATS: LibResourceFormat[] = [
	'book', 'periodical', 'thesis', 'report', 'map',
	'audio', 'video', 'digital', 'manuscript', 'standard', 'patent', 'other',
]

const LANGUAGES = ['English', 'Tamil', 'Hindi', 'Sanskrit', 'French', 'German', 'Other'] as const

export default function OPACPage() {
	const { appendToUrl } = useInstitutionFilter()
	const { toast } = useToast()

	const [query, setQuery] = useState('')
	const [formatFilter, setFormatFilter] = useState<string>('all')
	const [languageFilter, setLanguageFilter] = useState<string>('all')
	const [availabilityFilter, setAvailabilityFilter] = useState<string>('all')
	const [results, setResults] = useState<LibCatalogueRecord[]>([])
	const [loading, setLoading] = useState(false)
	const [searched, setSearched] = useState(false)
	const [currentPage, setCurrentPage] = useState(1)
	const [itemsPerPage, setItemsPerPage] = useState(12)

	const handleSearch = useCallback(async () => {
		if (!query.trim() && formatFilter === 'all' && languageFilter === 'all') return
		try {
			setLoading(true)
			const params = new URLSearchParams()
			if (query.trim()) params.set('search', query.trim())
			if (formatFilter !== 'all') params.set('resource_format', formatFilter)
			if (languageFilter !== 'all') params.set('language', languageFilter)
			const url = appendToUrl(`/api/lib/catalogue?${params}`)
			const res = await fetch(url)
			if (!res.ok) throw new Error('Search failed')
			const data = await res.json()
			let filtered: LibCatalogueRecord[] = data
			if (availabilityFilter === 'available') {
				filtered = data.filter((r: LibCatalogueRecord) => (r.available_count ?? 0) > 0)
			} else if (availabilityFilter === 'unavailable') {
				filtered = data.filter((r: LibCatalogueRecord) => (r.available_count ?? 0) === 0)
			}
			setResults(filtered)
			setSearched(true)
			setCurrentPage(1)
		} catch {
			toast({ title: 'Search failed', variant: 'destructive' })
		} finally {
			setLoading(false)
		}
	}, [query, formatFilter, languageFilter, availabilityFilter, appendToUrl, toast])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') handleSearch()
	}

	const handleClear = () => {
		setQuery('')
		setFormatFilter('all')
		setLanguageFilter('all')
		setAvailabilityFilter('all')
		setResults([])
		setSearched(false)
		setCurrentPage(1)
	}

	const pageSizeOptions = [12, 24, 48]
	const effectivePerPage = itemsPerPage
	const totalPages = Math.max(1, Math.ceil(results.length / effectivePerPage))
	const paginated = results.slice((currentPage - 1) * effectivePerPage, currentPage * effectivePerPage)

	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-1 flex-col gap-6 p-4 pt-0 overflow-y-auto">
				{/* Hero Search */}
				<div className="flex flex-col items-center gap-3 pt-6 pb-4">
					<div className="flex items-center gap-2 mb-1">
						<BookOpen className="h-7 w-7 text-blue-600" />
						<h1 className="text-2xl font-bold text-blue-700 dark:text-blue-400">JKKN OPAC</h1>
					</div>
					<p className="text-sm text-muted-foreground text-center">Online Public Access Catalogue — Search the library collection</p>

					{/* Search bar */}
					<div className="w-full max-w-2xl">
						<div className="flex gap-2">
							<div className="relative flex-1">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
								<Input
									className="pl-10 h-12 text-base"
									placeholder="Search by title, author, ISBN, keyword..."
									value={query}
									onChange={e => setQuery(e.target.value)}
									onKeyDown={handleKeyDown}
									aria-label="Search catalogue"
								/>
							</div>
							<Button className="h-12 px-6 text-base" onClick={handleSearch} disabled={loading}>
								{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Search'}
							</Button>
						</div>
					</div>

					{/* Filter row */}
					<div className="flex flex-wrap gap-2 justify-center w-full max-w-2xl">
						<Select value={formatFilter} onValueChange={v => setFormatFilter(v)}>
							<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Any format" /></SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Any Format</SelectItem>
								{FORMATS.map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}
							</SelectContent>
						</Select>
						<Select value={languageFilter} onValueChange={v => setLanguageFilter(v)}>
							<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Any language" /></SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Any Language</SelectItem>
								{LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
							</SelectContent>
						</Select>
						<Select value={availabilityFilter} onValueChange={v => setAvailabilityFilter(v)}>
							<SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue placeholder="Availability" /></SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Any Availability</SelectItem>
								<SelectItem value="available">Available Now</SelectItem>
								<SelectItem value="unavailable">Not Available</SelectItem>
							</SelectContent>
						</Select>
						{searched && (
							<Button variant="outline" className="h-8 text-sm" onClick={handleClear}>
								Clear
							</Button>
						)}
					</div>
				</div>

				{/* Results area */}
				{!searched && !loading && (
					<div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
						<BookOpen className="h-14 w-14 opacity-20" />
						<p className="text-base">Enter a search term to browse the catalogue</p>
						<p className="text-sm">You can search by title, author, subject, ISBN or keyword</p>
					</div>
				)}

				{loading && (
					<div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
						<RefreshCw className="h-6 w-6 animate-spin" />
						<span className="text-sm">Searching the catalogue...</span>
					</div>
				)}

				{searched && !loading && (
					<>
						<div className="flex items-center justify-between flex-shrink-0">
							<p className="text-sm text-muted-foreground">
								{results.length === 0
									? 'No results found'
									: `${results.length} result${results.length !== 1 ? 's' : ''} found`}
							</p>
							{results.length > 0 && (
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground hidden sm:inline">Per page</span>
									<Select value={String(itemsPerPage)} onValueChange={v => { setItemsPerPage(Number(v)); setCurrentPage(1) }}>
										<SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
										<SelectContent>
											{pageSizeOptions.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
							)}
						</div>

						{results.length === 0 ? (
							<div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
								<BookOpen className="h-10 w-10 opacity-20" />
								<p className="text-sm">No results match your search</p>
								<p className="text-xs">Try different keywords or remove some filters</p>
							</div>
						) : (
							<>
								{/* Desktop: card grid */}
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
									{paginated.map(r => (
										<Card key={r.id} className="hover:shadow-md transition-shadow">
											<CardContent className="p-4 space-y-2.5">
												<div className="flex items-start justify-between gap-2">
													<div className="flex-1 min-w-0">
														<p className="font-semibold text-sm leading-tight line-clamp-2">{r.title}</p>
														{r.subtitle && (
															<p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.subtitle}</p>
														)}
													</div>
													<Badge variant="secondary" className="text-[10px] capitalize shrink-0">
														{r.resource_format}
													</Badge>
												</div>

												{r.authors && r.authors.length > 0 && (
													<p className="text-xs text-muted-foreground line-clamp-1">
														{r.authors.map(a => a.author_name).join(', ')}
													</p>
												)}

												<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
													{r.publisher_name && <span className="truncate max-w-[140px]">{r.publisher_name}</span>}
													{r.publication_year && <span>{r.publication_year}</span>}
													{r.call_number && (
														<Tooltip>
															<TooltipTrigger asChild>
																<span className="font-mono bg-muted px-1 rounded text-[10px] cursor-default">{r.call_number}</span>
															</TooltipTrigger>
															<TooltipContent>Call Number</TooltipContent>
														</Tooltip>
													)}
												</div>

												<div className="flex items-center justify-between pt-1 border-t">
													{(r.available_count ?? 0) > 0 ? (
														<Badge variant="outline" className="text-[11px] bg-green-50 text-green-700 border-green-200">
															{r.available_count} available
														</Badge>
													) : (
														<Badge variant="outline" className="text-[11px] bg-red-50 text-red-700 border-red-200">
															Not available
														</Badge>
													)}
													<span className="text-xs text-muted-foreground">
														{r.item_count ?? 0} cop{(r.item_count ?? 0) !== 1 ? 'ies' : 'y'}
													</span>
												</div>
											</CardContent>
										</Card>
									))}
								</div>

								{/* Pagination */}
								{totalPages > 1 && (
									<div className="flex items-center justify-center gap-2 pt-2">
										<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
											<ChevronLeft className="h-4 w-4" />
										</Button>
										<span className="text-xs text-muted-foreground tabular-nums px-2">
											{(currentPage - 1) * effectivePerPage + 1}–{Math.min(currentPage * effectivePerPage, results.length)} of {results.length}
										</span>
										<Button variant="outline" size="icon" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								)}
							</>
						)}
					</>
				)}
			</div>
		</TooltipProvider>
	)
}
