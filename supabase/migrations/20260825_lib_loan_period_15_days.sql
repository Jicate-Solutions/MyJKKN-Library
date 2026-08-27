-- Two member categories per college, 15 day loan everywhere.
--
-- Decided on 25 Aug 2026. Membership comes from MyJKKN, and MyJKKN only ever
-- says learner or facilitator — so those are the only two categories a library
-- can match a person against. The rest were never reachable.
--
-- The due date is the one rule all seven libraries share; everything else on
-- these rows — books allowed, holds, renewals, fine per day — stays per
-- college and is meant to be edited campus by campus afterwards.
--
-- An earlier version of this file ran inside a transaction that aborted on a
-- table which does not exist here, so nothing it did was kept. This one only
-- touches tables that are certainly present.

begin;

-- 1. Only those two categories anywhere.
delete from lib_member_categories
where category_code not in ('learner', 'facilitator');

-- 2. Both rows for every college that runs a library.
--
-- Only institutions with MyJKKN institutions mapped against them: a row with
-- none has no learners or staff behind it, so it runs no library. Existing
-- rows are left exactly as they are — a college whose limits have already
-- been tuned keeps them, and the new rows start on the column defaults, to be
-- set campus by campus.
insert into lib_member_categories (institution_id, category_code, category_name, loan_period_days)
select i.id, c.category_code, c.category_name, 15
from institutions i
cross join (values
	('learner',     'Learners'),
	('facilitator', 'Facilitators')
) as c(category_code, category_name)
where coalesce(array_length(i.myjkkn_institution_ids, 1), 0) > 0
on conflict (institution_id, category_code) do nothing;

-- 3. 15 days on every row, the ones that already existed included.
update lib_member_categories
set loan_period_days = 15
where loan_period_days is distinct from 15;

-- 4. One name for each, on every college, however the row was first written.
update lib_member_categories
set category_name = case category_code
	when 'learner'     then 'Learners'
	when 'facilitator' then 'Facilitators'
end
where category_code in ('learner', 'facilitator')
  and category_name is distinct from (case category_code
	when 'learner'     then 'Learners'
	when 'facilitator' then 'Facilitators'
end);

-- 5. A category added later starts at 15 days, not 14.
alter table lib_member_categories
	alter column loan_period_days set default 15;

commit;

-- Check: seven colleges, two categories each, fifteen days.
--
-- select i.institution_code,
--        count(*)                  as categories,
--        min(c.loan_period_days)   as loan_days,
--        max(c.loan_period_days)   as loan_days_max
-- from institutions i
-- join lib_member_categories c on c.institution_id = i.id
-- group by i.institution_code
-- order by i.institution_code;
