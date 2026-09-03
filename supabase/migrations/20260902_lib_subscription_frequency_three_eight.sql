-- Two more ways a periodical can arrive: three times a year, and eight.
--
-- The subscriptions form works Expected Issues out from the frequency, and
-- several journals on the shelf come 3 or 8 times a year — every four months,
-- or eight numbers spread over the year — with no frequency to say so. The
-- column keeps a CHECK constraint naming its allowed words, so the two new
-- ones have to be added here before the form may send them; sent early, the
-- database refuses the row outright (the same way "semi-annual" once was).
--
-- Named the way half_yearly is: what it means, in one word, as the database
-- stores it. The form shows "Three a year (every 4 months)" and "Eight a year".
--
-- Safe to run more than once. The constraint is looked up by the column it
-- guards rather than assumed by name, so a database where it was created
-- under another name is handled the same way.

do $$
declare
	guard text;
begin
	select con.conname
	  into guard
	  from pg_constraint con
	  join pg_class rel on rel.oid = con.conrelid
	 where rel.relname = 'lib_periodical_subscriptions'
	   and con.contype = 'c'
	   and pg_get_constraintdef(con.oid) ilike '%frequency%';

	if guard is not null then
		execute format('alter table lib_periodical_subscriptions drop constraint %I', guard);
	end if;

	alter table lib_periodical_subscriptions
		add constraint lib_periodical_subscriptions_frequency_check
		check (frequency in (
			'daily', 'weekly', 'fortnightly', 'monthly', 'eight_yearly', 'bimonthly',
			'quarterly', 'three_yearly', 'half_yearly', 'annual', 'irregular'
		));
end $$;

-- Should list the two new words among the rest.
select pg_get_constraintdef(con.oid) as frequency_rule
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where rel.relname = 'lib_periodical_subscriptions'
   and con.conname = 'lib_periodical_subscriptions_frequency_check';
