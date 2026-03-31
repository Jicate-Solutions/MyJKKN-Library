import { NextRequest, NextResponse } from 'next/server'

const MYJKKN_BASE_URL = process.env.MYJKKN_API_URL || 'https://www.jkkn.ai/api'
const MYJKKN_API_KEY = process.env.MYJKKN_API_KEY || ''

export async function GET(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	try {
		const staffId = params.id
		if (!staffId) {
			return NextResponse.json({ error: 'Staff ID is required' }, { status: 400 })
		}

		const response = await fetch(`${MYJKKN_BASE_URL}/api-management/staff/${staffId}`, {
			headers: {
				'Authorization': `Bearer ${MYJKKN_API_KEY}`,
				'Content-Type': 'application/json',
			},
			cache: 'no-store',
		})

		if (!response.ok) {
			if (response.status === 404) {
				return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
			}
			return NextResponse.json(
				{ error: `Failed to fetch staff details: ${response.statusText}` },
				{ status: response.status }
			)
		}

		const data = await response.json()
		return NextResponse.json(data)
	} catch (error) {
		console.error('MyJKKN Staff Detail API Error:', error)
		return NextResponse.json({ error: 'Failed to fetch staff details' }, { status: 500 })
	}
}
