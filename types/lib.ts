// types/lib.ts — MyjkknLIB Type Definitions

// ── Member ──────────────────────────────────────────────────────────
export type LibMemberCategory = 'learner' | 'facilitator' | 'team_member' | 'guest' | 'alumni'

export interface LibMember {
	id: string
	institution_id: string
	member_number: string
	member_category: LibMemberCategory
	learner_id?: string
	facilitator_id?: string
	team_member_id?: string
	display_name?: string
	email?: string
	phone?: string
	membership_start_date: string
	membership_end_date?: string
	is_active: boolean
	is_delinquent: boolean
	created_at: string
	updated_at: string
	created_by?: string
	// Joined from MyJKKN (not stored locally)
	photo_url?: string
	roll_number?: string
}

export interface LibMemberFilters {
	institution_id?: string
	member_category?: LibMemberCategory
	is_active?: boolean
	is_delinquent?: boolean
	search?: string
	page?: number
	limit?: number
}

// ── Member Category Config ──────────────────────────────────────────
export interface LibMemberCategoryConfig {
	id: string
	institution_id: string
	category_code: string
	category_name: string
	max_items_allowed: number
	loan_period_days: number
	renewal_limit: number
	renewal_period_days: number
	late_charge_per_day: number
	reservation_limit: number
	can_access_digital: boolean
	created_at: string
}

// ── Location ─────────────────────────────────────────────────────────
export interface LibLocation {
	id: string
	institution_id: string
	location_code: string
	location_name: string
	floor?: string
	section?: string
	is_lendable: boolean
	is_active: boolean
	sort_order: number
	created_at: string
}

// ── Catalogue / Resource ─────────────────────────────────────────────
export type LibResourceFormat =
	| 'book' | 'periodical' | 'thesis' | 'report' | 'map'
	| 'audio' | 'video' | 'digital' | 'manuscript' | 'standard' | 'patent' | 'other'

export interface LibCatalogueRecord {
	id: string
	institution_id: string
	title: string
	subtitle?: string
	resource_format: LibResourceFormat
	isbn?: string
	issn?: string
	edition?: string
	volume_number?: string
	publication_year?: number
	language?: string
	classification_number?: string
	call_number?: string
	subject_headings?: string[]
	publisher_name?: string
	publisher_place?: string
	series_title?: string
	pages?: number
	price?: number
	currency_code: string
	marc_data?: Record<string, unknown>
	default_loan_days?: number
	is_reference_only: boolean
	is_active: boolean
	created_at: string
	updated_at: string
	created_by?: string
	// Joined
	authors?: LibCatalogueAuthor[]
	item_count?: number
	available_count?: number
}

export interface LibCatalogueAuthor {
	id: string
	catalogue_record_id: string
	institution_id: string
	author_name: string
	author_type?: 'primary' | 'secondary' | 'editor' | 'translator' | 'illustrator'
	sort_order: number
}

export interface LibCatalogueFilters {
	institution_id?: string
	resource_format?: LibResourceFormat
	location_id?: string
	is_active?: boolean
	is_reference_only?: boolean
	search?: string
	classification_from?: string
	classification_to?: string
	publication_year_from?: number
	publication_year_to?: number
	page?: number
	limit?: number
	// Extended filter fields used by search
	material_type?: string
	subject?: string
	language?: string
	author?: string
	publisher?: string
}

// ── Item ─────────────────────────────────────────────────────────────
export type LibItemStatus =
	| 'available' | 'on_loan' | 'on_hold' | 'on_order' | 'in_conservation'
	| 'lost' | 'damaged' | 'retired' | 'missing'

export type LibItemCondition = 'new' | 'good' | 'fair' | 'poor' | 'damaged' | 'lost'

export interface LibItem {
	id: string
	institution_id: string
	catalogue_record_id: string
	location_id?: string
	accession_number: string
	barcode?: string
	copy_number: number
	condition?: LibItemCondition
	price?: number
	invoice_cost?: number
	mrp_value?: number
	discount?: number
	currency_code: string
	procurement_item_id?: string
	supplier_id?: string
	date_received?: string
	invoice_number?: string
	status: LibItemStatus
	is_lendable: boolean
	is_active: boolean
	accession_date: string
	created_at: string
	updated_at: string
	created_by?: string
	// Joined
	catalogue_record?: LibCatalogueRecord
	location?: LibLocation
}

// ── Circulation ──────────────────────────────────────────────────────
export type LibTransactionStatus = 'active' | 'returned' | 'overdue' | 'lost_by_member' | 'recalled'

export interface LibLendingTransaction {
	id: string
	institution_id: string
	item_id: string
	member_id: string
	issued_at: string
	due_date: string
	issued_by?: string
	returned_at?: string
	returned_by?: string
	return_condition?: string
	renewal_count: number
	last_renewed_at?: string
	transaction_status: LibTransactionStatus
	created_at: string
	updated_at: string
	// Joined
	item?: LibItem
	member?: LibMember
	overdue_days?: number
	late_charge_amount?: number
}

export interface LibResourceHold {
	id: string
	institution_id: string
	catalogue_record_id: string
	member_id: string
	item_id?: string
	hold_placed_at: string
	hold_expires_at?: string
	notified_at?: string
	checked_out_at?: string
	hold_status: 'pending' | 'available' | 'fulfilled' | 'cancelled' | 'expired'
	cancellation_reason?: string
	placed_by?: string
	created_at: string
	updated_at: string
	catalogue_record?: LibCatalogueRecord
	member?: LibMember
}

// ── Late Charges ──────────────────────────────────────────────────────
export type LibChargePaymentStatus = 'unpaid' | 'paid' | 'waived' | 'partial'

export interface LibLateCharge {
	id: string
	institution_id: string
	transaction_id: string
	member_id: string
	overdue_days: number
	charge_per_day: number
	total_charge: number
	waiver_amount: number
	net_payable: number
	payment_status: LibChargePaymentStatus
	payment_date?: string
	payment_reference?: string
	collected_by?: string
	waiver_reason?: string
	waiver_approved_by?: string
	created_at: string
	updated_at: string
	transaction?: LibLendingTransaction
	member?: LibMember
}

// ── Procurement ────────────────────────────────────────────────────────
export type LibProcurementRequestStatus =
	| 'pending' | 'approved' | 'rejected' | 'ordered' | 'received' | 'cancelled'

export type LibOrderStatus =
	| 'draft' | 'placed' | 'acknowledged' | 'partially_received' | 'received' | 'cancelled' | 'claimed'

export interface LibSupplier {
	id: string
	institution_id: string
	supplier_code: string
	supplier_name: string
	contact_person?: string
	email?: string
	phone?: string
	address?: string
	city?: string
	state?: string
	pincode?: string
	gst_number?: string
	pan_number?: string
	payment_terms?: string
	is_active: boolean
	created_at: string
	updated_at: string
}

export interface LibBudgetHead {
	id: string
	institution_id: string
	fiscal_year: string
	budget_head_code: string
	budget_head_name: string
	resource_type?: 'books' | 'periodicals' | 'digital' | 'binding' | 'equipment' | 'other'
	allocated_amount: number
	spent_amount: number
	committed_amount: number
	is_active: boolean
	created_at: string
	updated_at: string
	// computed
	available_amount?: number
	utilisation_percent?: number
}

export interface LibProcurementRequest {
	id: string
	institution_id: string
	request_number: string
	requested_by?: string
	title: string
	author?: string
	publisher?: string
	edition?: string
	isbn?: string
	resource_format: string
	quantity: number
	estimated_price?: number
	currency_code: string
	budget_head_id?: string
	purpose?: string
	department?: string
	priority: 'low' | 'normal' | 'high' | 'urgent'
	request_status: LibProcurementRequestStatus
	approved_by?: string
	approved_at?: string
	rejection_reason?: string
	catalogue_record_id?: string
	created_at: string
	updated_at: string
}

export interface LibProcurementOrder {
	id: string
	institution_id: string
	order_number: string
	supplier_id: string
	budget_head_id?: string
	fiscal_year?: string
	order_date: string
	expected_delivery_date?: string
	order_type: 'firm' | 'on_approval' | 'gift' | 'exchange'
	total_amount?: number
	currency_code: string
	order_status: LibOrderStatus
	claim_date?: string
	notes?: string
	created_at: string
	updated_at: string
	created_by?: string
	supplier?: LibSupplier
	items?: LibProcurementItem[]
}

export interface LibProcurementItem {
	id: string
	institution_id: string
	order_id: string
	request_id?: string
	catalogue_record_id?: string
	title: string
	isbn?: string
	quantity_ordered: number
	quantity_received: number
	unit_price?: number
	discount_percent?: number
	net_price?: number
	total_price?: number
	item_status: 'pending' | 'received' | 'cancelled' | 'claimed'
	created_at: string
}

// ── Periodicals ──────────────────────────────────────────────────────
export type LibSubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'gratis' | 'suspended'
export type LibIssueReceiptStatus = 'expected' | 'received' | 'missing' | 'claimed' | 'duplicate'

export interface LibPeriodicalSubscription {
	id: string
	institution_id: string
	catalogue_record_id: string
	supplier_id?: string
	budget_head_id?: string
	subscription_number?: string
	subscription_type?: 'print' | 'online' | 'both'
	frequency?: string
	fiscal_year: string
	start_date?: string
	end_date?: string
	subscription_cost?: number
	currency_code: string
	start_volume?: string
	start_issue?: string
	expected_issues?: number
	received_issues: number
	access_url?: string
	subscription_status: LibSubscriptionStatus
	is_gratis: boolean
	created_at: string
	updated_at: string
	catalogue_record?: LibCatalogueRecord
	supplier?: LibSupplier
}

export interface LibPeriodicalIssue {
	id: string
	institution_id: string
	subscription_id: string
	item_id?: string
	volume_number?: string
	issue_number?: string
	issue_date?: string
	received_date?: string
	cover_date?: string
	pages?: number
	receipt_status: LibIssueReceiptStatus
	is_bound: boolean
	created_at: string
}

// ── Digital Resources ─────────────────────────────────────────────────
export type LibDigitalResourceType =
	| 'ebook' | 'ejournal' | 'database' | 'open_access' | 'inflibnet' | 'institutional_repository' | 'other'

export interface LibDigitalResource {
	id: string
	institution_id: string
	resource_title: string
	resource_type: LibDigitalResourceType
	provider?: string
	access_url: string
	username?: string
	password_hint?: string
	coverage_years?: string
	subject_areas?: string[]
	subscription_start?: string
	subscription_end?: string
	annual_cost?: number
	concurrent_users?: number
	is_active: boolean
	is_open_access: boolean
	naac_reportable: boolean
	created_at: string
	updated_at: string
}

// ── Retirement ───────────────────────────────────────────────────────
export interface LibRetirementRequest {
	id: string
	institution_id: string
	item_id: string
	reason: string
	condition_at_retirement?: string
	recommended_by?: string
	approved_by?: string
	approval_date?: string
	retirement_status: 'pending' | 'approved' | 'rejected' | 'completed'
	rejection_reason?: string
	created_at: string
	updated_at: string
	item?: LibItem
}

// ── Inter-Campus ─────────────────────────────────────────────────────
export interface LibIntercampusRequest {
	id: string
	institution_id: string
	providing_institution_id?: string
	member_id: string
	catalogue_record_id?: string
	title: string
	author?: string
	isbn?: string
	request_date: string
	due_date?: string
	returned_date?: string
	request_status: 'pending' | 'approved' | 'dispatched' | 'received' | 'returned' | 'rejected' | 'lost'
	item_id?: string
	request_note?: string
	approved_note?: string
	created_at: string
	updated_at: string
	member?: LibMember
}

// ── Conservation ─────────────────────────────────────────────────────
export interface LibConservationRequest {
	id: string
	institution_id: string
	conservation_type: 'binding' | 'repair' | 'lamination' | 'digitisation'
	item_id?: string
	subscription_id?: string
	sent_to_binder?: string
	expected_return?: string
	actual_return?: string
	binder_name?: string
	binder_invoice?: string
	binding_cost?: number
	conservation_status: 'identified' | 'sent' | 'returned' | 'cancelled'
	created_at: string
	updated_at: string
	item?: LibItem
}

// ── Member Visits ────────────────────────────────────────────────────
export interface LibMemberVisit {
	id: string
	institution_id: string
	member_id?: string
	visit_date: string
	entry_time?: string
	exit_time?: string
	visit_purpose?: 'reading' | 'borrowing' | 'returning' | 'research' | 'opac' | 'digital' | 'other'
	created_at: string
}

// ── Reports ──────────────────────────────────────────────────────────
export interface LibNaacCriterion4Report {
	institution_id: string
	academic_year: string
	total_volumes: number
	volumes_added_this_year: number
	total_titles: number
	print_journals_subscribed: number
	digital_resources_count: number
	inflibnet_databases: number
	annual_books_expenditure: number
	annual_journals_expenditure: number
	annual_digital_expenditure: number
	total_annual_expenditure: number
	daily_avg_footfall: number
	total_annual_visits: number
	active_members: number
	total_lending_transactions: number
	generated_at: string
}

export interface LibAccessionRegisterEntry {
	accession_number: string
	accession_date: string
	title: string
	author: string
	edition?: string
	publisher_name?: string
	publication_year?: number
	classification_number?: string
	call_number?: string
	price?: number
	supplier_name?: string
	invoice_number?: string
	budget_head?: string
	barcode?: string
	location_name?: string
}

export interface LibCirculationSummary {
	date: string
	items_issued: number
	items_returned: number
	renewals: number
	holds_placed: number
	charges_collected: number
}

// ── Accession Sequence ───────────────────────────────────────────────
export interface LibAccessionSequence {
	id: string
	institution_id: string
	resource_type_code: string
	fiscal_year: string
	last_number: number
}

// ── Shared ───────────────────────────────────────────────────────────
export interface LibListResponse<T> {
	data: T[]
	metadata: {
		total: number
		page: number
		limit: number
		total_pages: number
	}
}

// ── Catalogue (extended filters) ─────────────────────────────────────
export interface LibCatalogueSearchResult extends LibCatalogueRecord {
	relevance_score?: number
	highlight?: string
}

// ── Circulation (service types) ───────────────────────────────────────
export type LibCirculationTransaction = LibLendingTransaction

export interface LibIssuePayload {
	member_id: string
	item_id: string
	institution_id: string
	issued_by?: string
}

export interface LibReturnPayload {
	transaction_id: string
	institution_id: string
	return_condition?: string
	returned_by?: string
}

export interface LibRenewPayload {
	transaction_id: string
	institution_id: string
}

export type LibHold = LibResourceHold

// ── Late Charges (service types) ─────────────────────────────────────
export interface LibPaymentPayload {
	payment_reference?: string
	payment_amount?: number
}

export interface LibWaivePayload {
	waiver_amount: number
	waiver_reason?: string
}

export interface LibChargeCalculation {
	transaction_id: string
	overdue_days: number
	charge_per_day: number
	total_charge: number
	calculated_at: string
}
