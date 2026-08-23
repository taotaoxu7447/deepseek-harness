# Agent Note: Composer status strips follow the official compact row

Status: implemented

English | [中文](2026-08-24-composer-status-strip-standard.zh.md)

## Problem

The `conversation.input.dock` list accepts entries from independent plugins, but the slot controls composition rather than presentation. When each plugin chooses its own collapsed height, outer margin, surface, shadow, and information density, aligned widths still produce an uneven stack and component margins double the parent-owned gap. The drift also increases conflicts when fork-specific plugins are carried across upstream UI updates.

## Decision

Standalone status and summary entries follow the official compact Todo-row baseline documented in the [Composer status strip reference](../../../../docs/composer-status-strips.md). The parent stack owns a 6px gap; entries add no vertical margin. A collapsed status card uses the shared dock width axis, a 36px inner row and 38px visible height, the tip surface, a level-one border, 12px radius, and no component-specific shadow.

Collapsed content remains one line and yields low-priority metrics before changing height. Expanded details may grow inside the same bounded card, but a persistent dashboard moves out of the composer stack. Registration `order` selects sequence and has no visual effect.

This is a contributor and plugin-author standard. It does not claim that every existing fork-specific entry already conforms; bringing an existing entry into conformance is a separate UI behavior change with its own verification.

## Alternatives considered

**Keep component-owned geometry.** This preserves local freedom but leaves no stable review criterion, allows margins to combine with the stack gap, and makes every new plugin rediscover width and density rules.

**Enlarge every entry to the 50px plugin-card treatment.** This makes the two current plugin cards agree with each other, but it changes the built-in compact visual baseline and increases the fork-specific diff that must be reconciled with upstream.

## Consequences

New and modified status strips have one reviewable target and can coexist without accumulating spacing. The compact row limits collapsed information density, so secondary metrics must hide or move into the expanded body. The rule remains documentation-enforced until a shared UI primitive or an automated visual check provides a narrower implementation path.
