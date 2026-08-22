/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-remote-tunnels`.
 * @module @deepseek-ai/dsh-remote-tunnels/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-remote-tunnels'

/** Cordis companion plugin name. */
export const name = 'remote-tunnels-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each device's tunnel phase is owned by one lifecycle
 * controller and re-derived from its live process handle and probe outcomes on
 * every read; the package publishes no event stream or shared mutable relation
 * beyond that controller.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
