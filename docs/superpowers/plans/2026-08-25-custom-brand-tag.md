# Customizable Brand Tag & Light Mode White Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide full personalization for the top-left brand tag (text up to 8 chars, border color, light/dark background colors) and ensure its default background in Light Mode is pure white (`#ffffff`).

**Architecture:** `BrandWordmark` in `ui-primitives` accepts dynamic tag props and adapts chamfer polygon geometry; `ui-brand-official` subscribes to the `brand-tag` settings scope to feed current values; `ui-settings-general` adds a visual `BrandTagCard` with live preview and color pickers.

**Tech Stack:** React, TypeScript, SVG math, CSS Modules (`--dsw-*` tokens), Vitest.

## Global Constraints
- Light Mode default background is `#ffffff` (pure white); Dark Mode default background is `#0f172a`.
- Tag text is strictly clamped to max 8 characters (default: `TAO`).
- Changes in Settings update immediately live across the application without page reload.
- Full unit test coverage for geometry math, settings store binding, and card UI.

---

### Task 1: Dynamic BrandWordmark Geometry & Light Mode White Background (`packages/client/ui-primitives`)

**Files:**
- Modify: `packages/client/ui-primitives/src/BrandWordmark.tsx`
- Test: `packages/client/ui-primitives/tests/icons.client.spec.tsx`

**Interfaces:**
- Produces: `BrandWordmarkProps` with `tagText?: string`, `tagStroke?: string`, `tagFillLight?: string`, `tagFillDark?: string`.

- [ ] **Step 1: Write unit tests for custom text rendering, width expansion, and light mode white background**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement dynamic chamfer polygon coordinates, text centering, and CSS variable / prop theming in `BrandWordmark.tsx`**
- [ ] **Step 4: Run unit tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Reactive Settings Integration (`packages/client/ui-brand-official`)

**Files:**
- Modify: `packages/client/ui-brand-official/src/client/Brand.tsx`
- Modify: `packages/client/ui-brand-official/src/client/index.ts`
- Test: `packages/client/ui-brand-official/tests/brand.client.spec.tsx`

**Interfaces:**
- Consumes: `SettingsScope<BrandTagSettings>` (`brand-tag` namespace).
- Produces: `OfficialBrandName` dynamically reflecting current `brand-tag` configuration.

- [ ] **Step 1: Write test for `OfficialBrandName` updating when `brand-tag` settings change**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `brand-tag` SettingsScope subscription in `Brand.tsx` and pass props to `BrandWordmark`**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 3: Brand Tag Settings Card in General Settings (`packages/client/ui-settings-general`)

**Files:**
- Create: `packages/client/ui-settings-general/src/client/BrandTagCard.tsx`
- Create: `packages/client/ui-settings-general/src/client/BrandTagCard.module.css`
- Modify: `packages/client/ui-settings-general/src/client/GeneralSection.tsx`
- Modify: `packages/client/ui-settings-general/src/client/locales.ts`
- Test: `packages/client/ui-settings-general/tests/brand-tag.client.spec.tsx`

**Interfaces:**
- Produces: Interactive settings card with live light/dark previews, 8-char input, preset color chips, custom color picker, and reset button.

- [ ] **Step 1: Write unit tests for `BrandTagCard` (input, color selection, validation, reset)**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `BrandTagCard.tsx`, CSS styles, and register into `GeneralSection.tsx`**
- [ ] **Step 4: Run unit tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 4: End-to-End Build & Verification

**Files:**
- Full workspace tests, typecheck, and build.

- [ ] **Step 1: Run vitest across all client packages**
- [ ] **Step 2: Run TypeScript typecheck (`pnpm tsc -b tsconfig.json`)**
- [ ] **Step 3: Run full project build (`pnpm run build`)**
- [ ] **Step 4: Commit and push changes**
