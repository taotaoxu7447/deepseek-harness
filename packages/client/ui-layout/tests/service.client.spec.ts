/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, the three actions forwarding, the
 * unwired fail-loud, and re-attach overwriting a stale action set.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    openRemoteTab: vi.fn(),
    activateRemoteTab: vi.fn(),
    showLocalTab: vi.fn(),
    closeRemoteTab: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the panel and tab actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()
    const tab = { id: 'mac-mini', label: 'Mac Mini', url: 'http://127.0.0.1:3081/' }
    service.openRemoteTab(tab)
    service.activateRemoteTab('mac-mini')
    service.showLocalTab()
    service.closeRemoteTab('mac-mini')

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.openRemoteTab).toHaveBeenCalledWith(tab)
    expect(panels.activateRemoteTab).toHaveBeenCalledWith('mac-mini')
    expect(panels.showLocalTab).toHaveBeenCalledTimes(1)
    expect(panels.closeRemoteTab).toHaveBeenCalledWith('mac-mini')
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.openRemoteTab({ id: 'a', label: 'A', url: 'http://127.0.0.1:3081/' }) })
      .toThrow(/panel actions not wired/)
    expect(() => { service.activateRemoteTab('a') }).toThrow(/panel actions not wired/)
    expect(() => { service.showLocalTab() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeRemoteTab('a') }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
