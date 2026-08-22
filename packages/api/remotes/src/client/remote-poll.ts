/**
 * Shared helpers for browser consumers of the `remote` RPC domain: the staged
 * port-draft parse every remote editor needs, and the self-overlap fold every
 * `remote.list` poller needs. Both the settings card and the sidebar entry
 * poll the same read-only list on their own cadence; these two pieces are the
 * parts that must not drift apart.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'

/** Wire face carrying the remote domain. */
export type RemoteApi = Pick<IApiClient, 'remote'>

/**
 * One roster device as the remote domain's list answer carries it. Derived
 * from the wire face: the Host-side schema type must not be imported here.
 */
export type ListedRemoteDevice =
  Extract<Awaited<ReturnType<RemoteApi['remote']['list']>>['result'], { ok: true }>['value']['devices'][number]

/**
 * Project the tunnel-lifecycle fields of one roster device: the phase plus
 * the failure detail and the tunneled address, which exist only in their
 * phases. Absent fields are omitted, never set to `undefined`.
 * @param device - the wire view the remote domain answered.
 * @returns the tunnel slice every roster poller renders.
 */
export function remoteTunnelFields(device: ListedRemoteDevice): {
  tunnel: ListedRemoteDevice['tunnel']
  detail?: string
  url?: string
} {
  return {
    tunnel: device.tunnel,
    ...device.detail === undefined ? {} : { detail: device.detail },
    ...device.url === undefined ? {} : { url: device.url },
  }
}

/**
 * Parse one staged port draft.
 * @param draft - the staged text.
 * @returns the port, or `undefined` for a blank draft.
 * @throws Error on a non-blank draft outside 1–65535.
 */
export function parseRemotePort(draft: string): number | undefined {
  const trimmed = draft.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`not a port: ${trimmed}`)
  }
  return parsed
}

/**
 * Fold a poll loop's self-overlap: a second request while one crosses the
 * wire queues exactly one follow-up run instead of stacking.
 * @param run - one poll iteration.
 * @returns the guarded trigger to call for every poll request.
 */
export function createPollFold(run: () => Promise<void>): () => Promise<void> {
  let inFlight = false
  let queued = false
  const go = async (): Promise<void> => {
    if (inFlight) {
      queued = true
      return
    }
    inFlight = true
    try {
      await run()
    } finally {
      inFlight = false
      if (queued) {
        queued = false
        await go()
      }
    }
  }
  return go
}

/**
 * Read the live roster from the Host.
 * @param api - wire face carrying the remote domain.
 * @returns the device views on a successful answer, else `undefined`.
 */
export async function listRemoteDevices(api: RemoteApi): Promise<ListedRemoteDevice[] | undefined> {
  const response = await api.remote.list({}).catch(() => undefined)
  const result = response?.result
  return result !== undefined && result.ok ? result.value.devices : undefined
}
