'use client'

/**
 * The signed-in person, for the browser.
 *
 * Supabase owns the session — it issues the token, renews it in the background
 * and tells us when either happens. This context listens for that and, whenever
 * the session changes, asks `/api/auth/session` who the person is. It never
 * works the answer out itself: the role comes from their MyJKKN role,
 * server-side. Super Admin has full access. What the browser holds is a copy
 * of that decision rather than the decision.
 *
 * The token is also mirrored into a plain `access_token` cookie on every
 * change, because that is the one name every `/api/lib/*` route reads.
 */

import {
	createContext,
	useContext,
	useEffect,
	useState,
	useCallback,
	useMemo,
	useRef,
	ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { getAuthBrowserClient, mirrorAccessTokenCookie } from './supabase-auth'
import { installSessionFetch } from './session-fetch'
import { AppUser } from './config'

interface AuthContextType {
	user: AppUser | null
	loading: boolean
	isLoading: boolean // Alias for loading (backwards compatibility)
	error: string | null
	isAuthenticated: boolean
	login: (redirectUrl?: string) => void
	loginWithGoogle: (redirectUrl?: string) => void
	logout: () => Promise<void>
	refreshSession: () => Promise<boolean>
	refreshPermissions: () => Promise<void>
	getAccessToken: () => string | null
	hasPermission: (permission: string) => boolean
	hasRole: (role: string) => boolean
	hasAnyRole: (roles: string[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
	children: ReactNode
	/** Kept for the call sites that still pass it; the session is always live now. */
	autoValidate?: boolean
}

/** Only a path within this application — never somewhere else entirely. */
function safeRedirect(value: string | null | undefined): string {
	if (!value) return '/dashboard'
	if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
	return value
}

/** Sends the browser to Google, by way of Supabase. */
function startGoogleSignIn(redirectUrl?: string): void {
	const target = safeRedirect(redirectUrl)
	const callback = new URL('/auth/callback', window.location.origin)
	if (target !== '/dashboard') callback.searchParams.set('redirect', target)

	void getAuthBrowserClient().auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: callback.toString(),
			// Always ask which account. Without it a shared desk machine signs
			// the next person in as whoever used it last, silently.
			queryParams: { prompt: 'select_account' },
		},
	})
}

export function AuthProvider({ children }: AuthProviderProps) {
	// Installed during render, not in an effect: child effects run before the
	// parent's, so a page's first fetch would otherwise escape the 401 handler.
	// The installer is idempotent, so a repeated render costs nothing.
	installSessionFetch()

	const [user, setUser] = useState<AppUser | null>(null)
	const [session, setSession] = useState<Session | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const pathname = usePathname()

	/** Fetches the profile the server has built for whoever holds the token. */
	const loadProfile = useCallback(async (): Promise<AppUser | null> => {
		try {
			const response = await fetch('/api/auth/session', { credentials: 'include' })
			if (!response.ok) return null
			return (await response.json()) as AppUser
		} catch (err) {
			console.warn('[auth] Could not load the session profile:', err)
			return null
		}
	}, [])

	useEffect(() => {
		let supabase
		try {
			supabase = getAuthBrowserClient()
		} catch (err) {
			// Misconfigured deployment. Said plainly on the login page rather
			// than thrown, which would replace the whole app with a blank screen
			// and no clue as to why.
			console.error('[auth]', err)
			setError('Sign-in is not configured on this server.')
			setLoading(false)
			return
		}

		let active = true

		/**
		 * Applies one session — the cookie first, then the profile.
		 *
		 * The cookie is written before the fetch because `/api/auth/session`
		 * reads it: doing it the other way round asks the server to identify a
		 * token it has not been given yet.
		 */
		const apply = async (next: Session | null) => {
			mirrorAccessTokenCookie(next?.access_token ?? null, next?.expires_at ?? null)

			if (!active) return
			setSession(next)

			if (!next) {
				setUser(null)
				setLoading(false)
				return
			}

			const profile = await loadProfile()
			if (!active) return

			setUser(profile)
			setLoading(false)
		}

		supabase.auth
			.getSession()
			.then(({ data }) => apply(data.session))
			.catch(err => {
				console.error('[auth] Could not read the session:', err)
				if (active) {
					setError('Failed to initialise authentication')
					setLoading(false)
				}
			})

		// Fires on sign-in, sign-out, and on every silent token renewal, which
		// is what keeps the mirrored cookie from going stale under a long shift.
		const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
			// INITIAL_SESSION duplicates the getSession above; letting it through
			// would fetch the profile twice on every page load.
			if (event === 'INITIAL_SESSION') return

			if (event === 'TOKEN_REFRESHED') {
				// The person has not changed, only their token. Re-writing the
				// cookie is the whole job — refetching the profile here would
				// mean a request every hour for an answer that has not moved.
				mirrorAccessTokenCookie(next?.access_token ?? null, next?.expires_at ?? null)
				setSession(next)
				return
			}

			void apply(next)
		})

		return () => {
			active = false
			subscription.subscription.unsubscribe()
		}
	}, [loadProfile])

	const login = useCallback((redirectUrl?: string) => {
		startGoogleSignIn(redirectUrl || pathname)
	}, [pathname])

	const loginWithGoogle = useCallback((redirectUrl?: string) => {
		startGoogleSignIn(redirectUrl || pathname)
	}, [pathname])

	const logout = useCallback(async () => {
		const email = user?.email

		setUser(null)
		setSession(null)

		// Best effort, and deliberately first: it marks the session inactive in
		// the library database, which is worth attempting while the token is
		// still valid. A failure here must not leave somebody unable to sign out.
		try {
			await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ email }),
			})
		} catch (err) {
			console.warn('[auth] Could not close the session on the server:', err)
		}

		try {
			await getAuthBrowserClient().auth.signOut()
		} catch (err) {
			console.warn('[auth] Sign-out failed:', err)
		}

		mirrorAccessTokenCookie(null)
		try {
			localStorage.clear()
			sessionStorage.clear()
		} catch {
			// A browser with storage blocked; there was nothing to clear anyway.
		}

		window.location.href = '/login'
	}, [user?.email])

	const refreshSession = useCallback(async (): Promise<boolean> => {
		try {
			const { data, error: refreshError } = await getAuthBrowserClient().auth.refreshSession()
			if (refreshError || !data.session) return false

			mirrorAccessTokenCookie(data.session.access_token, data.session.expires_at ?? null)
			setSession(data.session)
			return true
		} catch {
			return false
		}
	}, [])

	/** Re-reads the role and permissions, for when they have just been changed. */
	const refreshPermissions = useCallback(async (): Promise<void> => {
		const profile = await loadProfile()
		if (profile) setUser(profile)
	}, [loadProfile])

	const getAccessToken = useCallback(() => session?.access_token ?? null, [session?.access_token])

	// Stable refs for permission/role checking to avoid re-creating callbacks on every user change
	const userPermissionsRef = useRef(user?.permissions)
	const userRoleRef = useRef(user?.role)
	const userRolesRef = useRef(user?.roles)
	useEffect(() => {
		userPermissionsRef.current = user?.permissions
		userRoleRef.current = user?.role
		userRolesRef.current = user?.roles
	}, [user?.permissions, user?.role, user?.roles])

	const hasPermission = useCallback((permission: string): boolean => {
		if (user?.is_super_admin) return true
		if (!userPermissionsRef.current) return false
		return userPermissionsRef.current.includes(permission)
	}, [user?.is_super_admin])

	const hasRole = useCallback((role: string): boolean => {
		if (!userRoleRef.current) return false
		if (userRoleRef.current === role) return true
		return userRolesRef.current?.includes(role) ?? false
	}, [])

	const hasAnyRole = useCallback((roles: string[]): boolean => {
		if (!userRoleRef.current) return false
		if (!roles || roles.length === 0) return true
		if (roles.includes(userRoleRef.current)) return true
		return userRolesRef.current?.some(r => roles.includes(r)) ?? false
	}, [])

	const contextValue = useMemo<AuthContextType>(() => ({
		user,
		loading,
		isLoading: loading,
		error,
		isAuthenticated: !!user && !!session,
		login,
		loginWithGoogle,
		logout,
		refreshSession,
		refreshPermissions,
		getAccessToken,
		hasPermission,
		hasRole,
		hasAnyRole,
	}), [
		user,
		loading,
		error,
		session,
		login,
		loginWithGoogle,
		logout,
		refreshSession,
		refreshPermissions,
		getAccessToken,
		hasPermission,
		hasRole,
		hasAnyRole,
	])

	return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

export function useAuth() {
	const context = useContext(AuthContext)
	if (context === undefined) {
		throw new Error('useAuth must be used within an AuthProvider')
	}
	return context
}

export function useIsAuthenticated(): boolean {
	const { isAuthenticated } = useAuth()
	return isAuthenticated
}

export function useCurrentUser(): AppUser | null {
	const { user } = useAuth()
	return user
}
