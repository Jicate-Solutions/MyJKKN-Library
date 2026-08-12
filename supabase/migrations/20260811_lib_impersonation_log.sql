-- Trail for "view as user".
--
-- A super admin viewing as someone else can do everything that person can do,
-- so the record of who was really at the keyboard is the safeguard that makes
-- the feature acceptable. Three kinds of row: a session start, a session stop,
-- and every change made in between.
--
-- Nothing in the app depends on this table existing — if it is missing the
-- entries go to the server log instead — but without it there is no queryable
-- history, so it should be created.

create table if not exists lib_impersonation_log (
	id uuid primary key default gen_random_uuid(),

	event_type text not null check (event_type in ('start', 'stop', 'action')),

	-- Who was really signed in
	real_user_id uuid references users(id) on delete set null,
	real_email text not null,

	-- Who they were viewing as
	target_user_id uuid references users(id) on delete set null,
	target_email text not null,

	-- Only set on 'action' rows
	http_method text,
	request_path text,
	institution_id uuid references institutions(id) on delete set null,

	occurred_at timestamptz not null default now(),
	created_at timestamptz not null default now()
);

comment on table lib_impersonation_log is
	'Who acted as whom while using "view as user", and every change they made.';

create index if not exists lib_impersonation_log_real_user_idx
	on lib_impersonation_log (real_user_id, occurred_at desc);

create index if not exists lib_impersonation_log_target_user_idx
	on lib_impersonation_log (target_user_id, occurred_at desc);

create index if not exists lib_impersonation_log_occurred_idx
	on lib_impersonation_log (occurred_at desc);
