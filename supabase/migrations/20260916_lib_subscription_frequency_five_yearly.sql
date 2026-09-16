-- One more way a periodical can arrive: five issues a year.
--
-- Bi-monthly is 6 and quarterly is 4, and a journal that brings five issues a
-- year is neither. The form works Expected Issues out from the frequency, so it
-- needs a word that means 5 - and the column keeps a CHECK constraint naming
-- its allowed words, so the word has to be added here before the form may send
-- it. Sent early, the database refuses the row outright.
--
-- Named the way eight_yearly and ten_yearly are: what it means, in one word, as
-- the database stores it. The form shows "Five a year (5)".
--
-- Safe to run more than once. The constraint is looked up by the column it
-- guards rather than assumed by name. The full list is restated, including the
-- words added on 2, 4 and 15 Sep 2026, so running this on a database that
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
			'bimonthly', 'five_yearly', 'quarterly', 'three_yearly', 'half_yearly', 'annual', 'irregular'
		));
end $$;

-- Should answer true: five_yearly is now one of the allowed words.
select pg_get_constraintdef(con.oid) ilike '%five_yearly%' as five_a_year_allowed
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where rel.relname = 'lib_periodical_subscriptions'
   and con.conname = 'lib_periodical_subscriptions_frequency_check';
