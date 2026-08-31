import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { LibSidebar } from '@/components/layout/lib-sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { InstitutionProvider } from '@/context/institution-context'
import { RequireAuth } from '@/components/common/protected-route'
import { LibraryAccessGuard } from '@/components/layout/library-access-guard'
import { RolePageGuard } from '@/components/layout/role-page-guard'
import { ImpersonationBanner } from '@/components/layout/impersonation-banner'
import { BottomNavbar } from '@/components/BottomNav'
import { ActivityTracker } from '@/components/library/activity-tracker'

export default function LibLayout({ children }: { children: React.ReactNode }) {
	return (
		<RequireAuth redirectTo="/login">
			{/* Nothing below this is built for somebody without a library role —
			    not the sidebar, not the institution picker, not a single request.
			    They get the restricted page and nothing else. */}
			<LibraryAccessGuard>
			<InstitutionProvider>
				{/* Records the page being opened. Draws nothing. */}
				<ActivityTracker />
				<SidebarProvider>
					<LibSidebar />
					{/*
						 * `min-w-0` is what stops the whole page scrolling sideways.
						 *
						 * SidebarInset ships as `w-full flex-1` inside a row. On a flex
						 * item, `w-full` also becomes its MINIMUM width, so it can never
						 * shrink below the full container — and it sits next to a 240px
						 * sidebar, making the document 240px wider than the screen. A wide
						 * table anywhere in the library then put a horizontal scrollbar
						 * under everything, sidebar included.
						 *
						 * It cannot be fixed from inside a page: clipping or capping a
						 * page's own content leaves this floor exactly where it was.
						 * Measured — as shipped the document was 1276px inside a 1036px
						 * window; with this it is 1036px.
						 */}
						<SidebarInset className="min-w-0">
						<AppHeader title="JKKN Learning Commons" />
						{/* Below md the menu is the bottom navbar, so the page ends
						    above it rather than behind it */}
						<main className="flex flex-1 flex-col overflow-hidden">
							<div className="flex flex-1 flex-col gap-4 p-4 pb-24 md:pb-4 overflow-hidden">
								<ImpersonationBanner />
								{/* A page hidden from the menu must not open by typing
								    its address either */}
								<RolePageGuard>{children}</RolePageGuard>
							</div>
						</main>
					</SidebarInset>
					<BottomNavbar />
				</SidebarProvider>
			</InstitutionProvider>
			</LibraryAccessGuard>
		</RequireAuth>
	)
}
