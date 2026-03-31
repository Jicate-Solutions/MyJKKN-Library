import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

/**
 * Logout endpoint - invalidates sessions in both sessions and user_sessions tables
 */
export async function POST(request: Request) {
	try {
		const body = await request.json()
		const { email, access_token } = body

		if (!email && !access_token) {
			return NextResponse.json({ error: 'Email or access_token is required' }, { status: 400 })
		}

		const supabase = getSupabaseServer()
		const nowISO = new Date().toISOString()

		// Find user by email
		let userId: string | null = null

		if (email) {
			const { data: userData } = await supabase
				.from('users')
				.select('id')
				.eq('email', email)
				.single()

			userId = userData?.id || null
		}

		// 1. Invalidate sessions by access_token if provided
		if (access_token) {
			await supabase
				.from('sessions')
				.update({ is_active: false, updated_at: nowISO })
				.eq('session_token', access_token)
		}

		// 2. If we have userId, invalidate all active sessions for this user
		if (userId) {
			// Mark all sessions as inactive
			await supabase
				.from('sessions')
				.update({ is_active: false, updated_at: nowISO })
				.eq('user_id', userId)
				.eq('is_active', true)

			// Delete from user_sessions
			await supabase
				.from('user_sessions')
				.delete()
				.eq('user_id', userId)
		}

		return NextResponse.json({
			success: true,
			message: 'Sessions invalidated successfully'
		})
	} catch (error) {
		console.error('Logout error:', error)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
