# MyJKKN Member Enrollment — Design Doc

**Date:** 2026-03-20
**Scope:** Connect library member enrollment to MyJKKN learner/staff profiles
**Status:** Approved

---

## Problem

The members page currently requires manual entry of name, email, and phone for all member types. For learners and learning facilitators, this data already exists in MyJKKN (jkkn.ai). Librarians should search and select from MyJKKN instead of retyping, and member profiles should always show fresh data from the source platform.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search UX | Hybrid (inline + browse modal) | Inline for quick lookup, modal for browsing with filters |
| Profile display | Live fetch on render | Always fresh; no stale local copies |
| Browse modal loading | Search-first (no auto-load) | CAS has 5000+ learners; prevents slow loads |
| Profile caching | In-memory Map with 5-min TTL | Avoids re-fetching same profile on table re-renders |
| Manual categories | Unchanged for team_member/guest/alumni | No MyJKKN profile exists for these |

## Enrollment Flow

### Learner / Learning Facilitator

1. User opens Add Member sheet, selects "Learner" or "Learning Facilitator" category
2. Manual name/email fields are replaced by an **inline search input**
3. User types name or roll number (debounced 400ms)
4. Dropdown shows up to 8 results: photo thumbnail, name, roll number, program
5. Selecting a result auto-fills the form and stores `learner_id` or `facilitator_id`
6. A "Browse All" button opens a **full modal** with:
   - Search box (requires 2+ characters or a filter before loading)
   - Filters: program, department, batch
   - Results table: photo, name, roll number, program, department
   - Click row to select, closes modal, auto-fills form
7. User can still edit `membership_start_date`, `membership_end_date`, `is_active`
8. On save, `learner_id`/`facilitator_id` is stored in `lib_members`; `display_name` is also stored as fallback

### Team Member / Guest / Alumni

Current manual form — unchanged.

## Live Profile Display

A `<MemberProfileCell>` component renders in the members table for each row where `learner_id` or `facilitator_id` is set:

- Fetches `/api/myjkkn/students/{id}` or `/api/myjkkn/staff/{id}` on mount
- Renders: avatar (DiceBear fallback), full name, roll number
- Uses in-memory cache (`Map<string, {data, timestamp}>`) with 5-min TTL
- Loading: skeleton shimmer (avatar circle + text bar)
- Error: falls back to `lib_members.display_name`

## Files

| File | Action | Purpose |
|------|--------|---------|
| `components/library/myjkkn-member-search.tsx` | New | Inline search dropdown for learners/staff |
| `components/library/myjkkn-browse-modal.tsx` | New | Full browse modal with filters + table |
| `components/library/member-profile-cell.tsx` | New | Live profile cell (photo + name from MyJKKN) |
| `lib/myjkkn-profile-cache.ts` | New | In-memory profile cache with 5-min TTL |
| `app/(lib)/members/page.tsx` | Modify | Integrate search into Add Member sheet |

## API Surface

No new API routes. Existing routes cover all needs:

- `GET /api/myjkkn/students?search=X&institution_id=Y` — learner search
- `GET /api/myjkkn/staff?search=X&institution_id=Y` — staff search
- `GET /api/myjkkn/students/[id]` — single learner profile
- `GET /api/myjkkn/staff/[id]` — single staff profile (needs creation if missing)
- `POST /api/lib/members` — already accepts `learner_id`/`facilitator_id`

## JKKN Terminology

- "Learner" (never "Student")
- "Learning Facilitator" (never "Faculty/Staff")
- "Knowledge Community Member" for generic references
- "Learning Commons" (never "Library")

## Out of Scope

- Bulk enrollment
- Offline/cached profile storage in Supabase
- Learner self-service portal
- Staff photo local storage
