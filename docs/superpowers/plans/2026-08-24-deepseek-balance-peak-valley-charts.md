# DeepSeek Balance Peak/Valley Indicator and Consumption Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the DeepSeek balance capsule in `deepseek_harness` into a dynamic peak/valley indicator (`梁文峰` in red during peak, `梁文谷` in blue during off-peak) with an interactive SVG consumption bar chart popover.

**Architecture:** Host service (`deepseek-balance`) tracks balance snapshots and computes peak/valley status + daily/monthly consumption deltas; `apiproxy` exposes extended RPC types; Client UI (`ui-deepseek-balance`) renders the colored capsule and the native SVG consumption popover.

**Tech Stack:** TypeScript, React, CSS Modules (`--dsw-*` tokens), Node.js, Vitest.

## Global Constraints
- Timezone: Strict Beijing Time (UTC+8) for peak/valley calculations (Valley: 00:30-08:30, Peak: 08:30-00:30).
- Pure native SVG charts for consumption graphs (no heavy third-party chart libraries).
- Styling strictly adheres to `deepseek_harness` semantic design tokens (`--dsw-*`).
- Full unit test coverage for peak/valley logic, delta aggregation, and React components.

---

### Task 1: Peak/Valley Engine & History Snapshot Storage (`packages/remote/deepseek-balance`)

**Files:**
- Modify: `packages/remote/deepseek-balance/src/types.ts`
- Modify: `packages/remote/deepseek-balance/src/index.ts`
- Test: `packages/remote/deepseek-balance/tests/deepseek-balance.spec.ts`

**Interfaces:**
- Produces: `DeepSeekBalance` with `period: 'peak' | 'valley'`, `periodLabel: string`, `consumption: { daily: ConsumptionItem[], monthly: ConsumptionItem[] }`.

- [ ] **Step 1: Write failing unit tests for peak/valley detection and balance history aggregation**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement peak/valley evaluation and snapshot delta storage in `packages/remote/deepseek-balance`**
- [ ] **Step 4: Run unit tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Apiproxy Domain Contract Update (`packages/host/apiproxy`)

**Files:**
- Modify: `packages/host/apiproxy/src/api/balance.ts`
- Modify: `packages/host/apiproxy/src/api/balance.schema.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`

**Interfaces:**
- Consumes: Extended `DeepSeekBalance` from Task 1.
- Produces: Updated `BalanceView` wire schema and `balance.get` RPC response.

- [ ] **Step 1: Update `balance.schema.ts` and `balance.ts` with new period and consumption fields**
- [ ] **Step 2: Update `api-proxy.ts` balance handler to forward extended data**
- [ ] **Step 3: Run existing apiproxy tests to verify wire schema validation**
- [ ] **Step 4: Commit changes**

---

### Task 3: Client Capsule Dynamic Theme (`packages/client/ui-deepseek-balance`)

**Files:**
- Modify: `packages/client/ui-deepseek-balance/src/client/BalanceCapsule.module.css`
- Modify: `packages/client/ui-deepseek-balance/src/client/BalanceCapsule.tsx`
- Modify: `packages/client/ui-deepseek-balance/src/client/locales.ts`
- Test: `packages/client/ui-deepseek-balance/tests/balance.client.spec.tsx`

**Interfaces:**
- Produces: `BalanceCapsule` component rendering red `梁文峰` in peak hours and blue `梁文谷` in valley hours.

- [ ] **Step 1: Update locale dictionaries with new capsule title and aria labels**
- [ ] **Step 2: Add CSS module classes for red peak theme and blue valley theme**
- [ ] **Step 3: Update `BalanceCapsule.tsx` to render period prefix and apply dynamic theme classes**
- [ ] **Step 4: Update `balance.client.spec.tsx` and verify tests pass**
- [ ] **Step 5: Commit changes**

---

### Task 4: Native SVG Consumption Popover (`packages/client/ui-deepseek-balance`)

**Files:**
- Create: `packages/client/ui-deepseek-balance/src/client/ConsumptionPopover.tsx`
- Create: `packages/client/ui-deepseek-balance/src/client/ConsumptionPopover.module.css`
- Modify: `packages/client/ui-deepseek-balance/src/client/BalanceCapsule.tsx`
- Test: `packages/client/ui-deepseek-balance/tests/balance.client.spec.tsx`

**Interfaces:**
- Consumes: `consumption: { daily, monthly }` from balance snapshot.
- Produces: Click-to-open Popover card with Daily & Monthly consumption bar charts.

- [ ] **Step 1: Implement `ConsumptionPopover.tsx` with SVG bar chart, tab switcher, and hover tooltips**
- [ ] **Step 2: Add CSS styling in `ConsumptionPopover.module.css`**
- [ ] **Step 3: Wire click handler on `BalanceCapsule.tsx` to toggle the Popover**
- [ ] **Step 4: Add test coverage for Popover open/close and tab switching**
- [ ] **Step 5: Commit changes**

---

### Task 5: End-to-End Integration & Workspace Verification

**Files:**
- Workspace test scripts and typecheck.

- [ ] **Step 1: Run full test suite for `@deepseek-ai/dsh-deepseek-balance`**
- [ ] **Step 2: Run full test suite for `@deepseek-ai/dsh-client-ui-deepseek-balance`**
- [ ] **Step 3: Run workspace typecheck (`pnpm run check` or `tsc -b`)**
- [ ] **Step 4: Commit final integration touches**
