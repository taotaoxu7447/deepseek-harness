/**
 * Controller for the Local V4 cluster monitoring settings card.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  booleanField, CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Local V4 settings namespace identifier. */
export const LOCAL_V4_NS = 'local-v4'

/** Stored configuration for the local V4 settings section. */
export interface LocalV4Settings {
  enabled?: boolean
  monitorUrl?: string
  passcode?: string
  pollIntervalMs?: number
  autoCollapse?: boolean
}

/** State exposed by the Local V4 settings card. */
export interface LocalV4CardState extends CardShell {
  monitorUrl: CardFieldState
  passcode: CardFieldState
  passcodeConfigured: boolean
  pollIntervalMs: CardFieldState
  autoCollapse: CardFieldState
}

/** Injected actions and store for the Local V4 settings card. */
export interface LocalV4CardFace extends CardActions {
  hooks: {
    localV4Card: SnapshotStore<LocalV4CardState>
  }
}

/** Form controller driving the Local V4 settings card. */
export class LocalV4CardController {
  private readonly form: CardForm<LocalV4Settings>
  private readonly store: SnapshotStore<LocalV4CardState>

  /**
   * @param scope - The settings scope binding the local-v4 namespace.
   */
  constructor(private readonly scope: SettingsScope<LocalV4Settings>) {
    this.form = new CardForm(
      scope,
      [
        textField('monitorUrl'),
        numberField('pollIntervalMs'),
        booleanField('autoCollapse'),
      ],
      [{
        field: 'passcode',
        write: async (text) => {
          await scope.set('passcode', text)
          return this.passcodeConfigured()
        },
      }],
    )
    this.store = this.form.bind(() => this.projection())
  }

  private passcodeConfigured(): boolean {
    return this.scope.getSnapshot().secrets.some(secret =>
      secret.set && secret.path.length === 1 && secret.path[0] === 'passcode')
  }

  private projection(): LocalV4CardState {
    return {
      ...this.form.shell(),
      monitorUrl: this.form.field('monitorUrl'),
      passcode: this.form.field('passcode'),
      passcodeConfigured: this.passcodeConfigured(),
      pollIntervalMs: this.form.field('pollIntervalMs'),
      autoCollapse: this.form.field('autoCollapse'),
    }
  }

  /**
   * Build the face injected into the Local V4 settings card component.
   * @returns Injected face containing hooks and mutation actions.
   */
  inject(): LocalV4CardFace {
    return {
      hooks: { localV4Card: this.store },
      ...this.form.actions(),
    }
  }
}
