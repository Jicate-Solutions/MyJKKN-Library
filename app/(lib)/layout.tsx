import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { LibSidebar } from '@/components/layout/lib-sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { InstitutionProvider } from '@/context/institution-context'
import { RequireAuth } from '@/components/common/protected-route'
import { LibraryAccessGuard } from '@/components/layout/library-access-guard'
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
					<SidebarInset>
						<AppHeader title="JKKN Learning Commons" />
						{/* Below md the menu is the bottom navbar, so the page ends
						    above it rather than behind it */}
						<main className="flex flex-1 flex-col overflow-hidden">
							<div className="flex flex-1 flex-col gap-4 p-4 pb-24 md:pb-4 overflow-hidden">
								<ImpersonationBanner />
								{children}
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
