-- One more way a periodical can arrive: twice a month, 24 issues a year.
--
-- Fortnightly is 26 by the calendar and monthly is 12, and a journal that
-- comes on the 1st and the 15th is neither. The form works Expected Issues
-- out from the frequency, so it needs a word that means 24 — and the column
-- keeps a CHECK constraint naming its allowed words, so the word has to be
-- added here before the form may send it. Sent early, the database refuses
-- the row outright, as it once did for "semi-annual".
--
-- Named the way half_yearly and three_yearly are: what it means, in one
-- word, as the database stores it. The form shows "Twice a month (24 a year)".
--
-- Safe to run more than once. The constraint is looked up by the column it
-- guards rather than assumed by name, so a database where it was created
-- under another name is handled the same way. The full list is restated,
-- including the two words added on 2 Sep 2026, so running this on a
-- database that missed that update also brings those in.

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
			'daily', 'weekly', 'fortnightly', 'semi_monthly', 'monthly', 'eight_yearly', 'bimonthly',
			'quarterly', 'three_yearly', 'half_yearly', 'annual', 'irregular'
		));
end $$;

-- Should list semi_monthly among the rest.
select pg_get_constraintdef(con.oid) as frequency_rule
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where rel.relname = 'lib_periodical_subscriptions'
   and con.conname = 'lib_periodical_subscriptions_frequency_check';
