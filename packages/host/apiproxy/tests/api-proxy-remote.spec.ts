/**
 * Remote-device domain of the host ApiProxy: the roster reads through
 * `ctx.get('remoteTunnels')` when composed (empty list otherwise), the verbs
 * delegate and surface service failures as `remote-tunnel-failed`, and the
 * device view round-trips the fetch carrier's wire schemas intact.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RemoteTunnelError } from '@deepseek-ai/dsh-remote-tunnels'
import type { RemoteDeviceView } from '@deepseek-ai/dsh-remote-tunnels'
import { createApiProxy, InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

const READY: RemoteDeviceView = {
  id: 'work',
  label: 'Work machine',
  sshTarget: 'work',
  remotePort: 3080,
  localPort: 13389,
  autoConnect: true,
  tunnel: 'ready',
  url: 'http://127.0.0.1:13389/',
}

/** A scripted `remoteTunnels` service: one roster entry, verbs recorded. */
class StubTunnels extends Service {
  devices: RemoteDeviceView[] = []
  connected: string[] = []
  disconnected: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'remoteTunnels')
  }

  list(): RemoteDeviceView[] {
    return [...this.devices]
  }

  connect(id: string): Promise<RemoteDeviceView> {
    const device = this.devices.find(row => row.id === id)
    if (device === undefined) {
      throw new RemoteTunnelError(`remote device "${id}" is not configured`, 'REMOTE_UNKNOWN_DEVICE')
    }
    this.connected.push(id)
    return Promise.resolve({ ...device, tunnel: 'connecting' })
  }

  disconnect(id: string): Promise<RemoteDeviceView> {
    const device = this.devices.find(row => row.id === id)
    if (device === undefined) {
      throw new RemoteTunnelError(`remote device "${id}" is not configured`, 'REMOTE_UNKNOWN_DEVICE')
    }
    this.disconnected.push(id)
    return Promise.resolve({ ...device, tunnel: 'disconnected' })
  }
}

async function harness(withService: boolean): Promise<{ ctx: Context; stub: StubTunnels | undefined }> {
  const ctx = new Context()
  // createApiProxy eagerly wires the question provider and session listeners.
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  let stub: StubTunnels | undefined
  if (withService) {
    await ctx.plugin(StubTunnels).await()
    stub = ctx.get('remoteTunnels') as unknown as StubTunnels
    stub.devices.push(structuredClone(READY))
  }
  return { ctx, stub }
}

const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
const req = <P>(payload: P) => ({ rpcId: RpcId('t1'), payload })

describe('remote domain', () => {
  it('reads an empty roster and names the missing service when not composed', async () => {
    const { ctx } = await harness(false)
    const proxy = api(ctx)

    const listed = await proxy.remote.list(req({}))
    expect(listed.result).toEqual({ ok: true, value: { devices: [] } })

    for (const which of ['connect', 'disconnect'] as const) {
      const response = await proxy.remote[which](req({ id: 'work' }))
      expect(response.result).toMatchObject({
        ok: false,
        error: { code: 'remote-tunnel-failed', details: { id: 'work' } },
      })
      if (!response.result.ok) expect(response.result.error.message).toContain('not composed')
    }
    await ctx.fiber.dispose()
  })

  it('delegates list/connect/disconnect to the tunnel service', async () => {
    const { ctx, stub } = await harness(true)
    if (stub === undefined) throw new Error('stub missing')
    const proxy = api(ctx)

    const listed = await proxy.remote.list(req({}))
    expect(listed.result).toEqual({ ok: true, value: { devices: [READY] } })

    const connected = await proxy.remote.connect(req({ id: 'work' }))
    expect(connected.result).toMatchObject({ ok: true, value: { device: { id: 'work', tunnel: 'connecting' } } })
    expect(stub.connected).toEqual(['work'])

    const disconnected = await proxy.remote.disconnect(req({ id: 'work' }))
    expect(disconnected.result).toMatchObject({ ok: true, value: { device: { id: 'work', tunnel: 'disconnected' } } })
    expect(stub.disconnected).toEqual(['work'])
    await ctx.fiber.dispose()
  })

  it('folds a service rejection into remote-tunnel-failed with the service text', async () => {
    const { ctx } = await harness(true)
    const proxy = api(ctx)

    const response = await proxy.remote.connect(req({ id: 'ghost' }))
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'remote-tunnel-failed',
        message: 'remote device "ghost" is not configured',
        details: { id: 'ghost' },
      },
    })
    await ctx.fiber.dispose()
  })

  it('round-trips the ready view through the fetch carrier and its wire schemas', async () => {
    const { ctx } = await harness(true)
    const client = new InProcessApiClient(toFetchHandler(api(ctx)))

    const listed = await client.remote.list({})
    expect(listed.result).toEqual({ ok: true, value: { devices: [READY] } })

    const connected = await client.remote.connect({ id: 'work' })
    expect(connected.result).toMatchObject({ ok: true, value: { device: { id: 'work', tunnel: 'connecting' } } })
    const disconnected = await client.remote.disconnect({ id: 'work' })
    expect(disconnected.result).toMatchObject({ ok: true, value: { device: { id: 'work', tunnel: 'disconnected' } } })

    const bad = await client.remote.connect({ id: 'ghost' })
    expect(bad.result).toMatchObject({ ok: false, error: { code: 'remote-tunnel-failed' } })
    await ctx.fiber.dispose()
  })
})
