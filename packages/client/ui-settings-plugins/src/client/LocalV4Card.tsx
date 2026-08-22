/**
 * Settings card for Local DeepSeek V4 Flash cluster monitoring.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { LocalV4CardFace } from './local-v4-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props for the Local V4 settings card component. */
export type LocalV4CardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<LocalV4CardFace>

/**
 * Render the Local V4 settings card.
 * @param props - Component props and injected form actions.
 * @returns Rendered card.
 */
export function LocalV4Card(props: LocalV4CardProps) {
  const { t } = props
  const state = props.useLocalV4Card(snapshot => snapshot)
  const disabled = !state.writable

  return (
    <PluginCard
      t={t}
      titleKey="localV4Title"
      descriptionKey="localV4Description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-local-v4-monitor-url"
        label={t('localV4MonitorUrl')}
        hint={t('localV4MonitorUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.monitorUrl}
        onEdit={(text) => { props.edit('monitorUrl', text) }}
        onReset={() => { props.resetField('monitorUrl') }}
      />
      <SecretField
        id="plugin-config-local-v4-passcode"
        label={t('localV4Passcode')}
        hint={t('localV4PasscodeHint')}
        disabled={disabled}
        text={state.passcode.text}
        configured={state.passcodeConfigured}
        stateLabel={state.passcodeConfigured ? t('localV4PasscodeSet') : t('localV4PasscodeUnset')}
        onEdit={(text) => { props.edit('passcode', text) }}
      />
      <ValueField
        id="plugin-config-local-v4-poll-interval"
        label={t('localV4PollInterval')}
        hint={t('localV4PollIntervalHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.pollIntervalMs}
        onEdit={(text) => { props.edit('pollIntervalMs', text) }}
        onReset={() => { props.resetField('pollIntervalMs') }}
      />
      <ToggleField
        id="plugin-config-local-v4-auto-collapse"
        label={t('localV4AutoCollapse')}
        hint={t('localV4AutoCollapseHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        checked={state.autoCollapse.text === 'on'}
        overridden={state.autoCollapse.overridden}
        onEdit={(text) => { props.edit('autoCollapse', text) }}
        onReset={() => { props.resetField('autoCollapse') }}
      />
    </PluginCard>
  )
}

export default LocalV4Card
