-- =============================================================================
-- The `admin` library role becomes `library_admin`
--
-- WHY THIS FILE EXISTS
--
-- The role name is not only in the code. It is stored twice in the database —
-- in `roles.name`, which `user_roles` points at, and in the legacy `users.role`
-- column — and `lib/auth/server-access.ts` reads both. The code now looks for
-- 'library_admin'.
--
-- So if the code is deployed without this file being run, every current admin
-- resolves to no known role and falls back to `member`: they would lose every
-- library screen except Circulation and OPAC, silently. Run this at the same
-- time as the deploy.
--
-- Nothing else about them changes — same person, same institution, same rank of
-- 4, same rights. Only the name.
--
-- Safe to run more than once.
-- =============================================================================

-- ── 1. The role row itself ──────────────────────────────────────────────────
--
-- Renamed in place rather than added alongside, so every `user_roles` row
-- already pointing at it follows automatically — no assignment is rewritten,
-- and nobody can be missed.
--
-- Guarded both ways: it does nothing if the rename has already happened, and it
-- refuses to collide with a `library_admin` row that somehow already exists.

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM roles WHERE name = 'library_admin') THEN
		RAISE NOTICE 'roles.library_admin already exists — leaving it alone';

	ELSIF EXISTS (SELECT 1 FROM roles WHERE name = 'admin') THEN
		UPDATE roles SET name = 'library_admin' WHERE name = 'admin';
		RAISE NOTICE 'roles.admin renamed to library_admin';

	ELSE
		RAISE NOTICE 'no roles.admin row found — nothing to rename';
	END IF;
END $$;

-- ── 2. The legacy column ────────────────────────────────────────────────────
--
-- `users.role` is the fallback used for accounts created before user_roles
-- existed. server-access.ts still reads it when a user has no active assigned
-- role, so it has to say the same thing.

UPDATE users
SET role = 'library_admin', updated_at = now()
WHERE role = 'admin';

-- ── 3. Check it worked ──────────────────────────────────────────────────────
--
-- Run this by hand afterwards. Both counts should be 0.
--
--   SELECT count(*) AS roles_still_admin FROM roles WHERE name = 'admin';
--   SELECT count(*) AS users_still_admin FROM users WHERE role = 'admin';
--
-- And this should list everyone who now holds the renamed role:
--
--   SELECT u.email, u.role, r.name AS assigned_role, u.institution_id
--   FROM users u
--   LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active
--   LEFT JOIN roles r ON r.id = ur.role_id
--   WHERE u.role = 'library_admin' OR r.name = 'library_admin';

-- ── 4. To undo ──────────────────────────────────────────────────────────────
--
--   UPDATE roles SET name = 'admin' WHERE name = 'library_admin';
--   UPDATE users SET role = 'admin' WHERE role = 'library_admin';
--
-- ── 5. One thing to know ────────────────────────────────────────────────────
--
-- A signed-in caller's role is held in memory for up to a minute
-- (CALLER_TTL_MS in server-access.ts), so somebody already using the site may
-- keep the old resolution for that long. A refresh after a minute, or a
-- restart of the server, settles it.
