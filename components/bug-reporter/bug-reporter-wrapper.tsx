'use client'

/**
 * The bug report button, in the bottom-right corner of every page.
 *
 * A librarian who hits something wrong should be able to say so from where it
 * happened, with the screen and the console attached, rather than describing it
 * over the phone a day later. The SDK does the capturing; this decides whether
 * it runs and who it says the report came from.
 *
 * The platform key and URL are not issued yet, so stand-in values keep the
 * button on screen in the meantime: it opens, it captures, and the send fails
 * at the last step because there is nowhere to send to. That is deliberate —
 * the corner it lives in, the way it sits above the phone's navigation bar and
 * the shape of the form can all be checked now rather than on the day the key
 * arrives. Put the two real values in the environment and this picks them up
 * with no code change.
 *
 * Read as `process.env.NEXT_PUBLIC_…` on purpose: those two names are replaced
 * with their values when the app is built, so they must be written out in full
 * rather than looked up from a variable.
 */

import { BugReporterProvider } from '@boobalan_jkkn/bug-reporter-sdk'
import { useAuth } from '@/lib/auth/auth-context'

/**
 * Stand-ins used only until the real ones are set. Both must be non-empty or
 * the SDK builds no client and draws no button.
 */
const PLACEHOLDER_KEY = 'awaiting-api-key'
const PLACEHOLDER_URL = 'https://bug-reporter-not-configured.invalid'

const API_KEY = process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY || PLACEHOLDER_KEY
const API_URL = process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL || PLACEHOLDER_URL

export function BugReporterWrapper({ children }: { children: React.ReactNode }) {
	const { user } = useAuth()

	return (
		<BugReporterProvider
			apiKey={API_KEY}
			apiUrl={API_URL}
			enabled
			debug={process.env.NODE_ENV === 'development'}
			// So a report arrives with a name on it rather than "someone". Absent
			// before sign-in, which is when nobody has a name to give. The id is
			// left off for somebody signed in without a library account yet —
			// their name and email still identify them on the report.
			userContext={
				user
					? {
						userId: user.id ?? undefined,
						name: user.full_name,
						email: user.email,
					}
					: undefined
			}
		>
			{children}
		</BugReporterProvider>
	)
}
