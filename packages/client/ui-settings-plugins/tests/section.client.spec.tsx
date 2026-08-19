// @vitest-environment jsdom
/**
 * What the section and its cards show: the empty line when no plugin
 * contributed one, a card that renders nothing while its namespace is
 * unavailable, and the save footer that decides when staged edits are written.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AgentLoopCard } from '../src/client/AgentLoopCard.tsx'
import type { AgentLoopCardProps } from '../src/client/AgentLoopCard.tsx'
import { BashCard } from '../src/client/BashCard.tsx'
import type { BashCardProps } from '../src/client/BashCard.tsx'
import { ConfigurablePluginsTab } from '../src/client/ConfigurablePluginsTab.tsx'
import type { ConfigurablePluginsTabProps } from '../src/client/ConfigurablePluginsTab.tsx'
import { PluginsSettingsSection } from '../src/client/PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionProps, PluginsSettingsTabEntry } from '../src/client/PluginsSettingsSection.tsx'
import { VisionCard } from '../src/client/VisionCard.tsx'
import type { VisionCardProps } from '../src/client/VisionCard.tsx'
import { WebSearchCard } from '../src/client/WebSearchCard.tsx'
import type { WebSearchCardProps } from '../src/client/WebSearchCard.tsx'
import type { AgentLoopCardState } from '../src/client/agent-loop-card-controller.ts'
import type { BashCardState } from '../src/client/bash-card-controller.ts'
import type { CardFieldState, CardShell } from '../src/client/card-form.ts'
import type { ConfigurablePluginsTabState } from '../src/client/tab-store.ts'
import type { VisionCardState } from '../src/client/vision-card-controller.ts'
import type { WebSearchCardState } from '../src/client/web-search-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

/** A settled form: nothing staged, everything served. */
const settled: CardShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** One control's state, defaulting to an inherited value. */
function field(text: string, rest: Partial<CardFieldState> = {}): CardFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderSection(rows: readonly PluginsSettingsTabEntry[]) {
  const props = {
    t,
    useTabs: (selector: (value: readonly PluginsSettingsTabEntry[]) => unknown) => selector(rows),
    renderSlot: (_name: string, _owner: unknown, options: { only?: string }) => (
      <span>{options.only}</span>
    ),
  } as unknown as PluginsSettingsSectionProps
  render(<PluginsSettingsSection {...props} />)
}

/**
 * Render the tab over the namespaces it was told to dispatch, with `cards`
 * standing in for the slot ledger: a key it names renders that text, and one
 * it does not renders nothing, exactly as an unclaimed key does.
 */
function renderConfigurable(namespaces: string[], cards: Record<string, string> = {}, loaded = true) {
  const store = createSnapshotStore<ConfigurablePluginsTabState>({ loaded, namespaces })
  const props = {
    t,
    useConfigurablePlugins: bindSnapshotSelector(store),
    renderSlot: (_name: string, _owner: object, opts?: { entryKey?: string }) => {
      const card = opts?.entryKey === undefined ? undefined : cards[opts.entryKey]
      return card === undefined ? null : <li>{card}</li>
    },
  } as unknown as ConfigurablePluginsTabProps
  render(<ConfigurablePluginsTab {...props} />)
}

function renderBash(state: Partial<BashCardState> = {}) {
  const store = createSnapshotStore<BashCardState>({
    ...settled,
    timeoutMs: field('60000'),
    maxOutputBytes: field('64000'),
    ...state,
  })
  const actions = cardActions()
  const props = { ...actions, t, useBashCard: bindSnapshotSelector(store) } as unknown as BashCardProps
  render(<BashCard {...props} />)
  return actions
}

describe('PluginsSettingsSection', () => {
  it('says so when no plugin contributed a tab', () => {
    renderSection([])

    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('defaults to the first ordered tab and mounts another only after selection', () => {
    renderSection([
      { id: 'configurable', order: 0, label: en.configurableTab },
      { id: 'all', order: 10, label: 'Plugin list' },
    ])

    const configurable = screen.getByRole('tab', { name: en.configurableTab })
    const all = screen.getByRole('tab', { name: 'Plugin list' })
    expect(configurable.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('configurable')).toBeTruthy()
    expect(screen.queryByText('all')).toBeNull()

    fireEvent.click(all)
    expect(all.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('all')).toBeTruthy()
    expect(screen.getByText('configurable').closest('[role="tabpanel"]')).toHaveProperty('hidden', true)

    fireEvent.click(configurable)
    expect(configurable.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('all').closest('[role="tabpanel"]')).toHaveProperty('hidden', true)
  })

  it('leads with its own heading and intro', () => {
    renderSection([{ id: 'configurable', order: 0, label: en.configurableTab }])

    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.intro)).toBeTruthy()
  })

  it('moves focus and selection with standard horizontal tab keys', () => {
    renderSection([
      { id: 'configurable', order: 0, label: en.configurableTab },
      { id: 'all', order: 10, label: 'Plugin list' },
      { id: 'diagnostics', order: 20, label: 'Diagnostics' },
    ])

    const configurable = screen.getByRole('tab', { name: en.configurableTab })
    const all = screen.getByRole('tab', { name: 'Plugin list' })
    const diagnostics = screen.getByRole('tab', { name: 'Diagnostics' })
    expect(configurable.getAttribute('tabindex')).toBe('0')
    expect(all.getAttribute('tabindex')).toBe('-1')

    configurable.focus()
    fireEvent.keyDown(configurable, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all)
    expect(all.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(all, { key: 'End' })
    expect(document.activeElement).toBe(diagnostics)
    fireEvent.keyDown(diagnostics, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(configurable)
    fireEvent.keyDown(configurable, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(diagnostics)
    fireEvent.keyDown(diagnostics, { key: 'Home' })
    expect(document.activeElement).toBe(configurable)

    fireEvent.keyDown(configurable, { key: 'Escape' })
    expect(document.activeElement).toBe(configurable)
    expect(configurable.getAttribute('aria-selected')).toBe('true')
  })
})

describe('ConfigurablePluginsTab', () => {
  it('says so when no plugin contributed a card', () => {
    renderConfigurable([], { bash: 'shell' })

    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByText('shell')).toBeNull()
  })

  it('withholds the empty line until the Host has answered once', () => {
    // An unanswered read is not the statement that this deployment configures
    // no plugin; saying it anyway would flash a wrong answer on every open.
    renderConfigurable([], { bash: 'shell' }, false)

    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('dispatches one card per namespace, keyed by it', () => {
    renderConfigurable(['bash', 'agent-loop'], { bash: 'shell', 'agent-loop': 'loop' })

    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['shell', 'loop'])
    expect(screen.queryByText(en.empty)).toBeNull()
  })
})

describe('BashCard', () => {
  it('renders nothing while its namespace is unavailable', () => {
    const { container } = render(<div />)
    renderBash({ available: false })

    expect(container.textContent).toBe('')
    expect(screen.queryByText(en.bashTitle)).toBeNull()
  })

  it('shows the plugin and reveals its fields only once expanded', () => {
    renderBash()
    expect(screen.getByText(en.bashTitle)).toBeTruthy()
    expect(screen.queryByLabelText(en.bashTimeoutMs)).toBeNull()

    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByLabelText(en.bashTimeoutMs)).toBeTruthy()
    expect(screen.getByLabelText(en.bashMaxOutputBytes)).toBeTruthy()
  })

  it('stages an edit instead of writing it', () => {
    const actions = renderBash()
    fireEvent.click(screen.getByText(en.bashTitle))

    fireEvent.change(screen.getByLabelText(en.bashTimeoutMs), { target: { value: '9000' } })

    expect(actions.edit).toHaveBeenCalledWith('timeoutMs', '9000')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('offers the reset for an overridden field only', () => {
    const actions = renderBash({ timeoutMs: field('9000', { overridden: true }) })
    fireEvent.click(screen.getByText(en.bashTitle))

    // One badge and one reset: the output cap is still inherited.
    expect(screen.getAllByText(en.overridden)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('timeoutMs')
  })

  it('addresses each of its two fields separately', () => {
    const actions = renderBash({ maxOutputBytes: field('64000', { overridden: true }) })
    fireEvent.click(screen.getByText(en.bashTitle))

    fireEvent.change(screen.getByLabelText(en.bashMaxOutputBytes), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.edit).toHaveBeenCalledWith('maxOutputBytes', '1024')
    expect(actions.resetField).toHaveBeenCalledWith('maxOutputBytes')
  })

  it('keeps save and discard inert until something is staged', () => {
    renderBash()
    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.discard })).toHaveProperty('disabled', true)
    expect(screen.queryByText(en.unsaved)).toBeNull()
  })

  it('writes the staged edits when saved, and drops them when discarded', () => {
    const actions = renderBash({ dirty: true, timeoutMs: field('9000', { overridden: true }) })
    fireEvent.click(screen.getByText(en.bashTitle))

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    fireEvent.click(screen.getByRole('button', { name: en.discard }))

    expect(actions.save).toHaveBeenCalledOnce()
    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('marks a card holding unsaved edits, collapsed or not', () => {
    renderBash({ dirty: true })

    expect(screen.getByText(en.unsaved)).toBeTruthy()
  })

  it('blocks the save while a draft is invalid, and says why', () => {
    renderBash({ dirty: true, invalid: true, timeoutMs: field('soon', { invalid: true }) })
    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.discard })).toHaveProperty('disabled', false)
    expect(screen.getByText(en.invalidNumber)).toBeTruthy()
  })

  it('reports a save in flight and refuses another', () => {
    renderBash({ dirty: true, saving: true })
    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.discard })).toHaveProperty('disabled', true)
  })

  it('reports a save the deployment did not accept', () => {
    renderBash({ dirty: true, failed: true })
    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByText(en.saveFailed)).toBeTruthy()
  })

  it('says the document is read-only and disables its controls', () => {
    renderBash({ writable: false })
    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.getByRole('status')).toHaveProperty('textContent', en.readOnly)
    expect(screen.getByLabelText(en.bashTimeoutMs)).toHaveProperty('disabled', true)
  })

  it('collapses again on a second click', () => {
    renderBash()
    fireEvent.click(screen.getByText(en.bashTitle))
    expect(screen.getByLabelText(en.bashTimeoutMs)).toBeTruthy()

    fireEvent.click(screen.getByText(en.bashTitle))

    expect(screen.queryByLabelText(en.bashTimeoutMs)).toBeNull()
  })
})

describe('AgentLoopCard', () => {
  it('stages and saves the only field it owns', () => {
    const store = createSnapshotStore<AgentLoopCardState>({
      ...settled,
      dirty: true,
      maxParallelToolCalls: field('10'),
    })
    const actions = cardActions()
    const props = {
      ...actions,
      t,
      useAgentLoopCard: bindSnapshotSelector(store),
    } as unknown as AgentLoopCardProps
    render(<AgentLoopCard {...props} />)

    fireEvent.click(screen.getByText(en.agentLoopTitle))
    fireEvent.change(screen.getByLabelText(en.agentLoopMaxParallel), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(actions.edit).toHaveBeenCalledWith('maxParallelToolCalls', '2')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('stages a reset for the field it owns', () => {
    const store = createSnapshotStore<AgentLoopCardState>({
      ...settled,
      maxParallelToolCalls: field('2', { overridden: true }),
    })
    const actions = cardActions()
    const props = {
      ...actions,
      t,
      useAgentLoopCard: bindSnapshotSelector(store),
    } as unknown as AgentLoopCardProps
    render(<AgentLoopCard {...props} />)

    fireEvent.click(screen.getByText(en.agentLoopTitle))
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('maxParallelToolCalls')
  })
})

describe('WebSearchCard', () => {
  function renderWebSearch(state: Partial<WebSearchCardState> = {}) {
    const store = createSnapshotStore<WebSearchCardState>({
      ...settled,
      baseURL: field(''),
      maxUses: field('5'),
      apiKey: field(''),
      apiKeyConfigured: false,
      apiKeyWritable: true,
      ...state,
    })
    const actions = cardActions()
    const props = { ...actions, t, useWebSearchCard: bindSnapshotSelector(store) } as unknown as WebSearchCardProps
    render(<WebSearchCard {...props} />)
    return actions
  }

  it('reports whether a key is configured without ever showing one', () => {
    renderWebSearch({ apiKeyConfigured: true })
    fireEvent.click(screen.getByText(en.webSearchTitle))

    expect(screen.getByText(en.webSearchApiKeySet)).toBeTruthy()
    expect(screen.getByLabelText(en.webSearchApiKey)).toHaveProperty('type', 'password')
  })

  it('keeps the key control usable while the settings document is read-only', () => {
    const actions = renderWebSearch({ writable: false })
    fireEvent.click(screen.getByText(en.webSearchTitle))

    const key = screen.getByLabelText(en.webSearchApiKey)
    expect(key).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(en.webSearchBaseUrl)).toHaveProperty('disabled', true)

    fireEvent.change(key, { target: { value: 'ds-secret' } })

    expect(actions.edit).toHaveBeenCalledWith('apiKey', 'ds-secret')
  })

  it('disables the key control when the reference itself is not writable', () => {
    // A key coming from the process environment: the settings document is
    // writable, the credential is not.
    renderWebSearch({ apiKeyConfigured: true, apiKeyWritable: false })
    fireEvent.click(screen.getByText(en.webSearchTitle))

    expect(screen.getByLabelText(en.webSearchApiKey)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.webSearchBaseUrl)).toHaveProperty('disabled', false)
  })

  it('stages the endpoint, the search budget, and their resets', () => {
    const actions = renderWebSearch({
      baseURL: field('https://search.test/v1', { overridden: true }),
      maxUses: field('3', { overridden: true }),
    })
    fireEvent.click(screen.getByText(en.webSearchTitle))

    fireEvent.change(screen.getByLabelText(en.webSearchBaseUrl), { target: { value: 'https://other.test' } })
    fireEvent.change(screen.getByLabelText(en.webSearchMaxUses), { target: { value: '4' } })
    const resets = screen.getAllByRole('button', { name: en.reset })
    expect(resets).toHaveLength(2)
    for (const reset of resets) fireEvent.click(reset)

    expect(actions.edit.mock.calls).toEqual([
      ['baseURL', 'https://other.test'],
      ['maxUses', '4'],
    ])
    expect(actions.resetField.mock.calls).toEqual([['baseURL'], ['maxUses']])
  })
})

/** A fresh set of vision-card face spies. */
function visionFace() {
  return {
    editRow: vi.fn(),
    editRowNumber: vi.fn(),
    moveRow: vi.fn(),
    moveRowTo: vi.fn(),
    removeRow: vi.fn(),
    addRow: vi.fn(),
    editAttempts: vi.fn(),
    editRowKey: vi.fn(),
    probe: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
}

describe('VisionCard', () => {
  function renderVision(
    rows: VisionCardState['rows'],
    rowNumbers: VisionCardState['rowNumbers'],
    state: Partial<VisionCardState> = {},
  ) {
    const store = createSnapshotStore<VisionCardState>({
      ...settled,
      invalid: false,
      rows,
      rowNumbers,
      rowKeys: rows.map(() => ''),
      rowConfigured: rows.map(row => (row.model ?? '').trim() !== ''),
      canAdd: true,
      attempts: '',
      probes: rows.map(() => ({ probing: false, models: [] })),
      credentials: rows.map(row => ({ ref: `VISION_${row.id.toUpperCase()}_API_KEY`, configured: false })),
      ...state,
    })
    const face = visionFace()
    const props = { ...face, t, useVisionCard: bindSnapshotSelector(store) } as unknown as VisionCardProps
    render(<VisionCard {...props} />)
    fireEvent.click(screen.getByText(en.visionTitle))
    return face
  }

  it('stages protocol and openai effort-level edits through the face', () => {
    const face = renderVision(
      [{ id: 'gpt', baseURL: 'https://gpt.test/v1', effortPreset: 'openai' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
    )

    fireEvent.change(screen.getByLabelText(en.visionProtocol), { target: { value: 'openai-responses' } })
    fireEvent.change(screen.getByLabelText(en.visionEffortPreset), { target: { value: 'mimo' } })
    fireEvent.change(screen.getByLabelText(en.visionEffortLevel), { target: { value: 'high' } })

    expect(face.editRow.mock.calls).toEqual([
      [0, 'protocol', 'openai-responses'],
      [0, 'effortPreset', 'mimo'],
      [0, 'effortLevel', 'high'],
    ])
  })

  it('stages the staged effort level the openai preset carries', () => {
    renderVision(
      [{ id: 'gpt', baseURL: 'https://gpt.test/v1', effortPreset: 'openai', effortLevel: 'low' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
    )

    expect(screen.getByLabelText(en.visionEffortLevel)).toHaveProperty('value', 'low')
  })

  it('renders sparse rows: derived key reference, missing probe and credential slots', () => {
    renderVision(
      [
        { id: 'sparse' },
        { id: 'custom', baseURL: 'https://b.test/v1', apiKeyEnv: 'MY_VISION_KEY' },
        { id: 'emptyref', baseURL: 'https://c.test/v1', apiKeyEnv: '' },
      ],
      [],
      { probes: [], credentials: [], rowKeys: [] },
    )

    // The key label names the declared reference, or the derived default.
    expect(screen.getByLabelText(/MY_VISION_KEY/)).toBeTruthy()
    expect(screen.getByLabelText(/VISION_SPARSE_API_KEY/)).toBeTruthy()
    expect(screen.getByLabelText(/VISION_EMPTYREF_API_KEY/)).toBeTruthy()
    // No probe ever ran: no picker, the model field renders its plain hint.
    expect(screen.queryByRole('combobox', { name: en.visionModel })).toBeNull()
    expect(screen.getAllByText(en.visionModelHint)).toHaveLength(3)
  })

  it('renders the probe error and the in-flight probe hint on the model field', () => {
    renderVision(
      [{ id: 'down', baseURL: 'https://down.test/v1' }, { id: 'busy', baseURL: 'https://busy.test/v1' }],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
      {
        probes: [
          { probing: false, models: [], error: 'cannot reach the endpoint' },
          { probing: true, models: [] },
        ],
      },
    )

    expect(screen.getByText('cannot reach the endpoint')).toBeTruthy()
    expect(screen.getByText(en.visionProbing)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.visionProbe })[1]).toHaveProperty('disabled', true)
  })

  it('offers the advertised models once a probe lists more than one', () => {
    renderVision(
      [{ id: 'multi', baseURL: 'https://multi.test/v1' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
      { probes: [{ probing: false, models: [{ id: 'm1' }, { id: 'm2' }] }] },
    )

    const picker = screen.getByRole('combobox', { name: en.visionModel })
    expect(picker).toHaveProperty('value', '')
    expect(screen.getByRole('option', { name: en.visionPickModel })).toBeTruthy()
  })

  it('shows the off/on toggle alone for the mimo preset', () => {
    const face = renderVision(
      [{ id: 'mimo', baseURL: 'https://mimo.test', effortPreset: 'mimo' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
    )

    expect(screen.queryByLabelText(en.visionEffortLevel)).toBeNull()
    expect(screen.queryByLabelText(en.visionThinkingBudget)).toBeNull()
    fireEvent.click(screen.getByLabelText(en.visionEffortEnabled))

    expect(face.editRow).toHaveBeenCalledWith(0, 'effortEnabled', true)
  })

  it('pairs the toggle with a budget for qwen-local, and stages context and input limits', () => {
    const face = renderVision(
      [{ id: 'local', baseURL: 'http://localhost:8000/v1', effortPreset: 'qwen-local' }],
      [{ thinkingBudget: '512', contextTokens: '32768', maxInputTokens: '' }],
    )

    expect(screen.getByLabelText(en.visionThinkingBudget)).toHaveProperty('value', '512')
    fireEvent.change(screen.getByLabelText(en.visionThinkingBudget), { target: { value: '1024' } })
    fireEvent.change(screen.getByLabelText(en.visionContextTokens), { target: { value: '131072' } })
    fireEvent.change(screen.getByLabelText(en.visionMaxInputTokens), { target: { value: '100000' } })

    expect(face.editRowNumber.mock.calls).toEqual([
      [0, 'thinkingBudget', '1024'],
      [0, 'contextTokens', '131072'],
      [0, 'maxInputTokens', '100000'],
    ])
  })

  it('pairs the toggle with a budget for the anthropic preset', () => {
    renderVision(
      [{ id: 'claude', baseURL: 'https://anthropic.test', effortPreset: 'anthropic', effortEnabled: true }],
      [{ thinkingBudget: '2048', contextTokens: '', maxInputTokens: '' }],
    )

    expect(screen.getByLabelText(en.visionEffortEnabled)).toHaveProperty('checked', true)
    expect(screen.getByLabelText(en.visionThinkingBudget)).toHaveProperty('value', '2048')
  })

  it('renders no effort control without a preset', () => {
    renderVision(
      [{ id: 'plain', baseURL: 'https://qwen.test/v1' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
    )

    expect(screen.getByLabelText(en.visionEffortPreset)).toHaveProperty('value', '')
    expect(screen.queryByLabelText(en.visionEffortLevel)).toBeNull()
    expect(screen.queryByLabelText(en.visionEffortEnabled)).toBeNull()
  })

  it('renders badges, titles, chips, and a fallback connector between rows', () => {
    renderVision(
      [
        { id: 'local', model: 'qwen3-vl-27b' },
        { id: 'claude', baseURL: 'https://api.anthropic.com', protocol: 'anthropic', enabled: false },
        { id: 'gpt', baseURL: 'https://gpt.test/v1', protocol: 'openai-responses' },
      ],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
      { attempts: '3' },
    )

    // The title leads with the model; the id tags along, or stands alone.
    expect(screen.getByText(/qwen3-vl-27b/)).toBeTruthy()
    expect(screen.getByText(/· local/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'claude' })).toBeTruthy()
    // The parked row says so.
    expect(screen.getByText(en.visionRowDisabled)).toBeTruthy()
    // One connector per adjacent pair, never after the tail.
    expect(screen.getAllByText(/next priority serves/)).toHaveLength(2)
    // Every row offers a drag handle.
    expect(screen.getAllByRole('button', { name: en.visionDragHandle })).toHaveLength(3)
  })

  it('reorders rows by drag and drop, ignoring self-drops and stray drops', () => {
    const face = renderVision(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
    )
    const handles = screen.getAllByRole('button', { name: en.visionDragHandle })
    const rows = screen.getAllByRole('group')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

    // A drop without a drag commits nothing.
    fireEvent.drop(rows[0]!)
    expect(face.moveRowTo).not.toHaveBeenCalled()

    // Drag the first row onto the third.
    fireEvent.dragStart(handles[0]!, { dataTransfer })
    fireEvent.dragOver(rows[2]!, { dataTransfer })
    fireEvent.drop(rows[2]!)
    expect(face.moveRowTo).toHaveBeenCalledWith(0, 2)
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0')
    expect(dataTransfer.effectAllowed).toBe('move')

    // A drop onto the source itself is a no-op, and dragEnd clears the markers.
    fireEvent.dragStart(handles[1]!, { dataTransfer })
    fireEvent.drop(rows[1]!)
    fireEvent.dragStart(handles[1]!, { dataTransfer })
    fireEvent.dragEnd(handles[1]!)
    fireEvent.drop(rows[0]!)
    expect(face.moveRowTo).toHaveBeenCalledTimes(1)
  })

  it('disables the drag handle when the card is read-only', () => {
    renderVision(
      [{ id: 'a' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
      { writable: false },
    )
    const handle = screen.getByRole('button', { name: en.visionDragHandle })
    expect(handle.getAttribute('draggable')).toBe('false')

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    fireEvent.dragStart(handle, { dataTransfer })
    expect(dataTransfer.setData).not.toHaveBeenCalled()
  })

  it('collapses configured rows by default and keeps unconfigured ones open', () => {
    renderVision(
      [{ id: 'saved', model: 'm1' }, { id: 'fresh' }],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
    )
    // The stored, filled row renders as its head only; the blank row stays open.
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(1)
    expect(screen.getByRole('button', { name: en.visionExpand })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.visionCollapse })).toBeTruthy()

    // An explicit toggle beats the default, and expand-all opens both.
    fireEvent.click(screen.getByRole('button', { name: en.visionExpand }))
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: en.visionCollapse })[0]!)
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.visionCollapseAll }))
    expect(screen.queryByRole('textbox', { name: en.visionBaseUrl })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.visionExpandAll }))
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(2)
  })

  it('collapses one row to its head and expands it again', () => {
    renderVision(
      [{ id: 'a' }, { id: 'b' }],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
    )
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: en.visionCollapse })[0]!)
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: en.visionExpand }))
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(2)
  })

  it('collapses and expands the whole chain from the footer control', () => {
    renderVision(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
    )

    fireEvent.click(screen.getByRole('button', { name: en.visionCollapseAll }))
    expect(screen.queryByRole('textbox', { name: en.visionBaseUrl })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.visionExpandAll }))
    expect(screen.getAllByRole('textbox', { name: en.visionBaseUrl })).toHaveLength(3)
  })

  it('hides the collapse-all control when the chain is empty', () => {
    renderVision([], [])

    expect(screen.queryByRole('button', { name: en.visionCollapseAll })).toBeNull()
    expect(screen.queryByRole('button', { name: en.visionExpandAll })).toBeNull()
  })

  it('echoes the staged key as dots and marks it staged until the save lands', () => {
    renderVision(
      [{ id: 'a' }],
      [{ thinkingBudget: '', contextTokens: '', maxInputTokens: '' }],
      { rowKeys: ['sk-staged'] },
    )

    expect(screen.getByLabelText(/VISION_A_API_KEY/)).toHaveProperty('value', 'sk-staged')
    expect(screen.getByText(en.visionApiKeyStaged)).toBeTruthy()
    expect(screen.queryByText(en.visionApiKeyUnset)).toBeNull()
  })
})

describe('VisionCard chain editing', () => {
  it('drives every row control and the card footer through the face', () => {
    const rows: VisionCardState['rows'] = [
      { id: 'first', baseURL: 'https://first.test/v1', model: 'm1', enabled: true },
      { id: 'second', baseURL: 'https://second.test/v1', model: '' },
    ]
    const store = createSnapshotStore<VisionCardState>({
      ...settled,
      invalid: false,
      dirty: true,
      rows,
      rowNumbers: [
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
        { thinkingBudget: '', contextTokens: '', maxInputTokens: '' },
      ],
      canAdd: true,
      attempts: '2',
      rowKeys: ['', ''],
      // Both rows forced expanded: this test drives body controls positionally;
      // the collapse default itself is covered by its own test.
      rowConfigured: [false, false],
      probes: [
        { probing: false, models: [{ id: 'm1' }, { id: 'm2', name: 'Second model' }] },
        { probing: false, models: [] },
      ],
      credentials: [
        { ref: 'VISION_FIRST_API_KEY', configured: true },
        { ref: 'VISION_SECOND_API_KEY', configured: false },
      ],
    })
    const face = visionFace()
    const props = { ...face, t, useVisionCard: bindSnapshotSelector(store) } as unknown as VisionCardProps
    render(<VisionCard {...props} />)
    fireEvent.click(screen.getByText(en.visionTitle))

    // Priority ordering and removal.
    fireEvent.click(screen.getAllByRole('button', { name: en.visionMoveDown })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.visionMoveUp })[1]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.visionRemove })[0]!)
    expect(face.moveRow.mock.calls).toEqual([[0, 1], [1, -1]])
    expect(face.removeRow).toHaveBeenCalledWith(0)

    // Enable toggle, endpoint, key, model text, and the probe model picker.
    fireEvent.click(screen.getAllByLabelText(en.visionEnabled)[0]!)
    fireEvent.change(screen.getAllByLabelText(en.visionBaseUrl)[0]!, { target: { value: 'https://edited.test/v1' } })
    fireEvent.change(screen.getAllByLabelText(new RegExp(en.visionApiKey))[0]!, { target: { value: 'sk-typed' } })
    fireEvent.change(screen.getAllByLabelText(en.visionModel)[0]!, { target: { value: 'typed-model' } })
    const picker = screen.getAllByRole('combobox', { name: en.visionModel })[0]!
    fireEvent.change(picker, { target: { value: 'm2' } })
    expect(face.editRow.mock.calls).toEqual([
      [0, 'enabled', false],
      [0, 'baseURL', 'https://edited.test/v1'],
      [0, 'model', 'typed-model'],
      [0, 'model', 'm2'],
    ])
    expect(face.editRowKey).toHaveBeenCalledWith(0, 'sk-typed')
    // The probed list renders the named entry.
    expect(screen.getByRole('option', { name: 'Second model (m2)' })).toBeTruthy()

    // Probe and reset controls.
    fireEvent.click(screen.getAllByRole('button', { name: en.visionProbe })[0]!)
    expect(face.probe).toHaveBeenCalledWith(0)

    // Chain-wide controls and the footer.
    fireEvent.click(screen.getByRole('button', { name: en.visionAddBackend }))
    fireEvent.change(screen.getByLabelText(en.visionAttempts), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(face.addRow).toHaveBeenCalledOnce()
    expect(face.editAttempts).toHaveBeenCalledWith('3')
    expect(face.discard).toHaveBeenCalledOnce()
    expect(face.save).toHaveBeenCalledOnce()
  })
})
