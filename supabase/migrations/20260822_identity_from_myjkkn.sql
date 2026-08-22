-- =============================================================================
-- Identity moves to MyJKKN
--
-- WHY THIS FILE EXISTS
--
-- This project no longer keeps its own users or roles. Who somebody is, and
-- what they are, is read from their MyJKKN staff record on every request, and
-- the id everything is filed under is now MyJKKN's staff id rather than a row
-- in our `users` table.
--
-- Two tables held a foreign key to `users(id)`. With the id coming from MyJKKN
-- those keys can no longer be satisfied — the very first person to star a page
-- after the deploy would get a 23503 and lose the favourite, silently.
--
-- So the keys go. The columns stay, and every row already in them stays exactly
-- as it is: an old favourite keeps working for as long as that person's `users`
-- row and their MyJKKN staff id happen to differ, which is until they star
-- something new. Nothing is deleted.
--
-- `users` and `user_roles` are NOT dropped and NOT emptied. They are simply no
-- longer read. Leaving them costs nothing and means this change can be undone.
--
-- Safe to run more than once.
-- =============================================================================

-- ── 1. Favourites ───────────────────────────────────────────────────────────
--
-- `lib_page_favourites.user_id` is now a MyJKKN staff id.
--
-- The constraint is found rather than named: a database built from a different
-- file may have named it something else, and dropping a guessed name would
-- silently leave the old rule in force while appearing to have worked.

DO $$
DECLARE existing record;
BEGIN
	IF to_regclass('public.lib_page_favourites') IS NULL THEN
		RAISE NOTICE 'lib_page_favourites does not exist — nothing to do';
		RETURN;
	END IF;

	FOR existing IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_attribute att
			ON att.attrelid = con.conrelid
		 AND att.attnum = ANY (con.conkey)
		WHERE con.conrelid = 'public.lib_page_favourites'::regclass
			AND con.contype = 'f'
			AND att.attname = 'user_id'
	LOOP
		EXECUTE format('ALTER TABLE lib_page_favourites DROP CONSTRAINT %I', existing.conname);
		RAISE NOTICE 'dropped %', existing.conname;
	END LOOP;
END $$;

COMMENT ON COLUMN lib_page_favourites.user_id IS
	'MyJKKN staff id. Deliberately no foreign key: this project keeps no user table.';

-- ── 2. The "view as" trail ──────────────────────────────────────────────────
--
-- Same reasoning. This table may not exist yet — it arrived in a migration that
-- is still pending on some databases — so it is only touched if it is there.

DO $$
DECLARE existing record;
BEGIN
	IF to_regclass('public.lib_impersonation_log') IS NULL THEN
		RAISE NOTICE 'lib_impersonation_log does not exist yet — nothing to do';
		RETURN;
	END IF;

	FOR existing IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_attribute att
			ON att.attrelid = con.conrelid
		 AND att.attnum = ANY (con.conkey)
		WHERE con.conrelid = 'public.lib_impersonation_log'::regclass
			AND con.contype = 'f'
			AND att.attname IN ('real_user_id', 'target_user_id')
	LOOP
		EXECUTE format('ALTER TABLE lib_impersonation_log DROP CONSTRAINT %I', existing.conname);
		RAISE NOTICE 'dropped %', existing.conname;
	END LOOP;
END $$;

-- ── 3. What was NOT done, on purpose ────────────────────────────────────────
--
--   * `users` and `user_roles` are untouched — not dropped, not emptied, not
--     altered. Nothing reads them any more.
--   * `lib_activity_log.user_id` needed nothing: it never had a foreign key, by
--     design, so that the log survives the person who wrote it.
--   * No row is deleted anywhere.
--
-- ── 4. To undo ──────────────────────────────────────────────────────────────
--
-- Only meaningful alongside reverting the code, and only once every row's
-- user_id is a `users.id` again:
--
--   ALTER TABLE lib_page_favourites
--     ADD CONSTRAINT lib_page_favourites_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
