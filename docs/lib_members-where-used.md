# Members — where they come from, and every place they are used

Updated **22-08-2026**, when members stopped being kept in this database.

> **What changed.** `lib_members` was a roll the library kept by hand: a
> librarian enrolled a learner, and that row was the person as far as this
> system was concerned. It is now a **historical table** — nothing reads it and
> nothing writes to it.
>
> A member is now an **Active learner or staff member in MyJKKN**, read live on
> every request. Nobody is enrolled. The moment somebody actually **borrows**, a
> row is written to the new **`lib_borrowers`** table, and that is what every
> loan, fine, hold and request points at.
>
> The earlier version of this document listed the nine pages that used
> `lib_members`. Those same nine pages are listed below, with what each one uses
> instead.

---

## The three things a "member" can now mean

| | What it is | Where it lives | Written when |
|---|---|---|---|
| **A member** | An Active learner or staff member of the college | **MyJKKN** — nothing stored here | never |
| **A borrower** | Somebody who has actually taken a book out | `lib_borrowers` | their first issue |
| **The old roll** | Memberships enrolled before 22-08-2026 | `lib_members` | never again |

### `lib_borrowers`

```sql
CREATE TABLE lib_borrowers (
  id                UUID PRIMARY KEY,
  institution_id    UUID NOT NULL,          -- the college. Seven libraries, seven sets
  myjkkn_id         TEXT NOT NULL,          -- who they are in MyJKKN
  person_kind       TEXT NOT NULL,          -- learner | facilitator | legacy
  member_number     TEXT NOT NULL,          -- snapshot: the card number that day
  member_category   TEXT NOT NULL,          -- matches lib_member_categories.category_code
  display_name      TEXT,                   -- snapshot: the name that day
  email, phone      TEXT,
  is_delinquent     BOOLEAN NOT NULL,       -- owes a fine. The library's own fact
  first_borrowed_at, last_seen_at, created_at, updated_at,
  UNIQUE(institution_id, myjkkn_id)
);
```

The name and number are a **snapshot on purpose**. Everywhere a member is
*shown*, MyJKKN is asked for the live name — but a fine from two years ago must
still say whose fine it was, even after MyJKKN has forgotten them.

`person_kind = 'legacy'` marks the rows carried over from `lib_members` for
people who were never MyJKKN people at all — guests and alumni. Their history is
intact; they cannot borrow again, because they are not Active in MyJKKN.

### Which card number finds a person

Most learners have **no roll number** — MyJKKN leaves it null until the college
assigns one (54% of a 50-row sample had one). So a learner is found by any of
three, and every learner has at least the third:

`roll_number` → `register_number` → `application_id`

A staff member is found by `staff_id`. About one in five has none; they are
still listed as members, but there is nothing to scan until MyJKKN has a number
for them.

---

## The nine pages, and what each uses now

| # | Page | URL | Members from | Borrowers |
|---|------|-----|---|---|
| 1 | Members | `/members` | **MyJKKN, whole college** | reads: who owes, who has borrowed |
| 2 | Circulation Desk | `/circulation` | **MyJKKN, by card number** | **creates on issue**; reads limits and fines; return sets `is_delinquent` |
| 3 | Gate Entry | `/visits` | **MyJKKN, by card number** | **none** — a visit never makes a borrower |
| 4 | Holds | `/circulation/holds` | MyJKKN when a hold is placed | joins who is waiting |
| 5 | Overdue | `/circulation/overdue` | — | joins name, number, email, phone |
| 6 | Late Charges | `/circulation/charges` | — | joins who owes; collect/waive clears `is_delinquent` |
| 7 | Inter-Campus | `/intercampus` | **MyJKKN, by card number** | creates on request; joins who asked |
| 8 | Dashboard | `/dashboard` | **MyJKKN, counted** | — |
| 9 | Reports | `/reports` | **MyJKKN, counted** | — |

### 1. Members — `/members`
`app/(lib)/members/page.tsx`

Read-only now. Every Active learner and staff member of the college, from
MyJKKN, with their MyJKKN role against each name. **No Add, no Edit, no
Delete** — a name or an email is changed in MyJKKN and shows here on the next
load. The last column is the only thing this library knows: whether they have
ever borrowed, and whether they owe.

`GET /api/lib/members` · `lib/library/myjkkn-directory.ts`

### 2. Circulation Desk — `/circulation`
`app/(lib)/circulation/page.tsx`

| What | Route | Effect |
|---|---|---|
| Scan a card | `GET /api/lib/members/lookup` | MyJKKN by number; `lib_borrowers` for loans and fines |
| Issue | `POST /api/lib/circulation/issue` | **the one place a borrower row is created** |
| Return | `POST /api/lib/circulation/return` | sets `is_delinquent` true when a fine is left owing |
| Renew | `POST /api/lib/circulation/renew` | reads the borrower's category and fines |
| Scan a book | `GET /api/lib/circulation/lookup` | joins the borrower behind the loan |

The desk sends `myjkkn_id` and `person_kind`, never a row id — the row does not
exist yet for a first-time borrower. The issue route checks MyJKKN **again**
before writing, so a book cannot leave the building on a value somebody typed.

**A refused issue creates nothing.** The borrower row is written only after the
book, the fine rules and the borrowing limit have all passed.

### 3. Gate Entry — `/visits`
`app/(lib)/visits/page.tsx` → `standard-gate-entry.tsx` · `pharmacy-gate-entry.tsx`

Walking in is not borrowing, so **the gate writes no borrower row**. The person
is written onto the visit itself — `lib_member_visits` gained `myjkkn_id`,
`person_kind`, `member_number`, `display_name`, `member_category`. Visits
recorded before 22-08-2026 had those columns filled from their old membership
row, so the register reads the same for both.

### 4. Holds — `/circulation/holds`
Reserving a book is a claim on it, so placing a hold **does** create a borrower
row. The queue, the cancel and the reminders all join `lib_borrowers`.

### 5–6. Overdue and Late Charges
`/circulation/overdue`, `/circulation/charges` — joins on `lib_borrowers` only.
Collecting or waiving the last unpaid charge clears `is_delinquent`.

### 7. Inter-Campus — `/intercampus`
The form now asks for the **member's card number**, not a row id. It is looked
up against MyJKKN before the request is made, and asking for a book creates the
borrower row.

### 8–9. Dashboard and Reports
`GET /api/lib/reports/naac` counts the college's MyJKKN roll.

> **Expect this number to jump.** It used to be "how many people a librarian had
> enrolled" — often a few hundred. It is now "how many Active learners and staff
> the college has", which is the whole college. Both are honest; they answer
> different questions, and the new one is what NAAC Criterion 4.2 actually asks.

---

## Pages that touch none of this

Unchanged, and listed so the account is complete.

| Page | URL | Why not |
|---|---|---|
| Catalogue | `/registry` | Books and copies only |
| Catalogue detail | `/registry/[id]` | One title and its copies |
| OPAC Search | `/opac` | Searches the catalogue; a reader is not identified |
| Subscriptions | `/periodicals` | Magazines and journals |
| Subscription detail | `/periodicals/[subscriptionId]` | Issues of one subscription |
| Digital Resources | `/digital` | Online resources |
| Purchase Requests | `/acquisition/requests` | `requested_by` is a plain uuid, never joined |
| Orders | `/acquisition/orders` | Suppliers and order lines |
| Suppliers | `/acquisition/suppliers` | Vendors |
| Budget | `/acquisition/budget` | Budget heads |
| Retirement | `/retirement` | Books being withdrawn |
| Conservation | `/conservation` | Books being bound or repaired |
| Library Rules | `/settings` | `lib_member_categories` — the rules, not the people |
| Shelf Locations | `/settings/locations` | Shelves |
| Activity Log | `/activity-log` | Staff accounts (`users`) |
| Staff Access | `/access` | Staff accounts (`users`) |

---

## Every API route that touches a member or a borrower

**Reads MyJKKN for who a person is**
- `app/api/lib/members/route.ts` — GET, the college's roll
- `app/api/lib/members/lookup/route.ts` — GET by card number
- `app/api/lib/visits/scan/route.ts` — the gate
- `app/api/lib/circulation/issue/route.ts` — re-checks before writing
- `app/api/lib/circulation/holds/route.ts` — POST
- `app/api/lib/intercampus/route.ts` — POST
- `app/api/lib/reports/naac/route.ts` — the member count

**Creates a borrower row** — and these three only
- `circulation/issue` · `circulation/holds` (POST) · `intercampus` (POST)

**Writes `is_delinquent`**
- `circulation/return` sets it true · `charges/[id]` sets it false

**Joins the borrower to show a name**
- `circulation/overdue`, `circulation/lookup`, `charges`, `charges/calculate`,
  `circulation/holds` (GET), `intercampus` (GET),
  `notifications/send-reminders`, `reports/overdue`

**Answers 410 — the thing they did no longer exists**
- `members/[id]` (GET, PUT, DELETE) · `members/bulk` · `members/bulk-candidates`

---

## Who sees which college

One rule, applied in `resolveInstitutionScope` (`lib/auth/server-access.ts`) and
enforced in every `/api/lib/*` route through the guard — never from the URL.

| Caller | Sees |
|---|---|
| `super_admin` | every college |
| `admin` with no college attached | every college |
| `admin` attached to a college | that college |
| `librarian`, `assistant_librarian` | their own college |
| `member` | their own college — and only the Circulation and catalogue routes |

Which MyJKKN institutions a college covers is read from our own `institutions`
table, and every MyJKKN record is checked against that list again before it is
used. One college cannot list another's people.

---

## Three things worth knowing

**A member with no card number is listed but cannot be served.** Roughly one
staff member in five has no `staff_id` in MyJKKN. They appear on the members
page; the desk cannot find them until MyJKKN has a number. That is MyJKKN's to
fix, and this library will pick it up on the next read.

**The roll is held for five minutes, in memory.** Building a college's roll is
several calls to MyJKKN, so the answer is shared between the members page, the
dashboard and the reports rather than fetched by each. Nothing is written to
Supabase. The desk and the gate do **not** wait on it: they ask MyJKKN about
one person directly, so somebody admitted this morning can borrow this
afternoon.

**Legacy borrowers cannot borrow again.** Guests and alumni carried over from
the old roll keep every loan and fine recorded against them, but they are not
Active people in MyJKKN, so no card of theirs will be found at the desk. If any
of them still needs to borrow, that is a decision to take deliberately — not
something to work around at the counter.
