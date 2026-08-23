'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
	LayoutDashboard,
	BookOpen,
	Users,
	RefreshCw,
	ShoppingCart,
	Newspaper,
	Archive,
	BarChart3,
	ListOrdered,
	ClockAlert,
	BadgeDollarSign,
	PackagePlus,
	Truck,
	Building2,
	Wallet,
	Library,
	MonitorPlay,
	Search,
	Recycle,
	ArrowLeftRight,
	Wrench,
	PanelLeftClose,
	PanelLeft,
	Crown,  ShieldCheck,
	ScanLine,
	SlidersHorizontal,
	Layers,
	ScrollText,
	UserCog,
} from 'lucide-react'
import {
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarFooter,
	SidebarRail,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
	useSidebar,
} from '@/components/ui/sidebar'
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'
import { useLibraryRole } from '@/hooks/use-library-role'
import { isMemberAllowedPage } from '@/lib/auth/member-access'
import { canOpenPath } from '@/lib/auth/role-pages'
import { FavouritesSidebarSection } from '@/components/library/favourites-sidebar-section'

export interface NavItem {
	title: string
	url: string
	icon: React.ElementType
}

export interface NavGroup {
	label: string
	items: NavItem[]
}

/**
 * The menu. Exported because the mobile bottom navbar shows the same thing —
 * two copies of this list would drift the first time a page is added.
 */
export const navGroups: NavGroup[] = [
	{
		label: 'Overview',
		items: [
			{ title: 'Dashboard', url: '/', icon: LayoutDashboard },
		],
	},
	{
		label: 'Knowledge Registry',
		items: [
			{ title: 'Catalogue', url: '/registry', icon: BookOpen },
			{ title: 'Members', url: '/members', icon: Users },
		],
	},
	{
		label: 'Circulation',
		items: [
			{ title: 'Circulation Desk', url: '/circulation', icon: RefreshCw },
			{ title: 'Gate Entry', url: '/visits', icon: ScanLine },
			{ title: 'Holds', url: '/circulation/holds', icon: ListOrdered },
			{ title: 'Overdue', url: '/circulation/overdue', icon: ClockAlert },
			{ title: 'Late Charges', url: '/circulation/charges', icon: BadgeDollarSign },
		],
	},
	{
		label: 'Acquisition',
		items: [
			{ title: 'Purchase Requests', url: '/acquisition/requests', icon: PackagePlus },
			{ title: 'Orders', url: '/acquisition/orders', icon: ShoppingCart },
			{ title: 'Suppliers', url: '/acquisition/suppliers', icon: Truck },
			{ title: 'Budget', url: '/acquisition/budget', icon: Wallet },
		],
	},
	{
		label: 'Periodicals',
		items: [
			{ title: 'Subscriptions', url: '/periodicals', icon: Newspaper },
			{ title: 'Digital Resources', url: '/digital', icon: MonitorPlay },
		],
	},
	{
		label: 'Other',
		items: [
			{ title: 'Retirement', url: '/retirement', icon: Recycle },
			{ title: 'Inter-Campus', url: '/intercampus', icon: ArrowLeftRight },
			{ title: 'Conservation', url: '/conservation', icon: Wrench },
			{ title: 'OPAC Search', url: '/opac', icon: Search },
		],
	},
	{
		label: 'Reports',
		items: [
			{ title: 'Reports Dashboard', url: '/reports', icon: BarChart3 },
			{ title: 'Library Rules', url: '/settings', icon: SlidersHorizontal },
			{ title: 'Shelf Locations', url: '/settings/locations', icon: Layers },
			{ title: 'Activity Log', url: '/activity-log', icon: ScrollText },
			{ title: 'Staff Access', url: '/access', icon: ShieldCheck },
			{ title: 'Role Management', url: '/roles', icon: UserCog },
		],
	},
]

/**
 * What this person may be shown.
 *
 * Two rules, both decided elsewhere so the menu cannot drift from them:
 *
 *   * `canOpenPath` — the pages this role may open. Some are fixed in code
 *     (Staff Access and Role Management are a super admin's; the Activity Log
 *     stops at library_admin because its API does), and the rest are whatever a
 *     super admin has ticked on the Role Management screen.
 *   * `isMemberAllowedPage` — a member sees Circulation and OPAC only.
 *
 * `allowedPages` is null while the answer is still being fetched, and for a
 * super admin, who is never restricted.
 *
 * This only keeps the menu honest; the pages and their APIs refuse the same
 * people on their own. Shared with the mobile bottom navbar so the two menus
 * can never disagree about who sees what.
 */
export function visibleNavGroups(
	role: string | null | undefined,
	isMember: boolean,
	allowedPages: string[] | null = null
): NavGroup[] {
	const withoutRestricted = navGroups
		.map(group => ({
			...group,
			items: group.items.filter(i => canOpenPath(role, i.url, allowedPages)),
		}))
		.filter(group => group.items.length > 0)

	if (!isMember) return withoutRestricted
	return withoutRestricted
		.map(group => ({ ...group, items: group.items.filter(i => isMemberAllowedPage(i.url)) }))
		.filter(group => group.items.length > 0)
}

export function LibSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const pathname = usePathname()
	const { toggleSidebar, state } = useSidebar()
	const isCollapsed = state === 'collapsed'
	const { isMember, role, pages } = useLibraryRole()

	const visibleGroups = React.useMemo(
		() => visibleNavGroups(role, isMember, pages),
		[isMember, role, pages]
	)

	const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => {
		const init: Record<string, boolean> = {}
		navGroups.forEach(g => { init[g.label] = true })
		return init
	})

	const toggleGroup = (label: string) => {
		setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }))
	}

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader className="h-16 flex items-center overflow-hidden">
				<div className="flex items-center gap-3 px-3">
					<div className="group-data-[collapsible=icon]:block hidden">
						<div className="flex flex-col items-center space-y-1">
							<div className="h-8 w-8 flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-600/10 to-indigo-600/10 border border-blue-600/20 shadow-sm">
								<Library className="h-5 w-5 text-blue-600" />
							</div>
							<div className="font-grotesk text-xs font-extrabold tracking-widest text-blue-600">LIB</div>
						</div>
					</div>
					<div className="group-data-[collapsible=icon]:hidden flex items-center gap-2">
						<div className="relative p-1.5 rounded-lg bg-gradient-to-br from-blue-600/5 to-indigo-600/5 border border-blue-600/20 shadow-sm">
							<Library className="h-8 w-8 text-blue-600" />
						</div>
						<div>
							<div className="font-bold text-sm text-foreground">Learning Commons</div>
							<div className="text-xs text-muted-foreground">Library System</div>
						</div>
					</div>
				</div>
			</SidebarHeader>

			<SidebarContent className="py-4">
				{/* The pages this person starred, above the full menu */}
				<FavouritesSidebarSection />
				{visibleGroups.map((group) => (
					<Collapsible
						key={group.label}
						open={isCollapsed ? true : (openGroups[group.label] ?? true)}
						onOpenChange={() => toggleGroup(group.label)}
					>
						<SidebarGroup>
							{!isCollapsed && (
								<CollapsibleTrigger asChild>
									<SidebarGroupLabel className="flex items-center justify-between cursor-pointer hover:text-foreground transition-colors w-full">
										{group.label}
										<ChevronRight className={`h-3.5 w-3.5 transition-transform ${(openGroups[group.label] ?? true) ? 'rotate-90' : ''}`} />
									</SidebarGroupLabel>
								</CollapsibleTrigger>
							)}
							<CollapsibleContent>
								<SidebarMenu>
									{group.items.map((item) => {
										const isActive = pathname === item.url
										return (
											<SidebarMenuItem key={item.title}>
												<SidebarMenuButton
													asChild
													tooltip={item.title}
													isActive={isActive}
													className={
														isActive
															? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/15 text-blue-700 dark:text-blue-400'
															: 'hover:bg-gradient-to-r hover:from-blue-600/8 hover:to-indigo-600/8'
													}
												>
													<Link href={item.url} className="flex items-center gap-3">
														<item.icon className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-blue-600 dark:text-blue-400'}`} />
														<span className="font-medium text-sm">{item.title}</span>
													</Link>
												</SidebarMenuButton>
											</SidebarMenuItem>
										)
									})}
								</SidebarMenu>
							</CollapsibleContent>
						</SidebarGroup>
					</Collapsible>
				))}
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border">
				<button
					type="button"
					onClick={toggleSidebar}
					className="flex items-center justify-center gap-2 w-full p-2 rounded-md hover:bg-sidebar-accent transition-colors text-sidebar-foreground"
					title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{isCollapsed ? (
						<PanelLeft className="h-5 w-5 text-blue-600" />
					) : (
						<>
							<PanelLeftClose className="h-5 w-5 text-blue-600" />
							<span className="text-sm font-medium text-slate-600 dark:text-slate-300">Collapse</span>
						</>
					)}
				</button>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}
