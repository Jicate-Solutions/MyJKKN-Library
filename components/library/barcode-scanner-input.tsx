'use client'

import { Input } from '@/components/ui/input'
import { useScanFocus } from '@/hooks/library/use-scan-focus'
import { CameraScanner } from '@/components/library/camera-scanner'
import { ScanLine, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BarcodeScannerInputProps {
	onScan: (value: string) => void
	placeholder?: string
	disabled?: boolean
	/**
	 * The camera button beside the box, for a desk working from a tablet or a
	 * phone. On by default: a handheld scanner types into the box exactly as it
	 * always did, and the button is simply the other way in.
	 */
	camera?: boolean
	/** What the camera is being pointed at, said in the camera window. */
	cameraLabel?: string
	/**
	 * Whether the cursor comes back here on its own.
	 *
	 * On by default, because a desk is a scanner and a queue: a stray click on
	 * the page, a toast, a panel closing, would otherwise leave the next card
	 * typed into nothing. It is given up willingly to a field somebody is using
	 * and to anything open on top, and a box on a hidden tab never takes it.
	 */
	keepFocus?: boolean
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
	camera = true,
	cameraLabel,
	keepFocus = true,
}: BarcodeScannerInputProps) {
	// The cursor lives here: on arrival, the moment the box is usable again
	// after a lookup, and after any stray click or key that took it elsewhere.
	// The same keeper the gate uses, so the desk and the door behave alike.
	const { inputRef } = useScanFocus(keepFocus && !disabled && !busy)

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

	/**
	 * A code read by the camera means what a scanned one means.
	 *
	 * It goes through the same `onScan` as a burst ending in Enter, and clears
	 * the box the same way, so nothing downstream can tell the two apart.
	 */
	const handleCamera = (code: string) => {
		if (busy) return
		const val = code.trim()
		if (!val) return
		onScan(val)
		if (onChange) onChange('')
		else if (inputRef.current) inputRef.current.value = ''
	}

	return (
		<div className="flex items-center gap-2">
			<div className="relative min-w-0 flex-1">
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
					// No autoFocus: with three tabs mounted at once it is the wrong
					// box that wins. The keeper above puts the cursor in the one that
					// is actually on screen.
				/>
			</div>
			{camera && (
				<CameraScanner
					onScan={handleCamera}
					disabled={disabled || busy}
					label={cameraLabel ?? 'Point the camera at the QR on the card, or the barcode on the book'}
				/>
			)}
		</div>
	)
}
