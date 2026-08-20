-- A person's own shortcuts to the pages they use.
--
-- Not library data: it belongs to the person, not to a campus, so there is no
-- institution_id here. A librarian who moves colleges keeps their shortcuts,
-- and one person's list can never appear in anyone else's sidebar because
-- every read and write is filtered by the signed-in user id in the API.
--
-- Only the path is stored, never the page's icon. The icon and the current
-- title are looked up from the menu at render time, so renaming a page in the
-- menu renames it here too, instead of leaving a stale copy behind.

create table if not exists lib_page_favourites (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,

	-- The route, exactly as the menu holds it: '/registry', '/circulation/holds'
	page_path text not null,
	-- What it was called when it was starred — a fallback for a page that has
	-- since left the menu, so the row never renders as a blank line
	display_title text not null,
	-- The menu group it came from ('Circulation'), for the tooltip
	module_name text,

	-- Position in the list. Pinned rows are drawn first, then this order.
	sort_order integer not null default 0,
	is_pinned boolean not null default false,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	-- One star per page per person. The star toggles; it never stacks up.
	unique (user_id, page_path)
);

-- The sidebar asks for one person's list, already in order, on every page load
create index if not exists idx_lib_page_favourites_user
	on lib_page_favourites (user_id, sort_order);
