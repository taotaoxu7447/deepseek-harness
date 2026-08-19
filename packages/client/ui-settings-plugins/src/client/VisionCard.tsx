/**
 * The Vision card: the priority-ordered backend chain behind `view_image` and
 * pasted-image admission. Each row is one vision model — wire protocol,
 * endpoint, key (written through the credentials domain, never into the
 * section), a model id the probe button fills from the endpoint's own
 * listing, the vendor effort preset with its preset-specific control, and the
 * context/input budgets the Host validates and guards with; rows above serve
 * first, and one exhausting its attempt budget falls to the next.
 */

import type { DragEvent, ReactNode } from 'react'
import { Fragment, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, SelectField, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VisionBackendRow, VisionCardFace, VisionCardState, VisionRowNumberField } from './vision-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './fields.module.css'
import chain from './VisionCard.module.css'

/** Props the renderer binds for the vision card. */
export type VisionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VisionCardFace>

/** Transient drag markers and handlers the card passes down to each row. */
interface VisionRowDrag {
  /** Index the in-flight drag started from, if any. */
  from: number | undefined
  /** Index the pointer currently hovers over, if any. */
  over: number | undefined
  /** Begin a drag from one row's handle. */
  start: (index: number, event: DragEvent<HTMLElement>) => void
  /** Accept the in-flight drag over one row. */
  overAt: (index: number, event: DragEvent<HTMLElement>) => void
  /** Commit the drop onto one row. */
  drop: (index: number) => void
  /** Clear both markers when the drag ends anywhere. */
  end: () => void
}

/** What one rendered backend row needs beside the card's bound props. */
interface VisionRowView {
  t: PropsLocale<'settings.plugins'>['t']
  face: Omit<VisionCardFace, 'hooks'>
  state: VisionCardState
  index: number
  /** The row this view renders, yielded by the chain map. */
  row: VisionBackendRow
  /** Drag wiring shared by every row of this render. */
  drag: VisionRowDrag
  /** Whether this row renders collapsed to its head. */
  collapsed: boolean
  /** Toggle this row's collapsed state. */
  toggleCollapsed: () => void
}

/** Render one staged numeric row field (blank inherits the Host default). */
function rowNumberField(
  { t, face, state, index }: VisionRowView,
  field: VisionRowNumberField,
  label: string,
  hint: string,
): ReactNode {
  return (
    <ValueField
      id={`vision-row-${index}-${field}`}
      label={label}
      hint={hint}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t('invalidNumber')}
      disabled={!state.writable}
      numeric
      text={state.rowNumbers[index]?.[field] ?? ''}
      invalid={false}
      overridden={false}
      onEdit={(text) => { face.editRowNumber(index, field, text) }}
    />
  )
}

/** Render the effort control the row's preset selects, if any. */
function effortControl(view: VisionRowView): ReactNode {
  const { t, face, index, row } = view
  const disabled = !view.state.writable
  if (row.effortPreset === undefined) return null
  if (row.effortPreset === 'openai') {
    return (
      <SelectField
        id={`vision-row-${index}-effort-level`}
        label={t('visionEffortLevel')}
        hint={t('visionEffortLevelHint')}
        disabled={disabled}
        value={row.effortLevel ?? ''}
        placeholder={t('visionEffortLevelUnset')}
        options={[
          { value: 'none', label: t('visionEffortNone') },
          { value: 'minimal', label: t('visionEffortMinimal') },
          { value: 'low', label: t('visionEffortLow') },
          { value: 'medium', label: t('visionEffortMedium') },
          { value: 'high', label: t('visionEffortHigh') },
        ]}
        onEdit={(value) => { face.editRow(index, 'effortLevel', value) }}
      />
    )
  }
  const toggle = (
    <ToggleField
      id={`vision-row-${index}-effort-enabled`}
      label={t('visionEffortEnabled')}
      hint={row.effortPreset === 'mimo' ? t('visionEffortEnabledMimoHint') : t('visionEffortEnabledHint')}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      disabled={disabled}
      checked={row.effortEnabled === true}
      overridden={false}
      onEdit={(text) => { face.editRow(index, 'effortEnabled', text === 'on') }}
    />
  )
  if (row.effortPreset === 'mimo') return toggle
  return (
    <>
      {toggle}
      {rowNumberField(view, 'thinkingBudget', t('visionThinkingBudget'), t('visionThinkingBudgetHint'))}
    </>
  )
}

/** Render one backend row of the staged chain. */
function visionRow(view: VisionRowView): ReactNode {
  const { t, face, state, index, row, drag } = view
  const probe = state.probes[index]
  const credential = state.credentials[index]
  const disabled = !state.writable
  const apiKeyEnv = row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0
    ? row.apiKeyEnv
    : `VISION_${row.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_API_KEY`
  const keyDraft = state.rowKeys[index] ?? ''
  const chip = row.protocol === 'openai-responses'
    ? t('visionProtocolResponses')
    : row.protocol === 'anthropic' ? t('visionProtocolAnthropic') : t('visionProtocolChat')
  return (
    <div
      className={`${chain.row}${drag.over === index ? ` ${chain.rowDragOver}` : ''}${row.enabled === false ? ` ${chain.rowDisabled}` : ''}`}
      role="group"
      aria-label={row.id}
      onDragOver={(event) => { drag.overAt(index, event) }}
      onDrop={() => { drag.drop(index) }}
    >
      <div className={chain.rowHead}>
        <button
          type="button"
          className={chain.handle}
          aria-label={view.collapsed ? t('visionExpand') : t('visionCollapse')}
          title={view.collapsed ? t('visionExpand') : t('visionCollapse')}
          onClick={() => { view.toggleCollapsed() }}
        >{view.collapsed ? '▸' : '▾'}</button>
        <span
          className={chain.handle}
          role="button"
          aria-label={t('visionDragHandle')}
          title={t('visionDragHandle')}
          draggable={!disabled}
          onDragStart={(event) => { drag.start(index, event) }}
          onDragEnd={() => { drag.end() }}
        >⋮⋮</span>
        <span className={chain.badge}>{index + 1}</span>
        <span className={chain.title}>
          {row.model ?? row.id}
          {row.model !== undefined ? <span className={chain.titleId}> · {row.id}</span> : null}
        </span>
        <span className={chain.chip}>{chip}</span>
        {row.enabled === false ? <span className={chain.chipMuted}>{t('visionRowDisabled')}</span> : null}
        <span className={css.badges}>
          <button type="button" className={css.reset} disabled={disabled || index === 0}
            onClick={() => { face.moveRow(index, -1) }}>{t('visionMoveUp')}</button>
          <button type="button" className={css.reset} disabled={disabled || index === state.rows.length - 1}
            onClick={() => { face.moveRow(index, 1) }}>{t('visionMoveDown')}</button>
          <button type="button" className={css.reset} disabled={disabled}
            onClick={() => { face.removeRow(index) }}>{t('visionRemove')}</button>
        </span>
      </div>
      <div className={chain.rowBody} hidden={view.collapsed}>
        <ToggleField
          id={`vision-row-${index}-enabled`}
          label={t('visionEnabled')}
          hint={t('visionEnabledHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          disabled={disabled}
          checked={row.enabled !== false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'enabled', text === 'on') }}
        />
        <SelectField
          id={`vision-row-${index}-protocol`}
          label={t('visionProtocol')}
          hint={t('visionProtocolHint')}
          disabled={disabled}
          value={row.protocol ?? ''}
          placeholder={t('visionProtocolDefault')}
          options={[
            { value: 'openai-chat', label: t('visionProtocolChat') },
            { value: 'openai-responses', label: t('visionProtocolResponses') },
            { value: 'anthropic', label: t('visionProtocolAnthropic') },
          ]}
          onEdit={(value) => { face.editRow(index, 'protocol', value) }}
        />
        <SelectField
          id={`vision-row-${index}-effort-preset`}
          label={t('visionEffortPreset')}
          hint={t('visionEffortPresetHint')}
          disabled={disabled}
          value={row.effortPreset ?? ''}
          placeholder={t('visionEffortPresetUnset')}
          options={[
            { value: 'openai', label: t('visionEffortPresetOpenai') },
            { value: 'mimo', label: t('visionEffortPresetMimo') },
            { value: 'qwen-local', label: t('visionEffortPresetQwenLocal') },
            { value: 'anthropic', label: t('visionEffortPresetAnthropic') },
          ]}
          onEdit={(value) => { face.editRow(index, 'effortPreset', value) }}
        />
        {effortControl(view)}
        <ValueField
          id={`vision-row-${index}-endpoint`}
          label={t('visionBaseUrl')}
          hint={t('visionBaseUrlHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          text={row.baseURL ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'baseURL', text) }}
        />
        <SecretField
          id={`vision-row-${index}-key`}
          label={`${t('visionApiKey')} (${apiKeyEnv})`}
          hint={t('visionApiKeyHint')}
          disabled={!state.writable}
          text={keyDraft}
          configured={keyDraft !== '' || (credential?.configured ?? false)}
          stateLabel={keyDraft !== '' ? t('visionApiKeyStaged') : credential?.configured ? t('visionApiKeySet') : t('visionApiKeyUnset')}
          onEdit={(text) => { face.editRowKey(index, text) }}
        />
        <ValueField
          id={`vision-row-${index}-model`}
          label={t('visionModel')}
          hint={probe?.error !== undefined ? probe.error : probe?.probing === true ? t('visionProbing') : t('visionModelHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          text={row.model ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'model', text) }}
        />
        <div className={css.head}>
          <button type="button" className={css.reset} disabled={disabled || probe?.probing === true}
            onClick={() => { face.probe(index) }}>{t('visionProbe')}</button>
          {(probe?.models.length ?? 0) > 1
            ? (
              <select
                className={css.input}
                aria-label={t('visionModel')}
                value={row.model ?? ''}
                disabled={disabled}
                onChange={(event) => { face.editRow(index, 'model', event.target.value) }}
              >
                <option value="">{t('visionPickModel')}</option>
                {probe?.models.map(model => (
                  <option key={model.id} value={model.id}>{model.name !== undefined ? `${model.name} (${model.id})` : model.id}</option>
                ))}
              </select>
            )
            : null}
        </div>
        {rowNumberField(view, 'contextTokens', t('visionContextTokens'), t('visionContextTokensHint'))}
        {rowNumberField(view, 'maxInputTokens', t('visionMaxInputTokens'), t('visionMaxInputTokensHint'))}
      </div>
    </div>
  )
}

/**
 * Render the vision chain card.
 * @param props - locale copy, the card snapshot, and its editor actions.
 * @returns the card.
 */
export function VisionCard(props: VisionCardProps) {
  const { t } = props
  const state = props.useVisionCard(snapshot => snapshot)
  const face: Omit<VisionCardFace, 'hooks'> = props
  const disabled = !state.writable
  const [dragFrom, setDragFrom] = useState<number | undefined>(undefined)
  const [dragOver, setDragOver] = useState<number | undefined>(undefined)
  // Collapse state = this override map over the controller's default: rows that
  // arrived from the stored section already configured start collapsed, rows
  // added this session start expanded. Overrides key on the row id so a drag
  // reorder keeps each row's state.
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const rowCollapsed = (index: number, id: string): boolean =>
    collapseOverrides.get(id) ?? state.rowConfigured[index] ?? false
  const drag: VisionRowDrag = {
    from: dragFrom,
    over: dragOver,
    start: (index, event) => {
      if (disabled) return
      event.dataTransfer.setData('text/plain', String(index))
      event.dataTransfer.effectAllowed = 'move'
      setDragFrom(index)
    },
    overAt: (index, event) => {
      event.preventDefault()
      setDragOver(index)
    },
    drop: (index) => {
      if (dragFrom !== undefined && dragFrom !== index) face.moveRowTo(dragFrom, index)
      setDragFrom(undefined)
      setDragOver(undefined)
    },
    end: () => {
      setDragFrom(undefined)
      setDragOver(undefined)
    },
  }
  const attempts = state.attempts.trim() === '' ? '2' : state.attempts.trim()
  const allCollapsed = state.rows.length > 0 && state.rows.every((row, index) => rowCollapsed(index, row.id))
  const toggleOne = (index: number, id: string) => {
    setCollapseOverrides(prev => new Map(prev).set(id, !rowCollapsed(index, id)))
  }
  const setAllCollapsed = (value: boolean) => {
    setCollapseOverrides(new Map(state.rows.map(row => [row.id, value])))
  }
  return (
    <PluginCard
      t={t}
      titleKey="visionTitle"
      descriptionKey="visionDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={chain.chain}>
        {state.rows.map((row, index) => (
          <Fragment key={row.id}>
            {visionRow({
              t,
              face,
              state,
              index,
              row,
              drag,
              collapsed: rowCollapsed(index, row.id),
              toggleCollapsed: () => { toggleOne(index, row.id) },
            })}
            {index < state.rows.length - 1
              ? (
                <div className={chain.connector}>
                  <span className={chain.connectorArrow}>▼</span>
                  {t('visionChainFallback', { n: attempts })}
                </div>
              )
              : null}
          </Fragment>
        ))}
      </div>
      <div className={css.head}>
        <button type="button" className={css.reset} disabled={disabled || !state.canAdd}
          onClick={() => { props.addRow() }}>{t('visionAddBackend')}</button>
        {state.rows.length > 0
          ? (
            <button type="button" className={css.reset}
              onClick={() => { setAllCollapsed(!allCollapsed) }}
            >{allCollapsed ? t('visionExpandAll') : t('visionCollapseAll')}</button>
          )
          : null}
      </div>
      <ValueField
        id="vision-attempts"
        label={t('visionAttempts')}
        hint={t('visionAttemptsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        numeric
        text={state.attempts}
        invalid={false}
        overridden={false}
        onEdit={(text) => { props.editAttempts(text) }}
      />
    </PluginCard>
  )
}
