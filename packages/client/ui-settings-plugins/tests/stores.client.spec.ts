/**
 * The staged card form: what a draft shows before it is written, which wire
 * call a save reaches, and what happens to drafts the Host did not accept.
 */

import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { booleanField, CardForm, numberField, textField } from '../src/client/card-form.ts'
import { AgentLoopCardController, type AgentLoopSettings } from '../src/client/agent-loop-card-controller.ts'
import { BashCardController, type BashSettings } from '../src/client/bash-card-controller.ts'
import {
  SettingsDescribeMirror, type SettingsMirrorSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ConfigurablePluginsTabController } from '../src/client/tab-store.ts'
import { WebSearchCardController, type WebSearchSettings } from '../src/client/web-search-card-controller.ts'
import { VisionCardController, type VisionSettings } from '../src/client/vision-card-controller.ts'
import {
  REMOTE_POLL_MS, RemoteCardController, type RemoteSettings, type RemoteTunnelState,
} from '../src/client/remote-card-controller.ts'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubSettingsScope<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

function credentialsApi(configured: boolean) {
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'c-1' as never,
    result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured, writable: true } } } },
  }))
  const set = vi.fn(() => Promise.resolve({ rpcId: 'c-2' as never, result: { ok: true as const, value: {} } }))
  return { api: { credentials: { describe, set } } as never, describe, set }
}

describe('CardForm', () => {
  function form() {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      base: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      user: {},
    })
    return { host, subject }
  }

  it('shows the effective value and stays clean until something is staged', () => {
    const { subject } = form()

    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(subject.shell()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false })
  })

  it('marks a field the user layer carries as overridden', () => {
    const { host, subject } = form()

    host.publish({ value: { timeoutMs: 60_000 }, user: { timeoutMs: 60_000 } })

    // An override equal to the composition default is still an override.
    expect(subject.field('timeoutMs').overridden).toBe(true)
  })

  it('writes nothing until the form is saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')

    expect(subject.field('timeoutMs')).toEqual({ text: '9000', overridden: true, invalid: false })
    expect(subject.shell().dirty).toBe(true)
    expect(host.set).not.toHaveBeenCalled()

    await subject.save()

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000]])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false, saving: false })
  })

  it('drops a draft that settles back on the value already shown', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().edit('timeoutMs', '60000')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses to save while a draft is not a value the field accepts', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', 'soon')

    expect(subject.field('timeoutMs')).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(subject.shell()).toMatchObject({ dirty: true, invalid: true })

    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
    expect(subject.field('timeoutMs').text).toBe('soon')
  })

  it('stages a reset that clears the field only once saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ value: { timeoutMs: 9_000 }, user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')

    // The badge previews the save: the field will no longer be overridden.
    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(host.unset).not.toHaveBeenCalled()

    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })
  })

  it('treats resetting an inherited field as no change at all', async () => {
    const { host, subject } = form()

    subject.actions().resetField('timeoutMs')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.unset).not.toHaveBeenCalled()
  })

  it('clears a number field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().edit('timeoutMs', '')

    expect(subject.field('timeoutMs')).toEqual({ text: '', overridden: false, invalid: false })
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
  })

  it('clears a text field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { baseURL: 'https://search.test/v1' } })

    subject.actions().edit('baseURL', '   ')
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['baseURL']])
  })

  it('writes the trimmed text of a text field', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('baseURL', '  https://other.test  ')
    await subject.save()

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test']])
  })

  it('keeps the drafts a save did not land, and reports the failure', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()

    // The stub Host accepted the call without storing it, exactly as a
    // validator that refuses the value does.
    expect(host.set).toHaveBeenCalledWith('timeoutMs', 9_000)
    expect(subject.shell()).toMatchObject({ dirty: true, failed: true, saving: false })
    expect(subject.field('timeoutMs').text).toBe('9000')
  })

  it('reports a reset the Host did not apply as a failure', async () => {
    const { host, subject } = form()
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')
    await subject.save()

    expect(host.unset).toHaveBeenCalledWith('timeoutMs')
    expect(subject.shell().failed).toBe(true)
  })

  it('clears the failure as soon as the user edits again', async () => {
    const { subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()
    expect(subject.shell().failed).toBe(true)

    subject.actions().edit('timeoutMs', '9001')

    expect(subject.shell().failed).toBe(false)
  })

  it('discards every staged edit', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().discard()

    expect(subject.field('timeoutMs').text).toBe('60000')
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })

    // A discard with nothing staged publishes nothing.
    const before = subject.shell()
    subject.actions().discard()
    expect(subject.shell()).toEqual(before)

    await subject.save()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses a second save while one is in flight', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')
    const first = subject.save()
    expect(subject.shell().saving).toBe(true)
    const second = subject.save()
    await Promise.all([first, second])

    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('publishes a projection whenever the scope or a draft changes', () => {
    const { host, subject } = form()
    const store = subject.bind(() => subject.field('timeoutMs').text)
    expect(store.getSnapshot()).toBe('60000')

    host.publish({ value: { timeoutMs: 1_000 } })
    expect(store.getSnapshot()).toBe('1000')

    subject.actions().edit('timeoutMs', '2000')
    expect(store.getSnapshot()).toBe('2000')
  })

  it('refuses to address a field the card never declared', () => {
    const { subject } = form()

    expect(() => subject.field('nope')).toThrow('plugin card has no field nope')
  })

  it('renders an absent section value as an empty draft', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])

    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: undefined })

    expect(subject.field('timeoutMs').text).toBe('')
    expect(subject.field('baseURL').text).toBe('')
    expect(subject.shell().available).toBe(true)
  })

  it('stays unavailable while the namespace is not served', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs')])

    host.publish({ status: 'unavailable' })

    expect(subject.shell()).toMatchObject({ available: false, writable: false })
  })
})

describe('BashCardController', () => {
  it('projects both fields and saves them in one write pass', async () => {
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000, maxOutputBytes: 64_000 },
      base: { timeoutMs: 60_000, maxOutputBytes: 64_000 },
      user: { timeoutMs: 5_000 },
    })
    const face = controller.inject()

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      timeoutMs: { text: '5000', overridden: true },
      maxOutputBytes: { text: '64000', overridden: false },
    })

    face.edit('timeoutMs', '9000')
    face.edit('maxOutputBytes', '1024')
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000], ['maxOutputBytes', 1_024]])
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(false)
  })

  it('stages a reset and applies it on save', async () => {
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000 },
      base: { timeoutMs: 60_000 },
      user: { timeoutMs: 5_000 },
    })
    const face = controller.inject()

    face.resetField('timeoutMs')
    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('60000')

    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('timeoutMs') })

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      dirty: false,
      timeoutMs: { text: '60000', overridden: false },
    })
  })

  it('discards staged edits without writing', () => {
    const host = stubSettingsScope<BashSettings>()
    const controller = new BashCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { timeoutMs: 5_000 }, user: {} })
    const face = controller.inject()

    face.edit('timeoutMs', '9000')
    face.discard()

    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('5000')
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('AgentLoopCardController', () => {
  it('saves the only field it owns', async () => {
    const host = stubSettingsScope<AgentLoopSettings>()
    acceptWrites(host)
    const controller = new AgentLoopCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { maxParallelToolCalls: 10 },
      base: { maxParallelToolCalls: 10 },
      user: {},
    })
    const face = controller.inject()

    face.edit('maxParallelToolCalls', '4')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('maxParallelToolCalls', 4) })

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      dirty: false,
      maxParallelToolCalls: { text: '4', overridden: true },
    })
  })

  it('reports a read-only document so the card can disable its controls', () => {
    const host = stubSettingsScope<AgentLoopSettings>()
    const controller = new AgentLoopCardController(host.scope)

    host.publish({ status: 'ready', writable: false, value: { maxParallelToolCalls: 10 } })

    expect(controller.inject().hooks.agentLoopCard.getSnapshot().writable).toBe(false)
  })
})

describe('WebSearchCardController', () => {
  it('reads the credential state for the reference the tab names', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    const state = () => controller.inject().hooks.webSearchCard.getSnapshot()
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    await vi.waitFor(() => { expect(state().apiKeyConfigured).toBe(true) })

    expect(state()).toMatchObject({
      baseURL: { text: 'https://search.test/v1', overridden: false },
      apiKey: { text: '', overridden: false },
    })
  })

  it('writes the staged key through the credentials domain, never the settings section', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', ' ds-secret ')
    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(true)
    expect(credentials.set).not.toHaveBeenCalled()

    credentials.describe.mockImplementation(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured: true, writable: true } } } },
    }))
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith({ ref: 'DEEPSEEK_API_KEY', value: 'ds-secret' })
    expect(host.set).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ dirty: false, apiKeyConfigured: true })
    })
  })

  it('keeps the stored key when the draft is left blank', () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', '   ')

    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(false)
    face.save()

    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('re-reads when the Host reports the watched reference changed', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    credentials.describe.mockClear()

    // Another reference is not this card's business.
    controller.refreshCredential('OTHER_KEY')
    expect(credentials.describe).not.toHaveBeenCalled()

    // A key written on another surface reaches this card only through this signal.
    credentials.describe.mockImplementation(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured: true, writable: true } } } },
    }))
    controller.refreshCredential('DEEPSEEK_API_KEY')

    await vi.waitFor(() => {
      expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(true)
    })
  })

  it('addresses the reference the tab declares rather than the default', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'SEARCH_KEY' }, user: {} })
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith({ ref: 'SEARCH_KEY', value: 'ds-secret' })
  })

  it('reports a key the Host did not store as a failed save', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()

    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ failed: true, dirty: true })
    })
  })

  it('keeps the card usable when the credential read fails', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const describe = vi.fn(() => Promise.reject(new Error('offline')))
    const set = vi.fn(() => Promise.reject(new Error('offline')))
    const controller = new WebSearchCardController(host.scope, { credentials: { describe, set } } as never)
    const face = controller.inject()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalled() })

    expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({
      available: true,
      apiKeyConfigured: false,
      baseURL: { text: 'https://search.test/v1' },
    })
  })

  it('ignores a credential read the Host refused', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const describe = vi.fn(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: false as const, error: { code: 'credentials-unavailable', message: 'no provider' } },
    }))
    const controller = new WebSearchCardController(host.scope, { credentials: { describe, set: vi.fn() } } as never)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(false)
  })

  it('saves the endpoint and the search budget together', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    acceptWrites(host)
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
    const face = controller.inject()

    face.edit('baseURL', 'https://other.test')
    face.edit('maxUses', '3')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test'], ['maxUses', 3]])
    expect(credentials.set).not.toHaveBeenCalled()
  })
})

describe('ConfigurablePluginsTabController', () => {
  function settingsApi(namespaces: string[]) {
    const describe = vi.fn(() => Promise.resolve({
      rpcId: 's-1' as never,
      result: {
        ok: true as const,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: namespaces.map(ns => ({
            ns, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0,
          })),
        },
      },
    }))
    return { mirror: new SettingsDescribeMirror({ settings: { describe } } as never), describe }
  }

  /** Slot ledger stand-in: one stored entry per registered card key. */
  function ledger(...keys: string[]) {
    return keys.map(key => ({ component: null, options: { key } }))
  }

  it('dispatches the served namespaces a card claims, in card registration order', async () => {
    const settings = settingsApi(['bash', 'ui-theme', 'agent-loop'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('agent-loop', 'bash'))

    await settings.mirror.ensure()

    // ui-theme is served but claimed by no card here — another surface owns
    // it. The order is the cards', not the Host's: plugin activation can
    // reorder the description between boots.
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces)
      .toEqual(['agent-loop', 'bash'])
  })

  it('never dispatches a card whose namespace this deployment does not serve', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash', 'web-search-deepseek'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('takes a card registered after the read without asking the Host again', async () => {
    const settings = settingsApi(['bash'])
    let entries = ledger()
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])

    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
    expect(settings.describe).toHaveBeenCalledOnce()
  })

  it('keeps the namespaces it knew when a refresh fails', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))
    await settings.mirror.ensure()
    settings.describe.mockRejectedValueOnce(new Error('offline'))

    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('stops following the mirror once disposed, and never claims it was answered', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    controller.dispose()
    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: false, namespaces: [] })
  })

  it('ignores a slot-ledger change that arrives after disposal', async () => {
    const settings = settingsApi(['bash'])
    let entries = ledger()
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()

    controller.dispose()
    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])
  })

  it('ignores a mirror notification already queued when disposal starts', () => {
    let notify = (): void => {}
    let snapshot: SettingsMirrorSnapshot = {
      status: 'ready' as const,
      view: { writable: true, hasDocument: true, namespaces: [] },
      error: null,
    }
    const describeFace = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        notify = listener
        return () => {}
      },
      ensure: () => Promise.resolve(),
      acceptView: vi.fn(),
    } as never
    const controller = new ConfigurablePluginsTabController(describeFace, () => ledger('bash'))
    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })

    controller.dispose()
    snapshot = {
      status: 'ready',
      view: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'bash', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
        }],
      },
      error: null,
    }
    notify()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })

  it('reports the Host answered even when it serves nothing this tab shows', async () => {
    const settings = settingsApi(['ui-theme'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })
})

describe('booleanField', () => {
  it('formats the three stored states and parses every accepted draft', () => {
    const spec = booleanField('enabled')
    expect(spec.format(true)).toBe('on')
    expect(spec.format(false)).toBe('off')
    expect(spec.format(undefined)).toBe('')
    expect(spec.parse('on')).toEqual({ kind: 'set', value: true })
    expect(spec.parse(' TRUE ')).toEqual({ kind: 'set', value: true })
    expect(spec.parse('off')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('False')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse('maybe')).toBeUndefined()
  })
})

describe('VisionCardController', () => {
  /** Credentials + vision-discovery wire mocks for the chain card. */
  function wire(configured = false, models: { id: string; name?: string }[] = [{ id: 'found-model' }]) {
    type Answer = Promise<{
      rpcId: never
      result: { ok: true; value: { credentials: Record<string, { configured: boolean; writable: boolean }> } }
    }>
    const describe = vi.fn((): Answer => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: true as const, value: { credentials: { VISION_QWEN_API_KEY: { configured, writable: true } } } },
    }))
    const set = vi.fn(() => Promise.resolve({ rpcId: 'c-2' as never, result: { ok: true as const, value: {} } }))
    const discoverModels = vi.fn(() => Promise.resolve({
      rpcId: 'v-1' as never,
      result: { ok: true as const, value: { models } },
    }))
    const discoverFail = vi.fn(() => Promise.resolve({
      rpcId: 'v-2' as never,
      result: { ok: false as const, error: { code: 'vision-discovery-failed' as never, message: 'cannot reach the endpoint' } },
    }))
    const api = { credentials: { describe, set }, vision: { discoverModels } }
    return {
      api: api as unknown as Pick<IApiClient, 'credentials' | 'vision'>,
      describe,
      set,
      discoverModels,
      discoverFail,
    }
  }

  function section(host: StubSettingsScope<VisionSettings>, rows: VisionSettings['backends'], attempts?: number, maxTokens?: number): void {
    host.publish({
      status: 'ready',
      writable: true,
      value: {
        backends: rows,
        ...attempts === undefined ? {} : { attemptsPerBackend: attempts },
        ...maxTokens === undefined ? {} : { maxTokens },
      } as VisionSettings,
      base: { backends: rows },
      user: {},
    })
  }

  it('seeds the staged chain from the stored section', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1', model: 'm1' }, { id: 'gpt', baseURL: 'https://gpt.test/v1', model: 'm2', enabled: false }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(2) })

    const state = controller.inject().hooks.visionCard.getSnapshot()
    expect(state.rows.map(row => row.id)).toEqual(['qwen', 'gpt'])
    expect(state.rows[1]?.enabled).toBe(false)
    expect(state.dirty).toBe(false)
    expect(state.canAdd).toBe(true)
  })

  it('stages edits, reorders, adds within the cap, and saves the whole chain', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'a', baseURL: 'https://a.test/v1' }, { id: 'b', baseURL: 'https://b.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(2) })
    const face = controller.inject()

    face.editRow(0, 'model', ' qwen-vl ')
    face.moveRow(0, 1)
    face.addRow()
    face.editAttempts('3')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('attemptsPerBackend', 3) })

    const backendsCall = host.set.mock.calls.find(call => (call as unknown[])[0] === 'backends') as unknown as [string, unknown]
    const [field, value] = backendsCall
    expect(field).toBe('backends')
    const rows = value as { id: string; model?: string }[]
    expect(rows.map(row => row.id)).toEqual(['b', 'a', 'backend-3'])
    expect(rows[1]?.model).toBe('qwen-vl')
    expect(host.set).toHaveBeenCalledWith('attemptsPerBackend', 3)
  })

  it('moves a row to an absolute position and ignores no-op and out-of-range moves', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(3) })
    const face = controller.inject()

    face.moveRowTo(0, 2)
    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['b', 'c', 'a'])
    face.moveRowTo(2, 0)
    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['a', 'b', 'c'])

    // A same-index target and out-of-range endpoints change nothing.
    face.moveRowTo(1, 1)
    face.moveRowTo(9, 1)
    face.moveRowTo(0, 9)
    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('probes an endpoint and stages the advertised model', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.probe(0)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().probes[0]?.models).toEqual([{ id: 'found-model' }])
    })
    expect(w.discoverModels).toHaveBeenCalledWith({ baseURL: 'https://qwen.test/v1', protocol: 'openai-chat', apiKeyEnv: 'VISION_QWEN_API_KEY' })
    // A single advertised model stages itself.
    expect(controller.inject().hooks.visionCard.getSnapshot().rows[0]?.model).toBe('found-model')
  })

  it('surfaces a probe failure on the row', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const failingApi = { credentials: w.api.credentials, vision: { discoverModels: w.discoverFail } } as unknown as Pick<IApiClient, 'credentials' | 'vision'>
    const controller = new VisionCardController(host.scope, failingApi)
    section(host, [{ id: 'qwen', baseURL: 'https://down.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().probe(0)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().probes[0]?.error).toContain('cannot reach')
    })
  })

  it('writes staged keys through the credentials domain, never the section', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRowKey(0, ' typed-secret ')
    face.save()
    await vi.waitFor(() => { expect(w.set).toHaveBeenCalled() })

    expect(w.set).toHaveBeenCalledWith({ ref: 'VISION_QWEN_API_KEY', value: 'typed-secret' })
    expect(host.set).not.toHaveBeenCalledWith(expect.stringContaining('apiKey'), expect.anything())
  })

  it('caps the staged chain at five rows', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [1, 2, 3, 4, 5].map(n => ({ id: `b${n}`, baseURL: `https://b${n}.test/v1` })))
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(5) })
    const state = controller.inject().hooks.visionCard.getSnapshot()

    expect(state.canAdd).toBe(false)
    controller.inject().addRow()
    expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(5)
  })

  it('round-trips the protocol, effort, and numeric fields from the stored section', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{
      id: 'claude',
      baseURL: 'https://anthropic.test',
      model: 'claude-vision',
      protocol: 'anthropic',
      effortPreset: 'anthropic',
      effortEnabled: true,
      thinkingBudget: 2048,
      contextTokens: 200_000,
    }], undefined, 4096)
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    const state = controller.inject().hooks.visionCard.getSnapshot()
    expect(state.rows[0]).toMatchObject({ protocol: 'anthropic', effortPreset: 'anthropic', effortEnabled: true })
    expect(state.rowNumbers[0]).toEqual({ thinkingBudget: '2048', contextTokens: '200000' })
    expect(state.maxTokens).toBe('4096')
  })

  it('saves parsed numerics, omits blank drafts, and drops keys cleared to empty', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1', protocol: 'openai-responses', effortPreset: 'openai', effortLevel: 'high' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRow(0, 'protocol', '')          // back to the default: the key leaves the section
    face.editRow(0, 'effortPreset', 'qwen-local') // a preset switch clears the openai-only level
    face.editRow(0, 'effortEnabled', true)
    face.editRowNumber(0, 'thinkingBudget', ' 512 ')
    face.editRowNumber(0, 'contextTokens', '')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('backends', expect.anything()) })

    const backendsCall = host.set.mock.calls.find(call => (call as unknown[])[0] === 'backends') as unknown as [string, unknown]
    const rows = backendsCall[1] as Record<string, unknown>[]
    expect(rows[0]).toEqual({
      id: 'qwen',
      baseURL: 'https://qwen.test/v1',
      effortPreset: 'qwen-local',
      effortEnabled: true,
      thinkingBudget: 512,
    })
  })

  it('saves the context budget when staged', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRowNumber(0, 'contextTokens', '131072')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('backends', expect.anything()) })

    const backendsCall = host.set.mock.calls.find(call => (call as unknown[])[0] === 'backends') as unknown as [string, unknown]
    const rows = backendsCall[1] as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({ contextTokens: 131072 })
  })

  it('expands k/m suffixes on the staged budget drafts', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRowNumber(0, 'contextTokens', '256k')
    face.editRowNumber(0, 'thinkingBudget', '2K')
    face.editMaxTokens('1.5m')
    face.save()
    // Await the chain write, not the backends one: the backends write lands
    // first, and asserting right after it races the save's continuation.
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('maxTokens', 1_572_864) })

    const backendsCall = host.set.mock.calls.find(call => (call as unknown[])[0] === 'backends') as unknown as [string, unknown]
    const rows = backendsCall[1] as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({ contextTokens: 262_144, thinkingBudget: 2048 })
  })

  it('fails the save on a non-numeric budget draft and keeps the section untouched', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editMaxTokens('not-a-number')
    face.save()
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().failed).toBe(true) })

    expect(host.set).not.toHaveBeenCalled()
  })

  it('probes with the row protocol', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'claude', baseURL: 'https://anthropic.test', protocol: 'anthropic' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().probe(0)
    await vi.waitFor(() => { expect(w.discoverModels).toHaveBeenCalled() })

    expect(w.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'anthropic' }))
  })

  it('ignores edits addressed outside the staged chain', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRow(9, 'model', 'ghost')
    face.editRowNumber(9, 'thinkingBudget', '512')
    face.editRowKey(9, 'ghost-key')
    face.moveRow(9, 1)
    face.removeRow(9)
    face.probe(9)

    const state = controller.inject().hooks.visionCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]?.model).toBeUndefined()
    expect(w.discoverModels).not.toHaveBeenCalled()
  })

  it('clears an enum draft emptied on any of the three enum fields', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{
      id: 'qwen',
      baseURL: 'https://qwen.test/v1',
      protocol: 'openai-responses',
      effortPreset: 'openai',
      effortLevel: 'high',
    }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRow(0, 'effortLevel', '')
    face.editRow(0, 'effortPreset', '')
    face.editRow(0, 'protocol', '')

    const row = controller.inject().hooks.visionCard.getSnapshot().rows[0]
    expect(row).not.toHaveProperty('effortLevel')
    expect(row).not.toHaveProperty('effortPreset')
    expect(row).not.toHaveProperty('protocol')
  })

  it('keeps an emptied text draft as an empty string rather than deleting the key', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1', model: 'm1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().editRow(0, 'baseURL', '   ')

    expect(controller.inject().hooks.visionCard.getSnapshot().rows[0]?.baseURL).toBe('')
  })

  it('refuses moves that would leave the chain, and removes rows', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'a', baseURL: 'https://a.test/v1' }, { id: 'b', baseURL: 'https://b.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(2) })
    const face = controller.inject()

    face.moveRow(0, -1)
    face.moveRow(1, 1)
    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['a', 'b'])

    face.removeRow(0)
    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['b'])
    expect(controller.inject().hooks.visionCard.getSnapshot().rowNumbers).toHaveLength(1)
  })

  it('mints a fresh id when the next ordinal is taken', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'backend-2', baseURL: 'https://a.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().addRow()

    expect(controller.inject().hooks.visionCard.getSnapshot().rows.map(row => row.id)).toEqual(['backend-2', 'backend-3'])
  })

  it('drops every staged edit on discard', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1', model: 'm1' }], 2)
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRow(0, 'model', 'edited')
    face.editAttempts('5')
    face.discard()

    const state = controller.inject().hooks.visionCard.getSnapshot()
    expect(state.rows[0]?.model).toBe('m1')
    expect(state.attempts).toBe('2')
    expect(state.dirty).toBe(false)
  })

  it('asks for the endpoint before probing, without touching the wire', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen' }, { id: 'blank', baseURL: '   ' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(2) })
    const face = controller.inject()

    face.probe(0)
    face.probe(1)

    const probes = controller.inject().hooks.visionCard.getSnapshot().probes
    expect(probes[0]?.error).toBe('enter the endpoint base URL first')
    expect(probes[1]?.error).toBe('enter the endpoint base URL first')
    expect(w.discoverModels).not.toHaveBeenCalled()
  })

  it('probes with the staged key draft and a declared credential reference', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [
      { id: 'qwen', baseURL: 'https://qwen.test/v1', model: 'chosen' },
      { id: 'custom', baseURL: 'https://custom.test/v1', apiKeyEnv: 'MY_VISION_KEY' },
      { id: 'emptyref', baseURL: 'https://e.test/v1', apiKeyEnv: '' },
    ])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(3) })
    const face = controller.inject()

    face.editRowKey(0, ' typed-secret ')
    face.probe(0)
    await vi.waitFor(() => { expect(w.discoverModels).toHaveBeenCalledWith({
      baseURL: 'https://qwen.test/v1',
      protocol: 'openai-chat',
      apiKey: 'typed-secret',
    }) })
    // One advertised model does not override a model the row already carries.
    expect(controller.inject().hooks.visionCard.getSnapshot().rows[0]?.model).toBe('chosen')

    face.probe(1)
    await vi.waitFor(() => { expect(w.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ apiKeyEnv: 'MY_VISION_KEY' })) })
    // An empty declared reference falls back to the derived default.
    face.probe(2)
    await vi.waitFor(() => { expect(w.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ apiKeyEnv: 'VISION_EMPTYREF_API_KEY' })) })
  })

  it('reports a probe the deployment never answered', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const rejectingApi = {
      credentials: w.api.credentials,
      vision: { discoverModels: vi.fn(() => Promise.reject(new Error('network down'))) },
    } as unknown as Pick<IApiClient, 'credentials' | 'vision'>
    const controller = new VisionCardController(host.scope, rejectingApi)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }, { id: 'other', baseURL: 'https://other.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(2) })

    controller.inject().probe(0)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().probes[0]?.error)
        .toBe('the probe could not reach the deployment')
    })
  })

  it('reports a probe answer without a result', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const malformedApi = {
      credentials: w.api.credentials,
      vision: { discoverModels: vi.fn(() => Promise.resolve({ rpcId: 'v-3' as never })) },
    } as unknown as Pick<IApiClient, 'credentials' | 'vision'>
    const controller = new VisionCardController(host.scope, malformedApi)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().probe(0)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().probes[0]?.error).toBe('the probe failed')
    })
  })

  it('leaves the model draft alone when the probe advertises several', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire(false, [{ id: 'm1' }, { id: 'm2' }])
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().probe(0)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().probes[0]?.models).toHaveLength(2)
    })

    const state = controller.inject().hooks.visionCard.getSnapshot()
    expect(state.rows[0]?.model).toBeUndefined()
    expect(state.dirty).toBe(false)
  })

  it('refuses to save while the document is read-only', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    host.publish({
      status: 'ready',
      writable: false,
      value: { backends: [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }] },
      base: {},
      user: {},
    })
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })

    controller.inject().save()
    await Promise.resolve()

    expect(host.set).not.toHaveBeenCalled()
    expect(controller.inject().hooks.visionCard.getSnapshot().saving).toBe(false)
  })

  it('writes a staged key to the reference the row declares', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1', apiKeyEnv: 'MY_VISION_KEY' }])
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editRowKey(0, 'typed-secret')
    // The draft echoes in the snapshot so the field can show what was typed.
    expect(controller.inject().hooks.visionCard.getSnapshot().rowKeys).toEqual(['typed-secret'])
    face.save()
    await vi.waitFor(() => { expect(w.set).toHaveBeenCalledWith({ ref: 'MY_VISION_KEY', value: 'typed-secret' }) })
    // Once the save lands, the reseed clears the draft; the badge carries the state.
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rowKeys).toEqual(['']) })
  })

  it('keeps the credential badge empty when the read fails or is refused', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire()
    const rejecting = vi.fn(() => Promise.reject(new Error('wire down')))
    const refusing = vi.fn(() => Promise.resolve({ rpcId: 'c-3' as never, result: { ok: false as const, error: {} } }))
    const api = {
      credentials: { describe: rejecting, set: w.set },
      vision: w.api.vision,
    } as unknown as Pick<IApiClient, 'credentials' | 'vision'>
    const controller = new VisionCardController(host.scope, api)
    section(host, [
      { id: 'qwen', baseURL: 'https://qwen.test/v1' },
      { id: 'custom', baseURL: 'https://custom.test/v1', apiKeyEnv: 'MY_VISION_KEY' },
    ])
    await vi.waitFor(() => { expect(rejecting).toHaveBeenCalledWith({ refs: ['VISION_QWEN_API_KEY', 'MY_VISION_KEY'] }) })
    expect(controller.inject().hooks.visionCard.getSnapshot().credentials).toEqual([])

    // A watched reference re-reads even before any read has landed; the
    // derived default and the declared reference both watch.
    controller.refreshCredential('VISION_QWEN_API_KEY')
    api.credentials = { describe: refusing, set: w.set } as never
    controller.refreshCredential('MY_VISION_KEY')
    await vi.waitFor(() => { expect(refusing).toHaveBeenCalled() })
    expect(controller.inject().hooks.visionCard.getSnapshot().credentials).toEqual([])
  })

  it('unsets attempts when the staged draft is not a number', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }], 2)
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editAttempts('abc')
    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('attemptsPerBackend') })
  })

  it('unsets the output budget when its staged draft is blanked', async () => {
    const host = stubSettingsScope<VisionSettings>()
    acceptWrites(host)
    const w = wire()
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [{ id: 'qwen', baseURL: 'https://qwen.test/v1' }], undefined, 4096)
    await vi.waitFor(() => { expect(controller.inject().hooks.visionCard.getSnapshot().rows).toHaveLength(1) })
    const face = controller.inject()

    face.editMaxTokens('')
    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('maxTokens') })
  })

  it('re-reads credentials only for a reference some row watches', async () => {
    const host = stubSettingsScope<VisionSettings>()
    const w = wire(true)
    const controller = new VisionCardController(host.scope, w.api)
    section(host, [
      { id: 'qwen', baseURL: 'https://qwen.test/v1' },
      { id: 'custom', baseURL: 'https://custom.test/v1', apiKeyEnv: 'MY_VISION_KEY' },
    ])
    await vi.waitFor(() => {
      expect(controller.inject().hooks.visionCard.getSnapshot().credentials).toHaveLength(2)
    })
    const calls = w.describe.mock.calls.length

    controller.refreshCredential('SOMEWHERE_ELSE_API_KEY')
    controller.refreshCredential('VISION_QWEN_API_KEY')   // the derived default
    controller.refreshCredential('MY_VISION_KEY')          // the declared reference
    await vi.waitFor(() => { expect(w.describe.mock.calls.length).toBe(calls + 2) })
  })
})

describe('RemoteCardController', () => {
  /** Wire mocks for the remote domain: an answerable roster poll and the two verbs. */
  function remoteWire(devices: RemoteTunnelState[] = []) {
    const list = vi.fn(() => Promise.resolve({
      rpcId: 'r-1' as never,
      result: { ok: true as const, value: { devices } },
    }))
    const settle = () => Promise.resolve({ rpcId: 'r-2' as never, result: { ok: true as const, value: {} } })
    const connect = vi.fn(settle)
    const disconnect = vi.fn(settle)
    const api = { remote: { list, connect, disconnect } }
    return { api: api as unknown as Pick<IApiClient, 'remote'>, list, connect, disconnect }
  }

  function section(host: StubSettingsScope<RemoteSettings>, devices: RemoteSettings['devices']): void {
    host.publish({
      status: 'ready',
      writable: true,
      value: { ...devices === undefined ? {} : { devices } },
      base: {},
      user: {},
    })
  }

  function navigation() {
    return { open: vi.fn(), assign: vi.fn() }
  }

  it('seeds the staged roster and port drafts from the stored section', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [
      { id: 'work', label: 'Work', sshTarget: 'work', remotePort: 3080, localPort: 14000, autoConnect: true },
      { id: 'hk' },
    ])

    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.rows.map(row => row.id)).toEqual(['work', 'hk'])
    expect(state.rows[0]).toEqual({ id: 'work', label: 'Work', sshTarget: 'work', autoConnect: true })
    expect(state.rowPorts[0]).toEqual({ remotePort: '3080', localPort: '14000' })
    expect(state.rowPorts[1]).toEqual({ remotePort: '', localPort: '' })
    expect(state.dirty).toBe(false)
    expect(state.tunnels).toEqual([undefined, undefined])
  })

  it('stages edits and saves the whole roster, parsing ports and dropping blanked keys', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    acceptWrites(host)
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', label: 'Work', sshTarget: 'work', remotePort: 3080, localPort: 14000, autoConnect: true }])
    const face = controller.inject()

    face.editRow(0, 'label', '  ')
    face.editRowPort(0, 'remotePort', '3090')
    face.addRow()
    face.editRow(1, 'sshTarget', 'hk')
    expect(controller.inject().hooks.remoteCard.getSnapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalled() })

    const [field, value] = host.set.mock.calls[0] as unknown as [string, unknown]
    expect(field).toBe('devices')
    expect(value).toEqual([
      { id: 'work', sshTarget: 'work', autoConnect: true, remotePort: 3090, localPort: 14000 },
      { id: 'device-2', sshTarget: 'hk' },
    ])
    await vi.waitFor(() => {
      const state = controller.inject().hooks.remoteCard.getSnapshot()
      expect(state.dirty).toBe(false)
      expect(state.rows).toHaveLength(2)
      expect(state.rowPorts[0]?.remotePort).toBe('3090')
    })
  })

  it('mints an add-row id past every existing one', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'device-2' }])
    const face = controller.inject()

    face.addRow()
    expect(controller.inject().hooks.remoteCard.getSnapshot().rows.map(row => row.id)).toEqual(['device-2', 'device-3'])
  })

  it('fails the save without a write when a staged port is out of range', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.editRowPort(0, 'localPort', '70000')
    face.save()
    await vi.waitFor(() => {
      expect(controller.inject().hooks.remoteCard.getSnapshot().failed).toBe(true)
    })
    expect(host.set).not.toHaveBeenCalled()
  })

  it('keeps the failure banner up after a rejected write reseeds the drafts', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    host.set.mockRejectedValue(new Error('the deployment refused the write'))
    const face = controller.inject()

    face.editRow(0, 'label', 'Work')
    face.save()
    await vi.waitFor(() => {
      const state = controller.inject().hooks.remoteCard.getSnapshot()
      expect(state.failed).toBe(true)
      expect(state.dirty).toBe(false)
      expect(state.rows[0]?.label).toBeUndefined()
    })
  })

  it('discards staged edits back to the stored section', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.editRow(0, 'label', 'Work')
    face.addRow()
    face.discard()
    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.rows).toEqual([{ id: 'work', sshTarget: 'work' }])
  })

  it('maps the polled tunnel state onto rows by id, not position', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire([
      { id: 'a', tunnel: 'ready', url: 'http://127.0.0.1:13389/' },
      { id: 'b', tunnel: 'failed', detail: 'permission denied (publickey)' },
    ])
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'b', sshTarget: 'b' }, { id: 'a', sshTarget: 'a' }])
    const face = controller.inject()

    face.setPolling(true)
    await vi.waitFor(() => {
      const state = controller.inject().hooks.remoteCard.getSnapshot()
      expect(state.tunnels[0]?.tunnel).toBe('failed')
      expect(state.tunnels[1]?.tunnel).toBe('ready')
    })
    face.setPolling(false)

    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.tunnels[0]?.detail).toBe('permission denied (publickey)')
    expect(state.tunnels[1]?.url).toBe('http://127.0.0.1:13389/')
  })

  it('runs the verbs against the row id and refreshes, swallowing a rejection', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire([{ id: 'work', tunnel: 'disconnected' }])
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.connect(0)
    await vi.waitFor(() => { expect(w.connect).toHaveBeenCalledWith({ id: 'work' }) })
    await vi.waitFor(() => { expect(w.list).toHaveBeenCalled() })

    w.disconnect.mockRejectedValueOnce(new Error('host unreachable'))
    face.disconnect(0)
    await vi.waitFor(() => { expect(w.disconnect).toHaveBeenCalledWith({ id: 'work' }) })
    await vi.waitFor(() => { expect(w.list).toHaveBeenCalledTimes(2) })
  })

  it('navigates only for a row whose poll published a url', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const nav = navigation()
    const w = remoteWire([
      { id: 'work', tunnel: 'ready', url: 'http://127.0.0.1:13389/' },
      { id: 'hk', tunnel: 'disconnected' },
    ])
    const controller = new RemoteCardController(host.scope, w.api, nav)
    section(host, [{ id: 'work', sshTarget: 'work' }, { id: 'hk', sshTarget: 'hk' }])
    const face = controller.inject()

    face.setPolling(true)
    await vi.waitFor(() => {
      expect(controller.inject().hooks.remoteCard.getSnapshot().tunnels[0]?.url).toBe('http://127.0.0.1:13389/')
    })
    face.setPolling(false)

    face.openExternal(0)
    face.openHere(0)
    expect(nav.open).toHaveBeenCalledWith('http://127.0.0.1:13389/')
    expect(nav.assign).toHaveBeenCalledWith('http://127.0.0.1:13389/')

    face.openExternal(1)
    face.openHere(1)
    expect(nav.open).toHaveBeenCalledTimes(1)
    expect(nav.assign).toHaveBeenCalledTimes(1)
  })

  it('polls on an interval only while active', async () => {
    vi.useFakeTimers()
    try {
      const host = stubSettingsScope<RemoteSettings>()
      const w = remoteWire([])
      const controller = new RemoteCardController(host.scope, w.api, navigation())
      section(host, [{ id: 'work', sshTarget: 'work' }])
      const face = controller.inject()

      face.setPolling(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(w.list).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS)
      expect(w.list).toHaveBeenCalledTimes(2)

      // Repeating the same request is a no-op; stopping ends the interval.
      face.setPolling(true)
      face.setPolling(false)
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS * 3)
      expect(w.list).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores row actions aimed outside the roster', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const nav = navigation()
    const controller = new RemoteCardController(host.scope, w.api, nav)
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.editRow(9, 'label', 'nope')
    face.editRowPort(9, 'localPort', '14000')
    face.removeRow(9)
    face.connect(9)
    face.disconnect(9)
    face.openExternal(9)
    face.openHere(9)

    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.rows).toHaveLength(1)
    expect(w.connect).not.toHaveBeenCalled()
    expect(w.disconnect).not.toHaveBeenCalled()
    expect(nav.open).not.toHaveBeenCalled()
    expect(nav.assign).not.toHaveBeenCalled()
  })

  it('leaves the staged roster alone when a poll fails', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    w.list.mockRejectedValue(new Error('offline'))
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.setPolling(true)
    await vi.waitFor(() => { expect(w.list).toHaveBeenCalled() })
    face.setPolling(false)

    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.tunnels).toEqual([undefined])
  })

  it('removes a staged row', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work' }, { id: 'hk' }])
    const face = controller.inject()

    face.removeRow(0)
    const state = controller.inject().hooks.remoteCard.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.rows.map(row => row.id)).toEqual(['hk'])
    expect(state.rowPorts).toHaveLength(1)
  })

  it('deletes a blanked sshTarget and stages a boolean verbatim', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work', autoConnect: true }])
    const face = controller.inject()

    face.editRow(0, 'sshTarget', '   ')
    face.editRow(0, 'autoConnect', false)
    expect(controller.inject().hooks.remoteCard.getSnapshot().rows[0]).toEqual({ id: 'work', autoConnect: false })
  })

  it('folds a poll requested mid-flight into one follow-up', async () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    w.list.mockImplementationOnce(() => gate.then(() => ({
      rpcId: 'r-1' as never,
      result: { ok: true as const, value: { devices: [] } },
    })))
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    section(host, [{ id: 'work', sshTarget: 'work' }])
    const face = controller.inject()

    face.setPolling(true)
    await vi.waitFor(() => { expect(w.list).toHaveBeenCalledTimes(1) })
    // The verb's refresh arrives while the first poll is still on the wire.
    face.connect(0)
    await vi.waitFor(() => { expect(w.connect).toHaveBeenCalled() })
    release()
    await vi.waitFor(() => { expect(w.list).toHaveBeenCalledTimes(2) })
    face.setPolling(false)
  })

  it('refuses to save a read-only document', () => {
    const host = stubSettingsScope<RemoteSettings>()
    const w = remoteWire()
    const controller = new RemoteCardController(host.scope, w.api, navigation())
    host.publish({
      status: 'ready',
      writable: false,
      value: { devices: [{ id: 'work', sshTarget: 'work' }] },
      base: {},
      user: {},
    })
    const face = controller.inject()

    face.editRow(0, 'label', 'Work')
    face.save()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('defaults navigation to the window surfaces', async () => {
    const open = vi.fn()
    const assign = vi.fn()
    vi.stubGlobal('window', { open, location: { assign } })
    try {
      const host = stubSettingsScope<RemoteSettings>()
      const w = remoteWire([{ id: 'work', tunnel: 'ready', url: 'http://127.0.0.1:13389/' }])
      const controller = new RemoteCardController(host.scope, w.api)
      section(host, [{ id: 'work', sshTarget: 'work' }])
      const face = controller.inject()

      face.setPolling(true)
      await vi.waitFor(() => {
        expect(controller.inject().hooks.remoteCard.getSnapshot().tunnels[0]?.url).toBe('http://127.0.0.1:13389/')
      })
      face.setPolling(false)

      face.openExternal(0)
      face.openHere(0)
      expect(open).toHaveBeenCalledWith('http://127.0.0.1:13389/', '_blank', 'noopener')
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:13389/')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
