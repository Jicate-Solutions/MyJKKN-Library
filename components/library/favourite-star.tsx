'use client'

/**
 * The star that puts the page you are on into your Favourites.
 *
 * It sits in the header rather than on each page, so every page has it without
 * twenty-six pages having to know the feature exists. On a page the menu does
 * not list — a book's detail page — it stars the page that one came from, and
 * says so, because a shortcut to one particular book helps nobody tomorrow.
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Star } from 'lucide-react'
import { usePageFavourites } from '@/hooks/use-page-favourites'
import { favouritablePageFor } from '@/lib/library/favourite-pages'
import { useLibraryRole } from '@/hooks/use-library-role'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function FavouriteStar({ className }: { className?: string }) {
	const pathname = usePathname()
	const { isReady, impersonating } = useLibraryRole()
	const { favourites, loaded, load, isFavourite, add, remove } = usePageFavourites()

	// Wait for the session before asking — an anonymous call would only 401 and
	// send the app to the login screen
	useEffect(() => {
		if (isReady) void load()
	}, [isReady, load])

	const page = favouritablePageFor(pathname)
	if (!page || !loaded) return null
	// Their favourites, not yours — the API refuses the change, so the star is
	// not offered while viewing as someone else
	if (impersonating) return null

	const starred = isFavourite(page.path)
	// Named for what it does, so a screen reader and a hover both explain it
	const label = starred
		? `Remove ${page.title} from favourites`
		: `Add ${page.title} to favourites`
	const isParent = page.path !== pathname

	const handleToggle = () => {
		if (starred) void remove(page.path)
		else void add({ path: page.path, title: page.title, module: page.module })
	}

	// Referenced so the button re-renders the moment the list changes elsewhere
	void favourites.length

	return (
		<TooltipProvider>
			<Tooltip delayDuration={200}>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={handleToggle}
						aria-label={label}
						aria-pressed={starred}
						title={label}
						className={cn(
							'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
							'hover:bg-white/20',
							starred ? 'text-brand-yellow' : 'text-white/80 hover:text-white',
							className
						)}
					>
						<Star className={cn('h-4 w-4', starred && 'fill-current')} />
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{starred ? 'Remove from favourites' : isParent ? `Add ${page.title} to favourites` : 'Add to favourites'}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
