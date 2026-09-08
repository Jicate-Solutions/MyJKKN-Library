'use client'

/**
 * Text on one line, with the whole of it a hover away when it is cut.
 *
 * A table column is narrow and a nursing textbook's title is not, so most of
 * them end in "…". Wrapping would make every row a different height and a
 * register harder to run a finger down; a tooltip shows the full text only
 * for the lines that actually need it — text that fits gets no tooltip, so
 * hovering a short title shows nothing at all.
 *
 * Used for book, journal and resource titles on every list in the library,
 * since 7 Sep 2026. Carries its own TooltipProvider so it works on a page
 * that has none.
 */

import { createElement, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
	text: string
	className?: string
	/** The element to draw — a heading where the text is one, a paragraph in a card, a span in a row. */
	as?: 'span' | 'p' | 'div' | 'h1'
}

export function OverflowText({ text, className = '', as = 'span' }: Props) {
	const ref = useRef<HTMLElement>(null)
	const [open, setOpen] = useState(false)

	return (
		<TooltipProvider delayDuration={300}>
			<Tooltip
				open={open}
				onOpenChange={next => {
					// Only when the text is really cut — measured at the moment of
					// hovering, so a window resized since the page drew still answers right
					const el = ref.current
					setOpen(next && !!el && el.scrollWidth > el.clientWidth)
				}}
			>
				<TooltipTrigger asChild>
					{createElement(as, { ref, className: `block truncate ${className}` }, text)}
				</TooltipTrigger>
				<TooltipContent side="bottom" align="start" className="max-w-[560px] whitespace-normal break-words">
					{text}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
