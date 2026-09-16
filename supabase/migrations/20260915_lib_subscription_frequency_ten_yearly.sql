-- One more way a periodical can arrive: ten issues a year.
--
-- Monthly is 12 and eight_yearly is 8, and a journal that skips two months
-- a year is neither. The form works Expected Issues out from the frequency,
-- so it needs a word that means 10 — and the column keeps a CHECK constraint
-- naming its allowed words, so the word has to be added here before the form
-- may send it. Sent early, the database refuses the row outright.
--
-- Named the way eight_yearly is: what it means, in one word, as the database
-- stores it. The form shows "Ten a year".
--
-- Safe to run more than once. The constraint is looked up by the column it
-- guards rather than assumed by name. The full list is restated, including
-- the words added on 2 and 4 Sep 2026, so running this on a database that
-- missed those updates also brings them in.

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
			'daily', 'weekly', 'fortnightly', 'semi_monthly', 'monthly', 'ten_yearly', 'eight_yearly',
			'bimonthly', 'quarterly', 'three_yearly', 'half_yearly', 'annual', 'irregular'
		));
end $$;

-- Should list ten_yearly among the rest.
select pg_get_constraintdef(con.oid) as frequency_rule
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where rel.relname = 'lib_periodical_subscriptions'
   and con.conname = 'lib_periodical_subscriptions_frequency_check';
