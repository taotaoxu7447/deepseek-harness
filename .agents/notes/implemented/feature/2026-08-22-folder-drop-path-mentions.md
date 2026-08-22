# Agent Note: Folder drops into the composer — native drop bridge and path mentions

Status: implemented

English | [中文](2026-08-22-folder-drop-path-mentions.zh.md)

## Problem

The composer accepted drops only as images: the document-level handler read `dataTransfer.files`, a flat File list in which a dropped folder arrives as an empty husk (no name path, no bytes, empty type) and is rejected by the image-format check. There was no gesture for "let the agent look at this folder" at all, and no browser API can provide one — a page never receives absolute paths for dropped items, by design.

## Decision

Two intakes, one contract addition.

**macOS shell (the path-carrying case).** A transparent `ComposerDropBridgeView` overlay sits on top of the WKWebView in both app targets (main shell and the remote helper), registered for `.fileURL` drags only. AppKit resolves drag destinations geometrically (registration + frame containment), so the overlay's `hitTest → nil` keeps every click on the page while still receiving Finder drags. Because AppKit does not fall through to underlying views when the top destination declines, the overlay accepts *all* file drops and re-dispatches: folders and non-image files become mention entries carrying their absolute paths; image files (UTI-conforming, ≤32MB, ≤16 per drop) are read and inlined as base64. The payload crosses through `window.__dshNativeDrop(<json>)`, which the mounted `ComposerAttachments` registers and withdraws on unmount (identity-guarded, so a stale session never eats its successor's drop). Image entries are rebuilt into Files and fed to the same `onAddImages` intake a page-level drop used, so validation, toasts, and the draft rail behave identically.

**Mention insertion.** The `conversation.input.attachments` owner props gain `onAddPaths`; InputBar appends each path to the draft through the machine's single `setDraft` write path, formatted by the shared file-reference grammar (`formatFileMention`: trailing slash for directories, quoted when the path holds whitespace). Plain text is the model form — the chip look is the machine's scan-derived decoration, never state — so no occurrence minting is needed, and the existing `FILE_REFERENCE_PROMPT` already teaches the model that `@`-prefixed paths are user-referenced files to read with its tools.

**Browser fallback (no native shell).** A drop containing a folder is detected through `webkitGetAsEntry()` and walked (paged `readEntries`, a 512-entry budget against node_modules-shaped trees); the images found inside attach through the normal path. A folder without attachable images adds nothing — browsers cannot reference paths, and the overlay invite already frames the drop as images.

## Alternatives considered

**Navigation interception.** Skipping `preventDefault` on folder drops and catching the resulting `file://` navigation in the WKNavigationDelegate would leak the path with no overlay. Rejected: whether WebKit requests a navigation for a dropped *directory* is not verifiable without a manual drag, and in a plain browser the same gesture would navigate the tab away from the session. The page now always prevents the default, so the two runtimes stay consistent.

**Overlay that declines non-folder drags.** Rejected by AppKit semantics: when the topmost registered destination returns no operation, the drop is not offered to views underneath — declining would have killed the working image drop.

**Uploading folder contents as attachments.** Rejected: without paths the files are opaque bytes to the agent, while an absolute-path mention lets its fs tools work the folder directly — strictly more capable, and vision-capable deployments can still read images inside by path.

## Consequences

In-app, file drags no longer reach the page: the `DropOverlay` invitation and the busy-state `dropEffect` cursor do not appear during a Finder drag (the overlay answers `.copy`), and the blocked-composer refusal happens silently in the receiver instead of as a visible blocked state. In-page drags (workspace rows, text selections) never register `.fileURL`, so they pass to the page untouched. Mixed drops split by kind: images attach, everything else becomes mentions. The 32MB/16-image bridge caps are transport guards; the composer's own `imageLimits` stay authoritative. The bridge receiver is a `window` global, so exactly one mounted composer owns it — a surface that mounts two composers at once would need a routing key.

## Testing

`ui-attachment` specs cover the entry-tree walk (paging, failed leaves, readEntries errors, the budget, non-image and unknown-kind skips), the bridge payload decode (bytes/name/MIME), the component receiver (images→drafts, paths→mentions, `canAcceptDrop` gating, successor-safe unmount), and the browser folder-drop fork. `ui-conversation` specs cover `intakePaths` (slash/quoting, empty and whitespace-ended drafts, and the locked/busy/machine-absent/empty/unrepresentable refusals). The shell half is exercised by a manual smoke: drag a folder, an image, and a mixed batch onto the app composer, and confirm the in-page drags (workspace rows) still work.
