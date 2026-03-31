import { NextRequest, NextResponse } from 'next/server'

const publicRoutes = [
	'/login',
	'/auth/callback',
	'/opac',
	'/',
]

const publicApiRoutes = [
	'/api/auth',
	'/api/myjkkn',
	'/api/lib/catalogue/search',
]

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl
	const res = NextResponse.next()

	if (publicRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'))) {
		return res
	}

	if (publicApiRoutes.some((route) => pathname.startsWith(route))) {
		return res
	}

	if (
		pathname.startsWith('/_next') ||
		pathname.startsWith('/static') ||
		pathname.includes('.')
	) {
		return res
	}

	const accessToken = request.cookies.get('access_token')?.value

	if (!accessToken) {
		if (pathname.startsWith('/api')) {
			return NextResponse.json(
				{ error: 'Authentication required' },
				{ status: 401 }
			)
		}

		const url = request.nextUrl.clone()
		url.pathname = '/login'
		url.searchParams.set('redirect', pathname)
		return NextResponse.redirect(url)
	}

	return res
}

export const config = {
	matcher: [
		'/((?!_next/static|_next/image|favicon.ico|public).*)',
	],
}
