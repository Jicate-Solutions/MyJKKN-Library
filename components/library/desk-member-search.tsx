'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FoundMember {
	id: string
	member_number: string
	display_name: string
	role_label: string
	photo_url: string | null
	member_category: string
	is_delinquent: boolean
}

const MIN_CHARS = 2
const MAX_SHOWN = 8
const DEBOUNCE_MS = 250

/**
 * Finding a member who has no card in hand.
 *
 * The scanner wants the exact number. A learner who forgot their card knows
 * their name and roughly their roll number, so this box takes either and
 * hands the exact number to the same lookup the scanner uses — the desk then
 * carries on exactly as if the card had been scanned.
 *
 * It searches the college roll the members page reads, so it finds anyone
 * Active in MyJKKN whether or not they have borrowed before. It never takes
 * focus on its own: the scanner box keeps that.
 */
export function DeskMemberSearch({
	institutionId,
	onPick,
	disabled = false,
}: {
	institutionId: string | null
	onPick: (memberNumber: string) => void
	disabled?: boolean
}) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<FoundMember[]>([])
	const [searching, setSearching] = useState(false)
	const [open, setOpen] = useState(false)
	const [cursor, setCursor] = useState(0)
	const abortRef = useRef<AbortController | null>(null)
	const boxRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const wanted = query.trim()
		abortRef.current?.abort()
		if (!institutionId || wanted.length < MIN_CHARS) {
			setResults([])
			setSearching(false)
			return
		}

		const controller = new AbortController()
		abortRef.current = controller
		setSearching(true)

		const timer = setTimeout(async () => {
			try {
				const params = new URLSearchParams({ institution_id: institutionId, search: wanted })
				const res = await fetch(`/api/lib/members?${params}`, { signal: controller.signal })
				const data = await res.json().catch(() => [])
				if (controller.signal.aborted) return
				const rows: FoundMember[] = Array.isArray(data) ? data.slice(0, MAX_SHOWN) : []
				setResults(rows)
				setCursor(0)
				setOpen(true)
			} catch {
				if (!controller.signal.aborted) setResults([])
			} finally {
				if (!controller.signal.aborted) setSearching(false)
			}
		}, DEBOUNCE_MS)

		return () => {
			clearTimeout(timer)
			controller.abort()
		}
	}, [query, institutionId])

	// A click anywhere else closes the list
	useEffect(() => {
		if (!open) return
		const away = (e: MouseEvent) => {
			if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('mousedown', away)
		return () => document.removeEventListener('mousedown', away)
	}, [open])

	const pick = (member: FoundMember) => {
		if (!member.member_number) return
		setQuery('')
		setResults([])
		setOpen(false)
		onPick(member.member_number)
	}

	const clear = () => {
		setQuery('')
		setResults([])
		setOpen(false)
	}

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown' && results.length > 0) {
			e.preventDefault()
			setOpen(true)
			setCursor(c => Math.min(c + 1, results.length - 1))
		} else if (e.key === 'ArrowUp' && results.length > 0) {
			e.preventDefault()
			setCursor(c => Math.max(c - 1, 0))
		} else if (e.key === 'Enter') {
			// Stop here: with text in this box, Enter picks a name and must not
			// reach the desk's own Enter-confirms handler.
			e.preventDefault()
			e.stopPropagation()
			const chosen = results[cursor]
			if (chosen && open) pick(chosen)
		} else if (e.key === 'Escape') {
			e.stopPropagation()
			clear()
		}
	}

	const showList = open && query.trim().length >= MIN_CHARS

	return (
		<div ref={boxRef} className="relative">
			<div className="relative">
				{searching
					? <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-600" />
					: <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
				<Input
					value={query}
					onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
					onFocus={() => { if (results.length > 0) setOpen(true) }}
					onKeyDown={onKeyDown}
					placeholder={institutionId ? 'No card? Type a name or roll number…' : 'Choose a college first'}
					disabled={disabled || !institutionId}
					className="pl-10 pr-8"
					autoComplete="off"
					aria-label="Find a member by name or number"
				/>
				{query && (
					<button
						type="button"
						onClick={clear}
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
						aria-label="Clear"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>

			{showList && (
				<div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
					{results.length === 0 ? (
						<p className="px-3 py-2.5 text-xs text-muted-foreground">
							{searching ? 'Looking…' : `Nobody matching “${query.trim()}” is Active in this college`}
						</p>
					) : (
						<ul className="max-h-72 overflow-y-auto py-1">
							{results.map((member, index) => {
								const noNumber = !member.member_number
								return (
									<li key={member.id}>
										<button
											type="button"
											disabled={noNumber}
											onMouseEnter={() => setCursor(index)}
											onClick={() => pick(member)}
											className={cn(
												'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
												index === cursor && !noNumber ? 'bg-accent' : '',
												noNumber ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent'
											)}
										>
											<Avatar className="h-7 w-7 shrink-0">
												{member.photo_url && <AvatarImage src={member.photo_url} alt="" />}
												<AvatarFallback className="text-[10px]">
													{(member.display_name || '?').slice(0, 2).toUpperCase()}
												</AvatarFallback>
											</Avatar>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">{member.display_name}</span>
												<span className="block truncate text-xs text-muted-foreground">
													{noNumber ? 'No number on file — cannot be looked up' : member.member_number}
													{member.role_label ? ` · ${member.role_label}` : ''}
												</span>
											</span>
											{member.is_delinquent && (
												<span className="shrink-0 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
													owes
												</span>
											)}
										</button>
									</li>
								)
							})}
						</ul>
					)}
				</div>
			)}
		</div>
	)
}
