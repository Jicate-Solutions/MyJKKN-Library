# Performance Audit

Audit every page of the library for loading and API speed, and append the
result to today's report file.

Runs **only** when you ask for it. Nothing here is scheduled and nothing fires
on its own.

## The rule that overrides everything

This command **changes no code**. Not a page, not an API route, not a config
file, not a migration, not a type, not a comment.

The only file it is allowed to write is today's report under
`page-performace-report/`. Everything else in the repository is read-only for
the whole run, including for every agent spawned along the way.

If a finding looks trivially fixable — leave it. Write it down and move on. The
person reading the report decides what gets fixed and pushes it themselves.

## Steps

### 1. Work out the date and time in IST

```bash
node -e "const d=new Date(Date.now()+19800000);console.log(d.toISOString().slice(0,10)+' '+d.toISOString().slice(11,16))"
```

The date names the file. The time labels this run's section.

### 2. Find out whether the dev server is up

```bash
curl -sk -o /dev/null -w "%{http_code} %{time_total}s\n" https://localhost:3000/ --max-time 20
```

It is **https**, not http. Whatever the answer, carry on — an unreachable
server means a static-only audit, which is still worth having. Note which of
the two this run is; it goes at the top of the section.

### 3. Check how many audits today's file already holds

```bash
grep -c "^## Audit " "page-performace-report/<DATE>.md" 2>/dev/null || echo 0
```

This run is that number plus one. One file per day, however many runs — ten
runs on the same day means ten sections in the one file, in order.

### 4. Run the module agents, in waves

**Do not launch all seven at once.** Each module agent spawns page auditors of
its own, so seven at once asks for roughly thirty concurrent agents against a
far smaller shared pool. The first run of this command did exactly that: three
module agents stalled waiting for a slot that could not free up because the
other module agents were themselves waiting, and had to be told by hand to
finish. Waves avoid that entirely.

Three waves. Launch each wave in a single message, wait for **both or all three
to return**, then start the next:

| Wave | Modules | Pages |
|---|---|---|
| 1 | `perf-circulation`, `perf-overview` | 6 |
| 2 | `perf-reports`, `perf-knowledge-registry` | 8 |
| 3 | `perf-acquisition`, `perf-other`, `perf-periodicals` | 11 |

The pairing puts the two heaviest modules in separate waves so no wave carries
more than about a dozen pages.

Tell each agent whether the server is reachable, so none of them wastes time
finding out for itself.

Each reads `components/layout/lib-sidebar.tsx` to discover its own current
pages — so a page added to a module since the last run is picked up on its own,
with no file to edit. Each then spawns page auditors two at a time, and audits
a page itself rather than waiting if the pool is full.

**If a module agent returns a status update instead of a report** — anything
that says it is waiting, or will continue when capacity frees — send it a
message telling it to stop waiting, audit any remaining pages directly, and
return the finished report. Do not accept a partial module.

Do not summarise away or reword what they return.

### 5. Write the section

If `page-performace-report/<DATE>.md` does not exist, create it starting with:

```
# Page Performance Report — <DATE>

Performance-only audits. Findings and suggestions; no code was changed by any
of them.
```

Then **append** this run's section — append, never overwrite, so earlier runs
in the day survive:

```
---

## Audit <n> — <HH:MM> IST

**Server:** <reachable at https://localhost:3000 / not running — static analysis only>
**Pages audited:** <total across all modules>
**New pages since the last audit:** <names, or "none">

### Worst first — across the whole app
| # | Page | Finding | Costs | Suggested fix |
|---|------|---------|-------|---------------|
| 1 | ... | ... | ... | ... |

<the seven module sections, in full, exactly as returned>

### Compared with the previous audit
<If this is the first section of the day, read the most recent earlier file in
the folder. Say what got faster, what got slower, and what is unchanged, with
the numbers. If there is nothing earlier to compare against, write "first
audit — no earlier run to compare against".>
```

### 6. Say where it went

Tell the user the file path, how many pages were covered, and the three worst
things found. Nothing more — the file holds the detail.

## Honesty rules

These matter more than the report looking impressive:

- **Never invent a number.** If something was not measured, write "not
  measured". A made-up millisecond figure is worse than no figure, because
  somebody will act on it.
- **Take three timings and report the median.** One reading is noise.
- **"Nothing worth changing" is a correct answer.** If the app is fast, say so.
  Do not pad the report to look thorough.
- **Do not re-report what is already fixed.** The caching, parallel paging and
  split reads listed in `.claude/docs/perf-audit-rules.md` were done on
  20–21 Aug 2026. Only raise one of those if it has genuinely regressed.
- **Speed only.** Features, wording, layout, logic, permissions and schema are
  out of scope. Anything noticed there gets one line under "Noticed but out of
  scope" and no more.
