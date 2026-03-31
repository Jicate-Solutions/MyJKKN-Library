# MyjkknLIB Migration Design

> Date: 2026-03-19
> Approach: Scorched Earth + Rebuild (Option A)
> Scope: All 7 phases — full build

## Decision Summary

- **What:** Build MyjkknLIB (Library Management System) as a clean Next.js app
- **How:** Delete all COE files, keep shared infrastructure, build LIB from spec
- **Constraints:** No Supabase schema changes — use existing lib_* tables as-is
- **Template:** MyJKKN starter template patterns (auth, RBAC, institution filtering)

## Architecture

- **5-Layer Pattern:** Types → Services → API Routes → Hooks → Pages
- **Auth:** auth.jkkn.ai SSO (existing)
- **Multi-Tenant:** institution_id RLS (existing)
- **MyJKKN API:** External learner/facilitator profile resolution (existing)
- **UI:** Shadcn UI + Tailwind CSS (existing)
- **Route Group:** `app/(lib)/` replaces `app/(coe)/`

## Modules (7 Phases)

1. **Foundation** — Types, Members CRUD, MyJKKN member integration
2. **Knowledge Registry** — Catalogue records + physical items (accession)
3. **Circulation** — Issue/Return/Renew, Holds, Overdue, Late Charges
4. **Procurement & Budget** — Suppliers, Requests, Orders, Receive
5. **Periodicals & Digital** — Subscriptions, Issues, E-resources
6. **OPAC** — Knowledge Discovery Portal, Learner self-service
7. **Reports** — NAAC metrics, Accession Register, Circulation stats

## Keep vs Delete

### KEEP
- Auth: lib/auth/*, middleware.ts, context/auth-context.tsx, protected-route.tsx
- MyJKKN: services/myjkkn*, app/api/myjkkn/*, types/myjkkn*, hooks/myjkkn/*
- Institution: hooks/use-institution-filter.ts, hooks/use-institution-field.ts
- UI: components/ui/* (Shadcn), components/common/theme-provider.tsx
- Hooks: hooks/common/* (26 reusable hooks)
- Utils: lib/utils.ts, lib/date-utils.ts, lib/pagination.ts, lib/pdf/*
- Config: package.json, tsconfig.json, next.config.ts, tailwind.config.ts
- Supabase: ALL migrations untouched

### DELETE
- All app/(coe)/ pages (147)
- All COE API routes (~190)
- All COE services, types, hooks, components
- All COE-specific lib/utils (PDFs, validations, export-import)
- All COE docs (keep only myjkkn-lib docs)
- Scripts, automation, debug pages

## Reference
- Full spec: spec-MyjkknLIB.md
- Analysis: docs/plans/myjkkn-lib/ANALYSIS-REPORT.md
- DB schema: docs/plans/myjkkn-lib/migration-MyjkknLIB.sql
