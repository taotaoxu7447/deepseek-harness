/**
 * The Vision card: the priority-ordered backend chain behind `view_image` and
 * pasted-image admission. Each row is one vision model — endpoint, key
 * (written through the credentials domain, never into the section), and a
 * model id the probe button fills from the endpoint's own listing; rows above
 * serve first, and one exhausting its attempt budget falls to the next.
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VisionCardFace, VisionCardState } from './vision-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './fields.module.css'

/** Props the renderer binds for the vision card. */
export type VisionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VisionCardFace>

/** What one rendered backend row needs beside the card's bound props. */
interface VisionRowView {
  t: PropsLocale<'settings.plugins'>['t']
  face: Omit<VisionCardFace, 'hooks'>
  state: VisionCardState
  index: number
}

/** Render one backend row of the staged chain. */
function visionRow({ t, face, state, index }: VisionRowView): ReactNode {
  const row = state.rows[index]
  if (row === undefined) return null
  const probe = state.probes[index]
  const credential = state.credentials[index]
  const disabled = !state.writable
  const apiKeyEnv = row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0
    ? row.apiKeyEnv
    : `VISION_${row.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_API_KEY`
  return (
    <div className={css.field} key={`vision-row-${index}`}>
      <div className={css.head}>
        <label className={css.label}>{t('visionPriority', { n: String(index + 1) })} · {row.id}</label>
        <span className={css.badges}>
          <button type="button" className={css.reset} disabled={disabled || index === 0}
            onClick={() => { face.moveRow(index, -1) }}>{t('visionMoveUp')}</button>
          <button type="button" className={css.reset} disabled={disabled || index === state.rows.length - 1}
            onClick={() => { face.moveRow(index, 1) }}>{t('visionMoveDown')}</button>
          <button type="button" className={css.reset} disabled={disabled}
            onClick={() => { face.removeRow(index) }}>{t('visionRemove')}</button>
        </span>
      </div>
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
        onReset={() => { face.editRow(index, 'enabled', true) }}
      />
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
        onReset={() => { face.editRow(index, 'baseURL', '') }}
      />
      <SecretField
        id={`vision-row-${index}-key`}
        label={`${t('visionApiKey')} (${apiKeyEnv})`}
        hint={t('visionApiKeyHint')}
        disabled={!state.writable}
        text=""
        configured={credential?.configured ?? false}
        stateLabel={credential?.configured ? t('visionApiKeySet') : t('visionApiKeyUnset')}
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
        onReset={() => { face.editRow(index, 'model', '') }}
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
  return (
    <PluginCard
      t={t}
      titleKey="visionTitle"
      descriptionKey="visionDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {state.rows.map((_row, index) => visionRow({ t, face, state, index }))}
      <div className={css.head}>
        <button type="button" className={css.reset} disabled={disabled || !state.canAdd}
          onClick={() => { props.addRow() }}>{t('visionAddBackend')}</button>
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
        onReset={() => { props.editAttempts('') }}
      />
    </PluginCard>
  )
}
