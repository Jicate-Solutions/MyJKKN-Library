-- =============================================================================
-- MyjkknLIB — Full Supabase Migration (All Parts Combined)
-- Target: lbmkvwwpxaoojfhmvtlz.supabase.co
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- =============================================================================

-- SECTION 0: Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- PART 1: Core Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS lib_member_categories (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  category_code         TEXT NOT NULL,
  category_name         TEXT NOT NULL,
  max_items_allowed     INTEGER NOT NULL DEFAULT 3,
  loan_period_days      INTEGER NOT NULL DEFAULT 14,
  renewal_limit         INTEGER NOT NULL DEFAULT 2,
  renewal_period_days   INTEGER NOT NULL DEFAULT 7,
  late_charge_per_day   NUMERIC(8,2) NOT NULL DEFAULT 1.00,
  reservation_limit     INTEGER NOT NULL DEFAULT 2,
  can_access_digital    BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, category_code)
);

CREATE TABLE IF NOT EXISTS lib_locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  location_code         TEXT NOT NULL,
  location_name         TEXT NOT NULL,
  floor                 TEXT,
  section               TEXT,
  is_lendable           BOOLEAN NOT NULL DEFAULT true,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, location_code)
);

CREATE TABLE IF NOT EXISTS lib_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  member_number         TEXT NOT NULL,
  member_category       TEXT NOT NULL CHECK (member_category IN ('learner', 'facilitator', 'team_member', 'guest', 'alumni')),
  learner_id            UUID,
  facilitator_id        UUID,
  team_member_id        UUID,
  display_name          TEXT,
  email                 TEXT,
  phone                 TEXT,
  membership_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  membership_end_date   DATE,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  is_delinquent         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  UNIQUE(institution_id, member_number)
);

CREATE INDEX IF NOT EXISTS idx_lib_members_institution    ON lib_members(institution_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lib_members_learner_id     ON lib_members(learner_id) WHERE learner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lib_members_facilitator_id ON lib_members(facilitator_id) WHERE facilitator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lib_members_delinquent     ON lib_members(institution_id, is_delinquent) WHERE is_delinquent = true;

CREATE TABLE IF NOT EXISTS lib_catalogue_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  title                 TEXT NOT NULL,
  subtitle              TEXT,
  resource_format       TEXT NOT NULL DEFAULT 'book' CHECK (resource_format IN ('book', 'periodical', 'thesis', 'report', 'map', 'audio', 'video', 'digital', 'manuscript', 'standard', 'patent', 'other')),
  isbn                  TEXT,
  issn                  TEXT,
  edition               TEXT,
  volume_number         TEXT,
  publication_year      INTEGER,
  language              TEXT NOT NULL DEFAULT 'English',
  classification_number TEXT,
  call_number           TEXT,
  subject_headings      TEXT[],
  publisher_name        TEXT,
  publisher_place       TEXT,
  series_title          TEXT,
  pages                 INTEGER,
  price                 NUMERIC(10,2),
  currency_code         TEXT NOT NULL DEFAULT 'INR',
  marc_data             JSONB,
  default_loan_days     INTEGER,
  is_reference_only     BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID
);

CREATE INDEX IF NOT EXISTS idx_lib_cat_title_fts ON lib_catalogue_records USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(subtitle,'')));
CREATE INDEX IF NOT EXISTS idx_lib_cat_isbn      ON lib_catalogue_records(isbn) WHERE isbn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lib_cat_issn      ON lib_catalogue_records(issn) WHERE issn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lib_cat_class     ON lib_catalogue_records(institution_id, classification_number);
CREATE INDEX IF NOT EXISTS idx_lib_cat_format    ON lib_catalogue_records(institution_id, resource_format);
CREATE INDEX IF NOT EXISTS idx_lib_cat_year      ON lib_catalogue_records(publication_year);

CREATE TABLE IF NOT EXISTS lib_catalogue_authors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_record_id   UUID NOT NULL REFERENCES lib_catalogue_records(id) ON DELETE CASCADE,
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  author_name           TEXT NOT NULL,
  author_type           TEXT NOT NULL DEFAULT 'primary' CHECK (author_type IN ('primary', 'secondary', 'editor', 'translator', 'illustrator')),
  sort_order            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lib_authors_record ON lib_catalogue_authors(catalogue_record_id);
CREATE INDEX IF NOT EXISTS idx_lib_authors_name   ON lib_catalogue_authors USING gin(to_tsvector('english', author_name));

CREATE TABLE IF NOT EXISTS lib_suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  supplier_code         TEXT NOT NULL,
  supplier_name         TEXT NOT NULL,
  contact_person        TEXT,
  email                 TEXT,
  phone                 TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT,
  gst_number            TEXT,
  pan_number            TEXT,
  payment_terms         TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS lib_accession_sequences (
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  resource_type_code    TEXT NOT NULL,
  fiscal_year           TEXT NOT NULL,
  last_number           BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (institution_id, resource_type_code, fiscal_year)
);

CREATE TABLE IF NOT EXISTS lib_budget_heads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  fiscal_year           TEXT NOT NULL,
  budget_head_code      TEXT NOT NULL,
  budget_head_name      TEXT NOT NULL,
  resource_type         TEXT CHECK (resource_type IN ('books', 'periodicals', 'digital', 'binding', 'equipment', 'other')),
  allocated_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  spent_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  committed_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, fiscal_year, budget_head_code)
);

-- =============================================================================
-- PART 2: Items + Circulation + Procurement
-- =============================================================================

CREATE TABLE IF NOT EXISTS lib_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  catalogue_record_id   UUID NOT NULL REFERENCES lib_catalogue_records(id) ON DELETE RESTRICT,
  location_id           UUID REFERENCES lib_locations(id) ON DELETE SET NULL,
  accession_number      TEXT NOT NULL,
  barcode               TEXT,
  copy_number           INTEGER NOT NULL DEFAULT 1,
  condition             TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'poor', 'damaged', 'lost')),
  price                 NUMERIC(10,2),
  invoice_cost          NUMERIC(10,2),
  mrp_value             NUMERIC(10,2),
  discount              NUMERIC(10,2),
  currency_code         TEXT NOT NULL DEFAULT 'INR',
  procurement_item_id   UUID,
  supplier_id           UUID REFERENCES lib_suppliers(id) ON DELETE SET NULL,
  date_received         DATE,
  invoice_number        TEXT,
  status                TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_loan', 'on_hold', 'on_order', 'in_conservation', 'lost', 'damaged', 'retired', 'missing')),
  is_lendable           BOOLEAN NOT NULL DEFAULT true,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  accession_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  UNIQUE(institution_id, accession_number),
  UNIQUE(institution_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_lib_items_catalogue   ON lib_items(catalogue_record_id);
CREATE INDEX IF NOT EXISTS idx_lib_items_status      ON lib_items(institution_id, status);
CREATE INDEX IF NOT EXISTS idx_lib_items_location    ON lib_items(location_id);
CREATE INDEX IF NOT EXISTS idx_lib_items_barcode     ON lib_items(institution_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lib_items_accession   ON lib_items(institution_id, accession_number);
CREATE INDEX IF NOT EXISTS idx_lib_items_date        ON lib_items(institution_id, accession_date);

CREATE TABLE IF NOT EXISTS lib_lending_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  item_id               UUID NOT NULL REFERENCES lib_items(id) ON DELETE RESTRICT,
  member_id             UUID NOT NULL REFERENCES lib_members(id) ON DELETE RESTRICT,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date              DATE NOT NULL,
  issued_by             UUID,
  returned_at           TIMESTAMPTZ,
  returned_by           UUID,
  return_condition      TEXT,
  renewal_count         INTEGER NOT NULL DEFAULT 0,
  last_renewed_at       TIMESTAMPTZ,
  transaction_status    TEXT NOT NULL DEFAULT 'active' CHECK (transaction_status IN ('active', 'returned', 'overdue', 'lost_by_member', 'recalled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_lending_member     ON lib_lending_transactions(member_id, transaction_status);
CREATE INDEX IF NOT EXISTS idx_lib_lending_item       ON lib_lending_transactions(item_id, transaction_status);
CREATE INDEX IF NOT EXISTS idx_lib_lending_active_due ON lib_lending_transactions(institution_id, due_date) WHERE transaction_status = 'active';
CREATE INDEX IF NOT EXISTS idx_lib_lending_issued     ON lib_lending_transactions(institution_id, issued_at);

CREATE TABLE IF NOT EXISTS lib_resource_holds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  catalogue_record_id   UUID NOT NULL REFERENCES lib_catalogue_records(id) ON DELETE CASCADE,
  member_id             UUID NOT NULL REFERENCES lib_members(id) ON DELETE CASCADE,
  item_id               UUID REFERENCES lib_items(id) ON DELETE SET NULL,
  hold_placed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  hold_expires_at       DATE,
  notified_at           TIMESTAMPTZ,
  checked_out_at        TIMESTAMPTZ,
  hold_status           TEXT NOT NULL DEFAULT 'pending' CHECK (hold_status IN ('pending', 'available', 'fulfilled', 'cancelled', 'expired')),
  cancellation_reason   TEXT,
  placed_by             UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_holds_member    ON lib_resource_holds(member_id, hold_status);
CREATE INDEX IF NOT EXISTS idx_lib_holds_catalogue ON lib_resource_holds(catalogue_record_id, hold_status);

CREATE TABLE IF NOT EXISTS lib_late_charges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  transaction_id        UUID NOT NULL REFERENCES lib_lending_transactions(id) ON DELETE RESTRICT,
  member_id             UUID NOT NULL REFERENCES lib_members(id) ON DELETE RESTRICT,
  overdue_days          INTEGER NOT NULL,
  charge_per_day        NUMERIC(8,2) NOT NULL,
  total_charge          NUMERIC(10,2) NOT NULL,
  waiver_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_payable           NUMERIC(10,2) NOT NULL,
  payment_status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'waived', 'partial')),
  payment_date          DATE,
  payment_reference     TEXT,
  collected_by          UUID,
  waiver_reason         TEXT,
  waiver_approved_by    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_charges_member ON lib_late_charges(member_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_lib_charges_unpaid ON lib_late_charges(institution_id, payment_status) WHERE payment_status = 'unpaid';

CREATE TABLE IF NOT EXISTS lib_procurement_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  request_number        TEXT NOT NULL,
  requested_by          UUID,
  title                 TEXT NOT NULL,
  author                TEXT,
  publisher             TEXT,
  edition               TEXT,
  isbn                  TEXT,
  resource_format       TEXT NOT NULL DEFAULT 'book',
  quantity              INTEGER NOT NULL DEFAULT 1,
  estimated_price       NUMERIC(10,2),
  currency_code         TEXT NOT NULL DEFAULT 'INR',
  budget_head_id        UUID REFERENCES lib_budget_heads(id) ON DELETE SET NULL,
  purpose               TEXT,
  department            TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  request_status        TEXT NOT NULL DEFAULT 'pending' CHECK (request_status IN ('pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled')),
  approved_by           UUID,
  approved_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  catalogue_record_id   UUID REFERENCES lib_catalogue_records(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, request_number)
);

CREATE TABLE IF NOT EXISTS lib_procurement_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  order_number          TEXT NOT NULL,
  supplier_id           UUID NOT NULL REFERENCES lib_suppliers(id) ON DELETE RESTRICT,
  budget_head_id        UUID REFERENCES lib_budget_heads(id) ON DELETE SET NULL,
  fiscal_year           TEXT,
  order_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  order_type            TEXT NOT NULL DEFAULT 'firm' CHECK (order_type IN ('firm', 'on_approval', 'gift', 'exchange')),
  total_amount          NUMERIC(14,2),
  currency_code         TEXT NOT NULL DEFAULT 'INR',
  order_status          TEXT NOT NULL DEFAULT 'placed' CHECK (order_status IN ('draft', 'placed', 'acknowledged', 'partially_received', 'received', 'cancelled', 'claimed')),
  claim_date            DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  UNIQUE(institution_id, order_number)
);

CREATE TABLE IF NOT EXISTS lib_procurement_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  order_id              UUID NOT NULL REFERENCES lib_procurement_orders(id) ON DELETE CASCADE,
  request_id            UUID REFERENCES lib_procurement_requests(id) ON DELETE SET NULL,
  catalogue_record_id   UUID REFERENCES lib_catalogue_records(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  isbn                  TEXT,
  quantity_ordered      INTEGER NOT NULL DEFAULT 1,
  quantity_received     INTEGER NOT NULL DEFAULT 0,
  unit_price            NUMERIC(10,2),
  discount_percent      NUMERIC(5,2) NOT NULL DEFAULT 0,
  net_price             NUMERIC(10,2),
  total_price           NUMERIC(10,2),
  item_status           TEXT NOT NULL DEFAULT 'pending' CHECK (item_status IN ('pending', 'received', 'cancelled', 'claimed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_proc_items_order ON lib_procurement_items(order_id);

-- =============================================================================
-- PART 3: Periodicals + Digital + Visits + Retirement + Conservation + Inter-Campus
-- =============================================================================

CREATE TABLE IF NOT EXISTS lib_periodical_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  catalogue_record_id   UUID NOT NULL REFERENCES lib_catalogue_records(id) ON DELETE RESTRICT,
  supplier_id           UUID REFERENCES lib_suppliers(id) ON DELETE SET NULL,
  budget_head_id        UUID REFERENCES lib_budget_heads(id) ON DELETE SET NULL,
  subscription_number   TEXT,
  subscription_type     TEXT CHECK (subscription_type IN ('print', 'online', 'both')),
  frequency             TEXT CHECK (frequency IN ('daily', 'weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'half_yearly', 'annual', 'irregular')),
  fiscal_year           TEXT NOT NULL,
  start_date            DATE,
  end_date              DATE,
  subscription_cost     NUMERIC(10,2),
  currency_code         TEXT NOT NULL DEFAULT 'INR',
  start_volume          TEXT,
  start_issue           TEXT,
  expected_issues       INTEGER,
  received_issues       INTEGER NOT NULL DEFAULT 0,
  access_url            TEXT,
  login_id              TEXT,
  password_hint         TEXT,
  subscription_status   TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'expired', 'cancelled', 'gratis', 'suspended')),
  is_gratis             BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_subs_institution ON lib_periodical_subscriptions(institution_id, subscription_status);

CREATE TABLE IF NOT EXISTS lib_periodical_issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subscription_id       UUID NOT NULL REFERENCES lib_periodical_subscriptions(id) ON DELETE CASCADE,
  item_id               UUID REFERENCES lib_items(id) ON DELETE SET NULL,
  volume_number         TEXT,
  issue_number          TEXT,
  issue_date            DATE,
  received_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  cover_date            TEXT,
  pages                 INTEGER,
  receipt_status        TEXT NOT NULL DEFAULT 'received' CHECK (receipt_status IN ('expected', 'received', 'missing', 'claimed', 'duplicate')),
  is_bound              BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_issues_sub ON lib_periodical_issues(subscription_id, received_date);

CREATE TABLE IF NOT EXISTS lib_digital_resources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  resource_title        TEXT NOT NULL,
  resource_type         TEXT NOT NULL CHECK (resource_type IN ('ebook', 'ejournal', 'database', 'open_access', 'inflibnet', 'institutional_repository', 'other')),
  provider              TEXT,
  access_url            TEXT NOT NULL,
  username              TEXT,
  password_hint         TEXT,
  coverage_years        TEXT,
  subject_areas         TEXT[],
  subscription_start    DATE,
  subscription_end      DATE,
  annual_cost           NUMERIC(10,2),
  concurrent_users      INTEGER,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  is_open_access        BOOLEAN NOT NULL DEFAULT false,
  naac_reportable       BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lib_member_visits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  member_id             UUID REFERENCES lib_members(id) ON DELETE SET NULL,
  visit_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_time            TIME,
  exit_time             TIME,
  visit_purpose         TEXT CHECK (visit_purpose IN ('reading', 'borrowing', 'returning', 'research', 'opac', 'digital', 'other')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lib_visits_date        ON lib_member_visits(institution_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_lib_visits_member_date ON lib_member_visits(member_id, visit_date);

CREATE TABLE IF NOT EXISTS lib_retirement_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  item_id               UUID NOT NULL REFERENCES lib_items(id) ON DELETE RESTRICT,
  reason                TEXT NOT NULL,
  condition_at_retirement TEXT,
  recommended_by        UUID,
  approved_by           UUID,
  approval_date         DATE,
  retirement_status     TEXT NOT NULL DEFAULT 'pending' CHECK (retirement_status IN ('pending', 'approved', 'rejected', 'completed')),
  rejection_reason      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lib_conservation_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  conservation_type     TEXT NOT NULL CHECK (conservation_type IN ('binding', 'repair', 'lamination', 'digitisation')),
  item_id               UUID REFERENCES lib_items(id) ON DELETE SET NULL,
  subscription_id       UUID REFERENCES lib_periodical_subscriptions(id) ON DELETE SET NULL,
  sent_to_binder        DATE,
  expected_return       DATE,
  actual_return         DATE,
  binder_name           TEXT,
  binder_invoice        TEXT,
  binding_cost          NUMERIC(10,2),
  conservation_status   TEXT NOT NULL DEFAULT 'identified' CHECK (conservation_status IN ('identified', 'sent', 'returned', 'cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lib_intercampus_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  providing_institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  member_id             UUID NOT NULL REFERENCES lib_members(id) ON DELETE RESTRICT,
  catalogue_record_id   UUID REFERENCES lib_catalogue_records(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  author                TEXT,
  isbn                  TEXT,
  request_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date              DATE,
  returned_date         DATE,
  request_status        TEXT NOT NULL DEFAULT 'pending' CHECK (request_status IN ('pending', 'approved', 'dispatched', 'received', 'returned', 'rejected', 'lost')),
  item_id               UUID REFERENCES lib_items(id) ON DELETE SET NULL,
  request_note          TEXT,
  approved_note         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PART 4: RLS Policies
-- =============================================================================

ALTER TABLE lib_member_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_locations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_members                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_catalogue_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_catalogue_authors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_accession_sequences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_items                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_lending_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_resource_holds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_late_charges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_suppliers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_budget_heads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_procurement_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_procurement_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_procurement_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_periodical_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_periodical_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_digital_resources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_member_visits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_retirement_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_conservation_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lib_intercampus_requests    ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PART 5: Helper Functions
-- =============================================================================

CREATE OR REPLACE FUNCTION lib_next_accession(
  p_institution_id  UUID,
  p_resource_type   TEXT,
  p_fiscal_year     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq       BIGINT;
  v_inst_code TEXT;
BEGIN
  SELECT institution_code INTO v_inst_code
  FROM institutions WHERE id = p_institution_id;

  INSERT INTO lib_accession_sequences (institution_id, resource_type_code, fiscal_year, last_number)
    VALUES (p_institution_id, p_resource_type, p_fiscal_year, 1)
  ON CONFLICT (institution_id, resource_type_code, fiscal_year)
  DO UPDATE SET last_number = lib_accession_sequences.last_number + 1
  RETURNING last_number INTO v_seq;

  RETURN upper(v_inst_code) || '/' || p_resource_type || '/' || p_fiscal_year || '/' || lpad(v_seq::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION lib_overdue_days(p_due_date DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(0, CURRENT_DATE - p_due_date);
$$;

-- =============================================================================
-- END OF MIGRATION — 22 tables, 30+ indexes, 2 functions created
-- =============================================================================
