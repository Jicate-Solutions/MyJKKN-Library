import type {
	LibProcurementRequest,
	LibPurchaseOrder,
	LibOrderItemReceival,
} from '@/types/lib'

export async function fetchRequests(institutionId: string): Promise<LibProcurementRequest[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/procurement/requests?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch procurement requests')
	}
	return res.json()
}

export async function createRequest(data: Partial<LibProcurementRequest>): Promise<LibProcurementRequest> {
	const res = await fetch('/api/lib/procurement/requests', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create procurement request')
	}
	return res.json()
}

export async function updateRequest(id: string, data: Partial<LibProcurementRequest>): Promise<LibProcurementRequest> {
	const res = await fetch(`/api/lib/procurement/requests/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update procurement request')
	}
	return res.json()
}

export async function approveRequest(id: string, approvedBy: string): Promise<LibProcurementRequest> {
	const res = await fetch(`/api/lib/procurement/requests/${id}/approve`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ approved_by: approvedBy }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to approve procurement request')
	}
	return res.json()
}

export async function rejectRequest(id: string, reason: string): Promise<LibProcurementRequest> {
	const res = await fetch(`/api/lib/procurement/requests/${id}/reject`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reason }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to reject procurement request')
	}
	return res.json()
}

export async function fetchOrders(institutionId: string): Promise<LibPurchaseOrder[]> {
	const params = new URLSearchParams()
	params.set('institution_id', institutionId)

	const res = await fetch(`/api/lib/procurement/orders?${params}`)
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to fetch purchase orders')
	}
	return res.json()
}

export async function createOrder(data: Partial<LibPurchaseOrder>): Promise<LibPurchaseOrder> {
	const res = await fetch('/api/lib/procurement/orders', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to create purchase order')
	}
	return res.json()
}

export async function updateOrder(id: string, data: Partial<LibPurchaseOrder>): Promise<LibPurchaseOrder> {
	const res = await fetch(`/api/lib/procurement/orders/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to update purchase order')
	}
	return res.json()
}

export async function receiveOrderItems(orderId: string, items: LibOrderItemReceival[]): Promise<LibPurchaseOrder> {
	const res = await fetch(`/api/lib/procurement/orders/${orderId}/receive`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ items }),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to receive order items')
	}
	return res.json()
}
