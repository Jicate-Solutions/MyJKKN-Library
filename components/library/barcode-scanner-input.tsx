'use client'

import { useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BarcodeScannerInputProps {
	onScan: (value: string) => void
	placeholder?: string
	disabled?: boolean
	className?: string
	value?: string
	onChange?: (value: string) => void
}

export function BarcodeScannerInput({
	onScan,
	placeholder = 'Scan barcode or type and press Enter...',
	disabled = false,
	className,
	value,
	onChange,
}: BarcodeScannerInputProps) {
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!disabled) {
			inputRef.current?.focus()
		}
	}, [disabled])

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			const val = inputRef.current?.value?.trim()
			if (val) {
				onScan(val)
				if (!onChange) {
					// Uncontrolled: clear the input
					if (inputRef.current) inputRef.current.value = ''
				}
			}
		}
	}

	return (
		<div className="relative">
			<ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			<Input
				ref={inputRef}
				type="text"
				placeholder={placeholder}
				disabled={disabled}
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
