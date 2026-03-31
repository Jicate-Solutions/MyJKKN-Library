# MyjkknLIB Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Library Management System (MyjkknLIB) by deleting all COE files and building LIB modules from scratch using existing shared infrastructure.

**Architecture:** 5-layer pattern (Types → Services → API Routes → Hooks → Pages). Multi-tenant via institution_id. Auth via auth.jkkn.ai SSO. MyJKKN API for learner/facilitator profiles.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (PostgreSQL), Shadcn UI, Tailwind CSS

**Constraint:** No Supabase schema changes — use existing lib_* tables as-is.

---

## Phase 0: Archive & Clean — Delete all COE files

### Task 0.1: Create archive branch
### Task 0.2: Delete all COE-specific directories and files
### Task 0.3: Update root layout, middleware, package.json for LIB
### Task 0.4: Create LIB directory skeleton

## Phase 1: Foundation — Types + Members
### Task 1.1: Create types/lib.ts
### Task 1.2: Create services/library/ (all 11 service files)
### Task 1.3: Create API routes for members
### Task 1.4: Create hooks/library/use-lib-members.ts
### Task 1.5: Build Members page with CRUD

## Phase 2: Knowledge Registry — Catalogue + Items
### Task 2.1: Create API routes for catalogue and items
### Task 2.2: Create hooks for catalogue and items
### Task 2.3: Build Catalogue list page
### Task 2.4: Build Catalogue detail + Items page
### Task 2.5: Build Catalogue form (tabbed)

## Phase 3: Circulation
### Task 3.1: Create API routes for circulation
### Task 3.2: Create hooks for circulation
### Task 3.3: Build Circulation Desk page (issue/return/renew)
### Task 3.4: Build Holds page
### Task 3.5: Build Overdue page
### Task 3.6: Build Late Charges page

## Phase 4: Procurement & Budget
### Task 4.1: Create API routes for procurement
### Task 4.2: Create hooks for procurement
### Task 4.3: Build Suppliers page
### Task 4.4: Build Budget page
### Task 4.5: Build Purchase Requests page
### Task 4.6: Build Procurement Orders page

## Phase 5: Periodicals & Digital
### Task 5.1: Create API routes for periodicals and digital
### Task 5.2: Build Subscriptions page
### Task 5.3: Build Subscription detail + Issues page
### Task 5.4: Build Digital Resources page

## Phase 6: OPAC
### Task 6.1: Create API route for OPAC search
### Task 6.2: Build OPAC search page
### Task 6.3: Build Resource detail page

## Phase 7: Reports
### Task 7.1: Create API routes for reports
### Task 7.2: Build Reports dashboard (NAAC + Accession Register + Circulation)

## Phase 8: Navigation & Dashboard
### Task 8.1: Build LIB sidebar navigation
### Task 8.2: Build Learning Commons Dashboard
