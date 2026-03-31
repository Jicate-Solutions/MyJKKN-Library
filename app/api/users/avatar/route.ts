import { NextResponse } from 'next/server'

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url)
	const email = searchParams.get('email')

	if (!email) {
		return NextResponse.json({ error: 'email is required' }, { status: 400 })
	}

	// No local users table yet — return null so frontend falls back to DiceBear avatar
	return NextResponse.json({ avatar_url: null })
}
