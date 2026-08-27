'use client'

import { useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { ScanLine, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BarcodeScannerInputProps {
	onScan: (value: string) => void
	placeholder?: string
	disabled?: boolean
	/**
	 * A lookup is running for what was just scanned.
	 *
	 * The box shows a spinner and stops accepting keys until it finishes. A
	 * scanner types a whole code and an Enter in one burst, so the code that
	 * started the lookup is already complete and safe; blocking the next one
	 * keeps a second scan from landing half-typed on top of it, and from firing
	 * the same action twice.
	 */
	busy?: boolean
	className?: string
	value?: string
	onChange?: (value: string) => void
}

export function BarcodeScannerInput({
	onScan,
	placeholder = 'Scan barcode or type and press Enter...',
	disabled = false,
	busy = false,
	className,
	value,
	onChange,
}: BarcodeScannerInputProps) {
	const inputRef = useRef<HTMLInputElement>(null)

	// Focus comes back on its own the moment the box is usable again, so the
	// next book can be scanned without the librarian reaching for the mouse.
	useEffect(() => {
		if (!disabled && !busy) {
			inputRef.current?.focus()
		}
	}, [disabled, busy])

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			if (busy) return
			const val = inputRef.current?.value?.trim()
			if (val) {
				onScan(val)
				// Clear either way — a controlled box is cleared through its own
				// onChange so the parent's state agrees with what is on screen.
				if (onChange) onChange('')
				else if (inputRef.current) inputRef.current.value = ''
			}
		}
	}

	return (
		<div className="relative">
			{busy ? (
				<Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-600" />
			) : (
				<ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			)}
			<Input
				ref={inputRef}
				type="text"
				placeholder={busy ? 'Checking…' : placeholder}
				disabled={disabled || busy}
				className={cn('pl-10 font-mono', className)}
				onKeyDown={handleKeyDown}
				value={value}
				onChange={onChange ? (e) => onChange(e.target.value) : undefined}
				autoComplete="off"
				autoFocus
			/>
		</div>
	)
}
