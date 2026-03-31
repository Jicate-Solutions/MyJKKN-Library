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
	Crown,
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

interface NavItem {
	title: string
	url: string
	icon: React.ElementType
}

interface NavGroup {
	label: string
	items: NavItem[]
}

const navGroups: NavGroup[] = [
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
		],
	},
]

export function LibSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const pathname = usePathname()
	const { toggleSidebar, state } = useSidebar()
	const isCollapsed = state === 'collapsed'

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
				{navGroups.map((group) => (
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
