-- One gate scan, one trip to the database.
--
-- Scanning a card is two questions today: is this person still inside, and
-- then either close their visit or open a new one. Asked one after the other
-- they are two round trips, and each costs about 75ms of network whatever the
-- query does — so half the time a student stands at the door is spent waiting
-- for the second question to travel.
--
-- Both happen here instead, in one statement, so the desk pays one round trip.
--
-- It is also more correct than asking twice. The old pair had a gap between
-- reading the open visit and closing it, which the route papered over by
-- re-checking `exit_time is null` on the update. Here the row is locked as it
-- is read, so two scans of the same card in the same instant cannot both close
-- it; the second one skips the locked row and opens a fresh entry, which is
-- exactly what the route did before.
--
-- The out parameters are named out_* on purpose: plpgsql cannot tell an out
-- parameter called visit_date from the column of that name, and the function
-- will not compile if they collide.

create or replace function lib_gate_scan(
	p_institution_id  uuid,
	p_myjkkn_id       text,
	p_person_kind     text,
	p_member_number   text,
	p_display_name    text,
	p_member_category text,
	p_visit_date      date,
	p_now             time,
	p_visit_purpose   text default null
)
returns table (
	out_direction  text,
	out_visit_id   uuid,
	out_visit_date date,
	out_entry_time time,
	out_exit_time  time
)
language plpgsql
set search_path = public
as $$
declare
	v_open_id uuid;
begin
	-- Still inside from an earlier scan today? Locked as it is read.
	select v.id into v_open_id
	from lib_member_visits v
	where v.institution_id = p_institution_id
	  and v.myjkkn_id      = p_myjkkn_id
	  and v.visit_date     = p_visit_date
	  and v.entry_time is not null
	  and v.exit_time  is null
	order by v.created_at desc
	limit 1
	for update skip locked;

	-- Both writes are wrapped in a CTE and returned through a plain SELECT.
	-- RETURN QUERY is only documented to take a query, so handing it an UPDATE
	-- or INSERT directly is not worth relying on; this form always works.
	if v_open_id is not null then
		return query
		with closed as (
			update lib_member_visits v
			   set exit_time = p_now
			 where v.id = v_open_id
			returning v.id, v.visit_date, v.entry_time, v.exit_time
		)
		select 'out'::text, closed.id, closed.visit_date, closed.entry_time, closed.exit_time
		from closed;
		return;
	end if;

	-- Nobody becomes a borrower by walking in, so member_id stays null and the
	-- person is written onto the visit itself.
	return query
	with opened as (
		insert into lib_member_visits (
			institution_id, member_id, myjkkn_id, person_kind, member_number,
			display_name, member_category, visit_date, entry_time, visit_purpose
		)
		values (
			p_institution_id, null, p_myjkkn_id, p_person_kind, p_member_number,
			p_display_name, p_member_category, p_visit_date, p_now, p_visit_purpose
		)
		returning id, visit_date, entry_time, exit_time
	)
	select 'in'::text, opened.id, opened.visit_date, opened.entry_time, opened.exit_time
	from opened;
end;
$$;

comment on function lib_gate_scan is
	'One gate scan in one round trip: closes the open visit if there is one, otherwise opens a new one. Used by POST /api/lib/visits/scan, which falls back to two separate queries where this function has not been installed.';
