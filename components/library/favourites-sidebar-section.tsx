'use client'

/**
 * The Favourites section at the top of the sidebar.
 *
 * A librarian works in three or four screens all day and the menu holds
 * twenty-six, so the ones they starred sit above the groups, in the order they
 * dragged them, with the pinned ones held at the top.
 *
 * It renders nothing at all when the list is empty — an empty heading in a menu
 * is just a line nobody can use.
 */

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Star, ChevronRight, Pin, X, GripVertical } from 'lucide-react'
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core'
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuItem,
	useSidebar,
} from '@/components/ui/sidebar'
import { usePageFavourites, type FavouritePage } from '@/hooks/use-page-favourites'
import { useLibraryRole } from '@/hooks/use-library-role'
import { iconForPath } from '@/lib/library/favourite-pages'
import { cn } from '@/lib/utils'

export function FavouritesSidebarSection() {
	const pathname = usePathname()
	const { state } = useSidebar()
	const isCollapsed = state === 'collapsed'
	const [isOpen, setIsOpen] = useState(true)
	const { favourites, remove, togglePin, reorder } = usePageFavourites()
	const { impersonating } = useLibraryRole()

	const sensors = useSensors(
		// A few pixels of travel before a drag starts, so a plain click still
		// opens the page instead of being swallowed as a tiny drag
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	)

	if (favourites.length === 0) return null

	// Collapsed to icons: names and a drag handle have nowhere to go, so the
	// starred pages become a short strip of icons
	if (isCollapsed) {
		return (
			<SidebarGroup>
				<SidebarMenu>
					{favourites.map(fav => {
						const Icon = iconForPath(fav.path)
						const isActive = pathname === fav.path
						return (
							<SidebarMenuItem key={fav.path}>
								<Link
									href={fav.path}
									title={fav.title}
									className={cn(
										'flex h-8 w-8 items-center justify-center rounded-md mx-auto',
										isActive
											? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/15 text-blue-700 dark:text-blue-400'
											: 'hover:bg-sidebar-accent'
									)}
								>
									<Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
								</Link>
							</SidebarMenuItem>
						)
					})}
				</SidebarMenu>
			</SidebarGroup>
		)
	}

	// While viewing as someone else this is their list, and it is theirs to
	// arrange — the API refuses the change too, so the controls are not offered
	const readOnly = !!impersonating

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = favourites.findIndex(f => f.path === active.id)
		const newIndex = favourites.findIndex(f => f.path === over.id)
		if (oldIndex === -1 || newIndex === -1) return

		const moved = arrayMove(favourites, oldIndex, newIndex)
		void reorder(moved.map(f => f.path))
	}

	const header = (
		<SidebarGroupLabel
			onClick={() => setIsOpen(o => !o)}
			className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors w-full"
		>
			<Star className="h-3 w-3 shrink-0 fill-brand-yellow text-brand-yellow-700 dark:text-brand-yellow-500" />
			<span className="flex-1 text-left">Favourites</span>
			<span className="text-[10px] opacity-60 tabular-nums">{favourites.length}</span>
			<ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
		</SidebarGroupLabel>
	)

	if (readOnly) {
		return (
			<SidebarGroup>
				{header}
				{isOpen && (
					<SidebarMenu>
						{favourites.map(fav => (
							<SidebarMenuItem key={fav.path}>
								<FavouriteRow favourite={fav} isActive={pathname === fav.path} />
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				)}
				<div className="mt-2 mx-2 border-b border-sidebar-border" />
			</SidebarGroup>
		)
	}

	return (
		<SidebarGroup>
			{header}
			{isOpen && (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={favourites.map(f => f.path)} strategy={verticalListSortingStrategy}>
						<SidebarMenu>
							{favourites.map(fav => (
								<SortableFavourite
									key={fav.path}
									favourite={fav}
									isActive={pathname === fav.path}
									onRemove={() => void remove(fav.path)}
									onTogglePin={() => void togglePin(fav.path)}
								/>
							))}
						</SidebarMenu>
					</SortableContext>
				</DndContext>
			)}
			<div className="mt-2 mx-2 border-b border-sidebar-border" />
		</SidebarGroup>
	)
}

/** The link itself — the same row whether or not it can be rearranged. */
function FavouriteRow({
	favourite,
	isActive,
	dragHandle,
	hidePinWhenHovered,
}: {
	favourite: FavouritePage
	isActive: boolean
	dragHandle?: React.ReactNode
	hidePinWhenHovered?: boolean
}) {
	const Icon = iconForPath(favourite.path)

	return (
		<div className="flex items-center">
			{dragHandle}
			<Link
				href={favourite.path}
				title={favourite.module ? `${favourite.title} · ${favourite.module}` : favourite.title}
				className={cn(
					'flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
					isActive
						? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/15 text-blue-700 dark:text-blue-400'
						: 'hover:bg-sidebar-accent'
				)}
			>
				<Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
				<span className="truncate font-medium">{favourite.title}</span>
				{favourite.isPinned && (
					<Pin
						className={cn(
							'ml-auto h-2.5 w-2.5 shrink-0 text-muted-foreground/60',
							hidePinWhenHovered && 'transition-opacity group-hover/fav:opacity-0'
						)}
					/>
				)}
			</Link>
		</div>
	)
}

function SortableFavourite({
	favourite,
	isActive,
	onRemove,
	onTogglePin,
}: {
	favourite: FavouritePage
	isActive: boolean
	onRemove: () => void
	onTogglePin: () => void
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: favourite.path,
	})

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	return (
		<SidebarMenuItem ref={setNodeRef} style={style} className="group/fav relative">
			<FavouriteRow
				favourite={favourite}
				isActive={isActive}
				hidePinWhenHovered
				dragHandle={
					<button
						type="button"
						{...attributes}
						{...listeners}
						tabIndex={-1}
						aria-label={`Reorder ${favourite.title}`}
						className="h-8 w-4 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/70 opacity-0 group-hover/fav:opacity-100 transition-opacity"
					>
						<GripVertical className="h-3 w-3" />
					</button>
				}
			/>

			{/* Pin and remove, shown only while the row is under the pointer */}
			<div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/fav:opacity-100 transition-opacity">
				<button
					type="button"
					onClick={onTogglePin}
					title={favourite.isPinned ? 'Unpin' : 'Pin to top'}
					aria-label={favourite.isPinned ? `Unpin ${favourite.title}` : `Pin ${favourite.title} to top`}
					className={cn(
						'h-5 w-5 flex items-center justify-center rounded-sm hover:bg-muted transition-colors',
						favourite.isPinned ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground hover:text-foreground'
					)}
				>
					<Pin className="h-2.5 w-2.5" />
				</button>
				<button
					type="button"
					onClick={onRemove}
					title="Remove from favourites"
					aria-label={`Remove ${favourite.title} from favourites`}
					className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
				>
					<X className="h-2.5 w-2.5" />
				</button>
			</div>
		</SidebarMenuItem>
	)
}
