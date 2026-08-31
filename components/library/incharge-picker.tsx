'use client'

/**
 * Choosing who is in charge of a department library.
 *
 * The pool is this college's Active teaching staff, read from MyJKKN through
 * the members route — the same list the Members page shows, so the two can
 * never disagree, and no second idea of "staff" is written anywhere. HOD,
 * facilitator, principal: whoever the college actually put in charge.
 *
 * Custody, not login. Naming somebody here makes them answerable for the books
 * in that department; it does not let them sign in. Who may open this
 * application is still MyJKKN's answer alone.
 *
 * The search is typed, not a dropdown of hundreds — a college has several
 * hundred teaching staff, and a list that long is slower to use than a name is
 * to type.
 */

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { searchIncharge } from '@/services/library/lib-departments-service'
import type { InchargeCandidate } from '@/types/lib-departments'
import { Search, UserCheck, X, RefreshCw } from 'lucide-react'

interface Props {
	institutionId: string
	/** Who is in charge now, so the picker can show them and offer to clear it. */
	current: { myjkkn_id: string | null; name: string | null; designation: string | null } | null
	onChoose: (person: InchargeCandidate | null) => void
	disabled?: boolean
}

export function InchargePicker({ institutionId, current, onChoose, disabled }: Props) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<InchargeCandidate[]>([])
	const [searching, setSearching] = useState(false)
	const [touched, setTouched] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (timer.current) clearTimeout(timer.current)

		const term = query.trim()
		if (term.length < 2) {
			setResults([])
			setSearching(false)
			return
		}

		// Waiting a moment after the last keystroke rather than searching on each
		// one — the roll comes from MyJKKN, and a name typed at speed would
		// otherwise be six requests where one will do.
		setSearching(true)
		timer.current = setTimeout(async () => {
			try {
				setResults(await searchIncharge(institutionId, term))
			} catch {
				setResults([])
			} finally {
				setSearching(false)
			}
		}, 350)

		return () => { if (timer.current) clearTimeout(timer.current) }
	}, [query, institutionId])

	return (
		<div className="space-y-3">
			{current?.myjkkn_id && !touched ? (
				<div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/10">
							<UserCheck className="h-4 w-4 text-brand-green dark:text-brand-green-400" />
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{current.name}</p>
							{current.designation && (
								<p className="truncate text-xs text-muted-foreground">{current.designation}</p>
							)}
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							variant="outline" size="sm" className="h-7 text-xs"
							disabled={disabled}
							onClick={() => setTouched(true)}
						>
							Change
						</Button>
						<Button
							variant="ghost" size="icon"
							className="h-7 w-7 p-0 text-destructive hover:text-destructive"
							disabled={disabled}
							title="Remove the in-charge"
							onClick={() => onChoose(null)}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			) : (
				<>
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							autoFocus={touched}
							placeholder="Type a name or staff number..."
							value={query}
							onChange={e => setQuery(e.target.value)}
							disabled={disabled}
							className="h-9 pl-8 text-sm"
						/>
						{searching && (
							<RefreshCw className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
						)}
					</div>

					{query.trim().length >= 2 && !searching && results.length === 0 && (
						<p className="px-1 text-xs text-muted-foreground">
							Nobody by that name teaches at this college in MyJKKN.
						</p>
					)}

					{results.length > 0 && (
						<div className="max-h-64 overflow-y-auto rounded-md border divide-y">
							{results.map(person => (
								<button
									key={person.myjkkn_id}
									type="button"
									disabled={disabled}
									onClick={() => { onChoose(person); setTouched(false); setQuery(''); setResults([]) }}
									className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">{person.display_name}</p>
										<p className="truncate text-xs text-muted-foreground">
											{person.role_label || 'Teaching staff'}
											{person.member_number ? ` · ${person.member_number}` : ''}
										</p>
									</div>
									<Badge variant="outline" className="shrink-0 text-[10px]">Choose</Badge>
								</button>
							))}
						</div>
					)}

					{current?.myjkkn_id && touched && (
						<Button
							variant="ghost" size="sm"
							className="h-7 text-xs"
							onClick={() => { setTouched(false); setQuery(''); setResults([]) }}
						>
							Keep {current.name}
						</Button>
					)}
				</>
			)}
		</div>
	)
}
