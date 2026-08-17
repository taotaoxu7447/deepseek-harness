# Agent Note: Vision chain card — priority chain, drag reordering, row collapse, and the key-draft echo

Status: implemented

English | [中文](2026-08-17-vision-chain-priority-drag-ui.zh.md)

## Problem

The vision chain's semantics — the topmost backend serves first, and one that exhausts its attempt budget falls to the next — were expressed only as a text label (`Priority N · id`) plus up/down/remove buttons on each row. Users could not see the chain as a chain, and re-sequencing three or more backends by repeated single-step button clicks was tedious and error-prone.

## Decision

**Draw the chain**: each backend row is now a bordered card whose head carries a drag handle, a circular priority badge (its position number), a model-led title, and a protocol chip; a parked (`enabled: false`) row is muted and wears a Disabled chip. Between each adjacent pair, a connector line names the fallback — "exhausts N attempts — the next priority serves" — with N read from the staged attempts draft (blank inherits the Host default of 2). Position in the document, not a label, now carries the priority meaning.

**Drag to reorder, keep the buttons**: the row head's ⋮⋮ handle starts a native HTML5 drag (`draggable` + `dataTransfer`), any row accepts the dragover, and a drop commits through a new absolute `moveRowTo(from, to)` face action; the up/down buttons stay as the keyboard-accessible path. Drag state (source index, hover marker) lives in the card component's React state only — the controller store learns about a drag solely at its commit point (the drop), so save/discard can never observe a half-finished drag. The pattern follows the existing `ui-workspace` row drag, simplified for a list capped at five: no insert markers, drop-on-row commits directly.

**Collapse to the head for reordering**: each row's ▾ button hides its fields (`hidden` on the body, so drafts survive), and a Collapse all control beside Add backend does the whole chain at once; collapsed rows still carry their drag handle, so re-sequencing a long chain happens across compact heads. Collapse state keys by the stable `row.id`, so it follows the row across reorders.

**The key field echoes the draft**: the key input previously bound a hardcoded empty string, so a controlled reset swallowed every keystroke — the user could not tell typing had any effect. The snapshot now carries `rowKeys` (the user's own typing, never read back from the credential store), the password input echoes it as dots, and a Staged badge marks it until the save lands; the post-save reseed clears the draft and the configured badge takes over.

## Alternatives considered

**Insert-marker drag (full `ui-workspace` pattern)**. Dropping between rows with a rendered marker line is the richer interaction, but it doubles the drag state (marker position beside the source) and its test surface for a list that holds at most five entries; dropping on a row reads unambiguously at this size.

**Click-to-promote or position-select controls**. A per-row "priority" dropdown asks the user to reason about absolute numbers rather than the spatial order they can already see; drag plus single-step buttons covers both the gross and the fine adjustment.

## Consequences

- Row React keys moved from the render index to the stable `row.id`, so a reordered row keeps no stale per-index DOM state.
- `moveRowTo` is the single reorder operation; `moveRow(index, ±1)` now routes through it, so buttons and drag share one guard set (same-index no-op, out-of-range ignored).
- The staged attempts draft feeds the connector copy, so the fallback text tracks the chain's retry budget as the user edits it.
- Model-visible ⟺ logged is untouched: this is a renderer and controller change only; the section document and the wire are unchanged.

Relates: [2026-08-17-vision-chain-protocols-effort-presets](2026-08-17-vision-chain-protocols-effort-presets.md).
