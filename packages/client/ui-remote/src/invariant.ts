/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-remote`.
 * @module @deepseek-ai/dsh-client-ui-remote/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-remote'

/** Cordis companion plugin name. */
export const name = 'client-ui-remote-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package projects the `remote` RPC domain's
 * device list onto one sidebar footer entry and its modal, and forwards open
 * gestures to ctx.layout and window.open. It emits no cordis events, owns no
 * cross-plugin mutable state, and its single slot registration proves
 * disposal through the HMR-safety spec.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
