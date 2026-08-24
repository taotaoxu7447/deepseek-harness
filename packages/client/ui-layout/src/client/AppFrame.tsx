/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore, RemoteTab } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share + locale seat. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The window's browser-style tabs: the local Harness plus one tab per open
  // remote surface. The strip renders once any remote tab exists; while a
  // remote tab is staged, the columns stay mounted but hidden and the
  // remote's iframe takes the stage, so switching back is instant and the
  // local session UI never loses state.
  const remoteTabs: readonly RemoteTab[] = panels.remoteTabs
  const stagedRemote = panels.activeRemote === undefined
    ? undefined
    : remoteTabs.find(tab => tab.id === panels.activeRemote)

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  return (
    <div className={css.shell}>
      {remoteTabs.length > 0
        ? (
          <div className={css.tabStrip} role="tablist" aria-label={t('tabs.strip.label')}>
            <button
              type="button"
              role="tab"
              aria-selected={stagedRemote === undefined}
              className={css.tab}
              data-active={stagedRemote === undefined || undefined}
              title={t('tabs.local.label')}
              onClick={() => { actions.showLocalTab() }}
            >
              <span className={css.tabLabel}>{t('tabs.local')}</span>
            </button>
            {remoteTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={stagedRemote?.id === tab.id}
                className={css.tab}
                data-active={stagedRemote?.id === tab.id || undefined}
                title={tab.url}
                onClick={() => { actions.activateRemoteTab(tab.id) }}
              >
                <span className={css.tabLabel}>{tab.label}</span>
                <span
                  role="button"
                  aria-label={`${t('tabs.close')} ${tab.label}`}
                  className={css.tabClose}
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.closeRemoteTab(tab.id)
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )
        : null}
      {/* Every open remote surface keeps its iframe mounted (and its session
          running); only the staged one is visible. The iframe key includes the
          URL so a tunnel that came back on another port reloads fresh. */}
      {remoteTabs.length > 0
        ? (
          <div className={css.remoteStage} hidden={stagedRemote === undefined}>
            {remoteTabs.map(tab => (
              <iframe
                key={`${tab.id}@${tab.url}`}
                className={css.remoteFrame}
                hidden={stagedRemote?.id !== tab.id}
                src={tab.url}
                title={tab.label}
              />
            ))}
          </div>
        )
        : null}
      <div
        ref={frameRef}
        className={css.frame}
        hidden={stagedRemote !== undefined}
        style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
        data-sidebar-collapsed={sidebarCollapsed || undefined}
        data-details-collapsed={cols.details === 0 || undefined}
        data-dragging={dragging || undefined}
      >
        <div className={css.sidebarCol}>
          {/* Render-site slot call with live concession output: a closed
              sidebar keeps the mounted slot at the compact-rail width, and the
              component sees its rendered state as owner params decided here
              (collapsed follows the resolved rail, so a derived auto-collapse
              renders the rail UI too). */}
          {renderSlot('sidebar', {
            collapsed: sidebarCollapsed,
            width: cols.sidebar,
          })}
        </div>
        <>
          {/* Both column occupants stay at fixed tree positions from first
              paint — no loading gate: a bare status line reads worse than
              the shell's own pending rendering. The conversation
              is session-maybe; the strict details entry naturally renders
              empty while no session is current. */}
          <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
          <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
        </>
        <div className={css.overlayLayer} data-shell-overlay>
          {renderSlot('shell.overlay', {})}
        </div>
        {/* The collapsed rail is fixed-width: no resize handle while closed. */}
        {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
        {cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      </div>
    </div>
  )
}
