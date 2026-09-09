# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**MyJKKN Library** ("JKKN Learning Commons") — the library management system for the JKKN group of colleges. Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Supabase (PostgreSQL) + Tailwind CSS + Shadcn UI.

It serves **seven colleges, each with its own separate library**:

| Code | College |
|------|---------|
| COP | Pharmacy |
| AHS | Allied Health Sciences |
| CAS | Arts and Science |
| CET | Engineering and Technology |
| CNR | Nursing |
| COE | Education |
| DCH | Dental |

A feature goes to all seven unless the request names one college. One college's rules, fines, holidays or data must never leak into another's.

## Quick reference

```bash
npm run dev          # https://localhost:3000  (start with: npm run dev -- --experimental-https)
npm run build        # production build
npm run lint         # eslint (currently broken project-wide by its config)
npx tsc --noEmit     # type-check; a few pre-existing errors exist in myjkkn staff/[id], students/[id] and lib-reports-service.ts
```

- Local dev is **https** — use `curl -sk`. Login does not work over plain http.
- If every page 404s after a restart, stop the server, delete `.next/dev` (the Turbopack cache), and start again.
- Supabase project `lbmkvwwpxaoojfhmvtlz`. SQL is run **by hand** in the Supabase SQL editor; give the query, never run it. The editor runs a script as one transaction — one error rolls the whole script back — so migrations must be safe to run twice.

## Key paths

| Area | Path |
|------|------|
| Pages (all behind login) | `app/(lib)/…` — one folder per module |
| Login / OAuth callback | `app/login/page.tsx`, `app/auth/callback/route.ts` |
| API routes | `app/api/lib/*` (library), `app/api/auth/*` (session) |
| Auth and access | `lib/auth/` |
| Domain helpers | `lib/library/` (desk, reports, catalogue, activity log, MyJKKN directory…) |
| Services (server data access) | `services/library/lib-*-service.ts` |
| Types | `types/lib.ts`, `types/lib-departments.ts`, `types/myjkkn.ts` |
| Institution context | `context/institution-context.tsx`, `hooks/use-institution-filter.ts` |
| Layout and sidebar | `app/(lib)/layout.tsx`, `components/layout/lib-sidebar.tsx`, `lib/auth/role-pages.ts` |
| Library components | `components/library/` |
| Migrations | `supabase/migrations/YYYYMMDD_lib_<topic>.sql` |
| Requirements (not in git) | `LIBRARY-REQUIREMENTS-*.md`, `Reference_Documents/` |
| Daily work log (not in git) | `today-work/YYYY-MM-DD.txt` |

## Modules (sidebar order)

- **Overview**: Dashboard (`/dashboard`, also carries the NAAC cards)
- **Knowledge Registry**: Catalogue (`/registry`), Department Libraries, Members
- **Circulation**: Circulation Desk, Gate Entry (`/visits`), Holds, Overdue, Late Charges
- **Acquisition**: Purchase Requests, Orders, Suppliers, Budget
- **Periodicals**: Subscriptions, Digital Resources
- **Other**: Retirement, Inter-Campus, Conservation, OPAC Search
- **Reports**: Reports Dashboard (`/reports`, 19 tabs + Run SQL), Library Rules (`/settings`), Activity Log, Role Management; Shelf Locations exists but is hidden from the menu

`lib/auth/role-pages.ts` holds the same list for role-based page access; keep the two in step.

## Authentication and roles

- Sign-in is **Google via Supabase Auth** (`signInWithOAuth`), callback at `/auth/callback`. The browser gets its profile only from `GET /api/auth/session`.
- **Roles come from MyJKKN, never from this app.** Only four MyJKKN role keys open the library, highest first: `super_admin`, `library_admin`, `librarian`, `assistant_librarian` (`lib/auth/library-roles.ts`). Anyone else sees the restricted page. Role keys arrive in mixed shapes (`Library Admin`, `LIBRARY-ADMIN`) and are normalised before comparison.
- Identity is the MyJKKN staff UUID. Temporary access can be granted with the `LIBRARY_ACCESS_GRANTS` env var (with an expiry); never add a users table or a second password login.
- A **member** (borrower) may only view Circulation screens and OPAC, read-only; write verbs are refused by method (`lib/auth/member-access.ts`).
- "View as" impersonation exists; every write made while impersonating is logged automatically by the API guards.

## Institution scoping (the most important rule)

Every `lib_*` table has `institution_id`. Every `/api/lib/*` route resolves the caller server-side and forces the scope — the URL is never trusted.

```typescript
// Collection route
const guard = await guardCollection(request, searchParams.get('institution_id'))
if (!guard.ok) return guard.response
const institutionId = guard.institutionId   // null only for super_admin = All

// Write route: the row is written with guard.institutionId, never with the body's value
const guard = await guardWrite(request, body.institution_id)

// One row: 404 (not 403) when it belongs to another college
const guard = await guardRecord(request, 'lib_items', id)
```

- `super_admin` may pass no institution (All Institutions); anyone else is pinned to their own college and refused outright if they ask for another.
- Writes that span institutions (super_admin, or library_admin without a college) must name `institution_id` — the guard returns 400 otherwise.
- Client side: `useInstitutionFilter()` gives `institutionId`, `institutionCode`, `mustSelectInstitution` (super_admin on All), `isReady`, `appendToUrl(url)`. Fetch only when `isReady`. The query param is always `institution_id`.

## Data model (Supabase, all `lib_*`)

Catalogue and stock: `lib_catalogue_records`, `lib_catalogue_authors`, `lib_items` (copies, one accession number each), `lib_accession_sequences`, `lib_locations`, `lib_department_transfers`.
Circulation: `lib_borrowers`, `lib_members`, `lib_member_categories`, `lib_lending_transactions`, `lib_resource_holds`, `lib_late_charges`, `lib_member_visits` (gate), `lib_notification_log`.
Acquisition: `lib_procurement_requests`, `lib_procurement_orders`, `lib_procurement_items`, `lib_suppliers`, `lib_budget_heads`.
Periodicals: `lib_periodical_subscriptions`, `lib_periodical_issues`, `lib_digital_resources`.
Other: `lib_retirement_requests`, `lib_intercampus_requests`, `lib_conservation_requests`.
System: `lib_institution_settings` (per-college rules), `lib_role_pages`, `lib_page_favourites`, `lib_activity_log`, `lib_impersonation_log`.
Reports: schema `report` with one scoped view per table and the read-only function `public.lib_report_sql(p_sql, p_institution, p_limit)` — re-run `20260905_lib_report_sql.sql` after any schema change.

Rules learned the hard way:
- **Migrations sit unrun for weeks.** Never assume a new column or table exists; map `42703`/`42P01`/`PGRST205` to a clear "run migration X" message instead of a generic 500.
- RLS is on for `lib_*`; the server client (`getSupabaseServer()`, service role) bypasses it. Use it only in API routes.
- Supabase returns 1000 rows by default — use `.range(0, 9999)` or `lib/library/fetch-all.ts` for full lists.
- Members are **not stored** as a roll: they come from MyJKKN; `lib_borrowers` is written only when someone borrows.

## MyJKKN integration

- `lib/myjkkn-api.ts`, `lib/library/myjkkn-directory.ts`, `lib/library/myjkkn-profile.ts`; env `MYJKKN_API_URL`, `MYJKKN_API_KEY`.
- MyJKKN has 14 institutions; the library covers 7. Map through `institutions.myjkkn_institution_ids`.
- Server-side filters are often ignored — **always filter client-side by `institution_id`** and deduplicate by code fields, not `id`.
- Learners come in as `learner`, staff as `facilitator` (`member_category`); programme/role labels come from MyJKKN.
- Each validate call is ~1.7 s; profile and directory caches exist — do not add per-request calls.

## Conventions

- Terminology: **Learner** (not student), **Facilitator** (staff), **Programme**, **Copy** / **Accession number** for a physical book. Positive wording in UI ("Needs attention" over "Failed").
- Code style: tabs, single quotes, no semicolons, `===`. Project files use **CRLF**; keep new files CRLF.
- Server Components by default; `'use client'` only when needed. Pages are client components that fetch `/api/lib/*`.
- Every API write logs with `logActivity(request, { action, resource_type, resource_id, institution_id, … })` from `lib/library/activity-log.ts`.
- Error mapping in routes: `23505` duplicate → 400, `23503` bad reference → 400, `23514` check constraint → name the migration, `42501` permission, `57014` timeout.
- Date/time is IST everywhere on screen (`lib/library/ist-clock.ts`); store UTC.
- Brand tokens only (`brand-green` etc.); no new UI layouts mid-feature.
- Long titles: one line, full text on hover via `components/library/overflow-text.tsx`.

## Ways of working

- Reply with an **English** block, then a **Tamil** block in Tanglish (plain ASCII, no Tamil script).
- Do only the requested work; touch no other module. When asked a question, answer in one line and change nothing.
- Confirm understanding before building; ask on any doubt.
- **Never** `git push`, `git pull`, `git fetch` or any GitHub action unless explicitly asked. Never commit other people's uncommitted changes. Never commit `.env`, `Reference_Documents/`, `today-work/`, `page-performace-report/` or `LIBRARY-REQUIREMENTS-*.md`.
- Append finished code work to `today-work/YYYY-MM-DD.txt` in Tanglish for MD sir — no questions or doubts in it.
- `/perf-audit` runs a read-only performance audit on request; it is never scheduled.
