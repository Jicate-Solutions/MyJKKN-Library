# Performance Audit — Shared Rules

Every module performance agent reads this file first. The rules live here once
so seven agents cannot quietly drift apart from each other.

---

## 1. The rule that overrides everything

**Nothing is ever changed.** Not a page, not an API route, not a hook, not a
config file, not a migration, not a type, not a comment, not a formatting nit.

These agents have **no Write and no Edit tool**. They must never use Bash to
create, write, move, rename or delete a file anywhere in the repository, and
never run a git command that changes state — no `add`, `commit`, `checkout`,
`stash`, `reset`, `push`, `pull`.

The output is **findings and suggestions**. A human reads them, decides, fixes
and pushes. That separation is the whole point: the audit can be run at any
time, on any branch, mid-feature, without the slightest risk to the work in
progress.

If an agent finds itself about to "just fix this one line" — stop. That is not
its job, and doing it breaks the guarantee the whole arrangement rests on.

## 2. Scope

**In scope — speed, and only speed:**

- how long a page takes to render and become useful
- how long each API call takes to answer
- how much data crosses the wire
- how many requests fire, and whether any duplicate each other
- work done one after another that could happen at the same time
- re-renders and re-fetches that need not happen

**Out of scope — always:** features, wording, layout, colours, brand, business
logic, permissions and roles, database schema, correctness bugs, code style,
naming, test coverage, documentation.

If something out of scope looks wrong, give it **one line** under "Noticed but
out of scope" and move on. Do not investigate it. Do not suggest a fix for it.

## 3. What Bash may be used for

Measurement and inspection that leaves no trace:

- `curl` against the running dev server to time a page or an API route
- reading timings, sizes and status codes
- temporary measurement scripts written **into the scratchpad directory only**,
  never into the repository

Nothing else.

## 4. Measuring honestly

The dev server runs on **https**, not http:

```bash
curl -sk -o /dev/null -w "%{http_code} %{time_total}s\n" https://localhost:3000/ --max-time 20
```

- If it answers, time the page and each of its API routes.
- Take **three timings and report the median**. One number is noise.
- API routes answer `401` without a session. That still measures the route's
  own cost and is worth reporting — say the status alongside the time.
- If the server is not reachable, **say so plainly** and give static findings
  only.

**Never invent, estimate or guess a number and present it as measured.** A
finding with no measurement is still useful; a made-up millisecond figure is
worse than useless, because somebody will act on it. Write "not measured"
without embarrassment.

## 5. What actually tends to be slow in this codebase

Learned from real measurements on this project — check these first.

**In API routes**

- **Independent awaits in sequence.** Four unrelated queries awaited one after
  another cost four round trips instead of one. The commonest real problem here.
- **N+1** — a query inside a loop, or one call per row.
- **Full-table reads** where a filter or a `count` would do.
- **`select('*')`** where the screen shows six fields.
- **A missing `institution_id` filter** or another filter that would cut rows.
- **The 1000-row cap.** Supabase returns at most a thousand rows per request,
  and `.range(0, 9999)` does **not** lift it — it is silently trimmed. Where a
  table can hold more matching rows than that, check whether `fetchAllRows`
  from `lib/library/fetch-all.ts` is used. This shows up as wrong totals as
  much as slowness, and is worth reporting either way.
- **Joins that rebuild the same parent over and over.** Reading a child table
  with its parent embedded makes the database assemble that parent once per
  child row. Where the ratio is high, reading the two separately and pairing
  them in code is markedly cheaper.
- **External MyJKKN calls** — the slowest thing in any request by a wide
  margin. Check for a timeout, and for caching where it sensibly applies.

**In pages**

- **Effects re-running too often** — a dependency that is a fresh object or
  array on every render refetches endlessly.
- **An unmemoised context value**, re-rendering every consumer.
- **Expensive work during render** — sorting, filtering or mapping thousands of
  rows outside a `useMemo`.
- **Sequential client fetches** that could be one `Promise.all`.
- **Loading a whole dataset** for a screen showing twelve rows — but check
  first whether the page searches or paginates over the full set on the client,
  because then it genuinely needs all of it and saying otherwise would be wrong.

**Already done — do not re-report as new**

These were fixed on 20–21 Aug 2026. Confirm they are still in place; only raise
one if it has regressed:

- caller resolution cached in `lib/auth/server-access.ts`
- learner photos cached in `lib/library/learner-photo.ts`
- institution settings cached in `lib/library/institution-settings.ts`
- parallel slice reads in `lib/library/fetch-all.ts`
- split item/title read in the accession register route
- memoised institution context

## 6. Ranking

Order findings by **how much time they would actually save**, not by how easy
they are to describe.

If a page is already fast, say so. "Nothing worth changing here" is a correct
and valuable answer. Padding a report with trivia to look thorough wastes the
reader's time and buries the findings that matter.

## 7. Report shape

Each page auditor returns exactly this, and nothing else:

```
### <Page name> — `<url>`
**File:** `app/(lib)/<path>/page.tsx`
**Measured:** <median page load, or "server not running — static analysis only">

**Data path**
- `GET /api/lib/...` → <what it reads> — <timing, or "not measured">

**Findings**
1. **<short title>** — `<file>:<line>`
   What: <the problem, one or two sentences>
   Costs: <time it costs, measured where possible, else "unmeasured">
   Suggested fix: <what to change — described, never written>

**Nothing worth changing:** <what was checked and found already fine>

**Noticed but out of scope:** <one line each, or "none">
```
