# Composer status strip reference

English | [中文](composer-status-strips.zh.md)

This reference defines the layout, visual, responsive, and interaction rules for standalone status or summary entries registered in the `conversation.input.dock` slot above the message composer. The Web UI rules in [web-styling.md](web-styling.md) still govern tokens and component CSS; this page owns only the status-strip family.

## Scope

Use this family for a compact, glanceable summary that occupies one row while collapsed and may reveal bounded details below it. The built-in Todo strip is the visual baseline; operational dashboards, persistent forms, and content that cannot reduce to one summary row belong in a settings view, sidebar, dialog, or another purpose-built slot.

The standard applies to standalone cards. The Queue panel is an attached composer surface: it may cancel the parent gap and square its lower corners because the input card closes the shape. Third-party status strips must not copy that exception.

## Placement and ownership

Register each entry with a stable `id` and an explicit integer `order`. `order` controls sequence only; it must not change height, indentation, or spacing.

The `composerStack` owner supplies the vertical rhythm with `gap: 6px`. An entry must use `margin: 0` and must not add top or bottom spacing, because a component margin combines with the parent gap and makes adjacent entries appear farther apart.

Use the host-owned `--dsh-composer-side-clearance`, `--dsh-composer-dock-inset`, and `--dsh-composer-card-max-width` variables without private numeric fallbacks. The visible card subtracts both side clearances and four dock insets from the available width, and its maximum width subtracts four dock insets from the composer-card maximum. Do not subtract two insets on a wrapper and then add another padded wrapper unless the final visible card resolves to the same geometry.

## Geometry

| Part | Required value | Notes |
|---|---:|---|
| Visible card width | Composer card width minus 32px | Four host dock insets at the current 8px value; use the variables, not the resolved number |
| Stack gap | 6px | Owned by `composerStack`; entry margins remain zero |
| Card border | 1px | Included outside the 36px inner row |
| Card radius | 12px | Applies to the visible surface |
| Collapsed inner row | 36px | 24px content line plus 6px block padding on each side |
| Collapsed visible height | 38px | Inner row plus the two 1px borders |
| Inline padding | 12px | Symmetric left and right padding |
| Item gap | 10px | Between the leading glyph, title, summary, and trailing control |
| Leading glyph | 14px in a 16px cell | Decorative glyphs use `aria-hidden` |
| Expanded-body gap | 8px | Between the header and the first detail row |
| Expanded-body maximum | 180px | Longer detail lists scroll inside the card |

The following geometry is the reference implementation for a standalone card. A plugin may use different class names, but its resolved visible geometry must match.

```css
.dock {
  box-sizing: border-box;
  flex: none;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto;
}

.surface {
  box-sizing: border-box;
  overflow: hidden;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-tip);
}

.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
  padding: 6px 12px;
}
```

## Collapsed content

Keep the collapsed state on one line in this order: optional leading glyph, short title, flexible summary, optional compact metrics, and an optional trailing disclosure control. The title uses 13px/24px at weight 500 with the primary-label token; summary text uses 13px/20px at weight 400 with a secondary or tertiary label token.

The title and trailing control do not shrink. The summary takes the flexible width with `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`. Metrics disappear from lowest to highest importance before the title, current state, or disclosure control is removed.

Do not place a large branded tile, a two-line title/status block, or a persistent grid in the collapsed row. Status color belongs on a small glyph, dot, badge, or text fragment; it does not recolor the whole card.

## Surface and state

Use `--dsw-specific-tip` for the surface, `--dsw-alias-border-l1` for the border, and semantic label or state aliases for content. Do not add a component-specific shadow, literal color, theme selector, or fallback palette value. The common background and border keep several independently supplied entries in one visual family.

Hover, focus, selected, warning, and error states must remain local to the control or status fragment that owns the state. A whole-surface state treatment is reserved for an action-blocking error whose meaning applies to the entire entry.

## Expanded and responsive states

Expansion preserves the same card, width, header order, and horizontal alignment. Put details below the header with an 8px gap; detail rows use a 13px/20px text role and scroll inside a 180px maximum-height region. A feature that needs a permanently tall dashboard or an unbounded list must move the detailed view out of the composer stack and leave only its compact summary in the strip.

At narrow widths, truncate the flexible summary first, then hide secondary metrics by priority. Do not wrap the collapsed row or increase its height. Verify the composition with at least two simultaneous dock entries so responsive rules do not optimize only for an isolated component.

## Interaction and accessibility

An expandable strip uses one native button for the complete header and exposes `aria-expanded`; the expanded region has a stable relationship to that control. A non-expandable strip uses buttons only for real actions and does not imitate a clickable header.

Provide an accessible name for the section or status. Mark decorative glyphs as hidden, retain visible keyboard focus, and honor reduced-motion preferences for spinners or pulses. Do not announce high-frequency telemetry through a live region; reserve announcements for user-relevant state transitions.

## Review checklist

- The entry is registered in `conversation.input.dock` with a stable `id` and explicit `order`.
- The visible card uses the host width variables, a 12px radius, the tip surface, and the level-one border.
- The collapsed card resolves to a 36px inner row and 38px visible height.
- The entry has no vertical margin or custom shadow; the parent supplies the 6px stack gap.
- Collapsed content is one line and removes low-priority metrics before changing height.
- State color is local, and all colors come from semantic tokens.
- Expanded content is bounded; persistent detailed controls live outside the stack.
- Keyboard, focus, disclosure semantics, reduced motion, both themes, narrow width, and multiple simultaneous entries have been verified.
- GUI changes run the checks required by the [testing policy](testing.md).
