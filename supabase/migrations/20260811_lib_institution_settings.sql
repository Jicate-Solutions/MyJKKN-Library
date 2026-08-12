-- Per-institution library policy.
--
-- Every campus runs its own library with its own rules, so nothing here is
-- global: one row per institution, and a campus with no row falls back to the
-- code defaults. Adding Pharmacy's row cannot change how any other college
-- behaves.
--
-- The borrowing limits themselves (books, days, renewals, fine per day) already
-- live in lib_member_categories per institution. This table holds the policy
-- around them that had nowhere to live.

create table if not exists lib_institution_settings (
	institution_id uuid primary key references institutions(id) on delete cascade,

	-- Fines
	fine_grace_days integer not null default 0,
	fine_max_per_item numeric(10, 2),                      -- null = no cap
	fine_working_days_only boolean not null default false,
	block_borrowing_when_fine_due boolean not null default true,
	lost_item_processing_percent numeric(5, 2) not null default 0,

	-- Accession numbering for items
	accession_prefix text not null default 'ACC-',
	accession_start_number integer not null default 1,
	accession_pad_width integer not null default 4,
	accession_resets_yearly boolean not null default true,

	-- Member numbering
	member_number_source text not null default 'auto'
		check (member_number_source in ('auto', 'college_id')),
	member_number_prefix text not null default 'LIB',

	-- Desk
	opening_time time not null default '09:00',
	closing_time time not null default '16:30',
	requires_no_dues boolean not null default false,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table lib_institution_settings is
	'One row per institution. Library policy that is not per member category.';

-- JKKN College of Pharmacy: 15 day loan, Rs.5 per day, no grace, no cap,
-- working days only, unpaid fines do not block borrowing, lost book costs
-- price + 50%. Accession numbers are a plain running number from 101 that
-- never resets, and the member number is the learner's college ID.
insert into lib_institution_settings (
	institution_id,
	fine_grace_days,
	fine_max_per_item,
	fine_working_days_only,
	block_borrowing_when_fine_due,
	lost_item_processing_percent,
	accession_prefix,
	accession_start_number,
	accession_pad_width,
	accession_resets_yearly,
	member_number_source,
	opening_time,
	closing_time,
	requires_no_dues
)
select
	id,
	0,
	null,
	true,
	false,
	50,
	'',
	101,
	0,
	false,
	'college_id',
	'09:00',
	'16:30',
	true
from institutions
where institution_code = 'COP'
on conflict (institution_id) do nothing;
