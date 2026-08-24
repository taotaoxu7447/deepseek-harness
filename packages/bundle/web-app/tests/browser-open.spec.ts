/** Default-browser startup over a real Loader tree and listening Web server. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, HEALTH_PATH, internals } from '../src/index.ts'

const contexts: Context[] = []
const tempRoots: string[] = []
const originalResolveDistIndex = internals.resolveDistIndex
const originalOpenBrowser = internals.openBrowser

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  internals.resolveDistIndex = originalResolveDistIndex
  internals.openBrowser = originalOpenBrowser
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, '__dshWebAppApply')
  Reflect.deleteProperty(globalThis, '__dshWebServer')
})

describe('web app browser startup', () => {
  it('opens the canonical URL only after the complete page is reachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-'))
    tempRoots.push(root)
    const dist = join(root, 'dist')
    mkdirSync(dist)
    const index = join(dist, 'index.html')
    writeFileSync(index, '<!doctype html><title>ready</title>')
    internals.resolveDistIndex = () => index

    const webserverModule = join(root, 'webserver.mjs')
    const webAppModule = join(root, 'web-app.mjs')
    writeFileSync(webserverModule, 'export default globalThis.__dshWebServer\n')
    writeFileSync(webAppModule, [
      "export const name = 'fixture-web-app'",
      "export const inject = ['webServer']",
      'export const apply = (ctx, config) => globalThis.__dshWebAppApply(ctx, config)',
      '',
    ].join('\n'))
    const config = join(root, 'cordis.yml')
    writeFileSync(config, [
      '- id: webserver',
      `  name: ${pathToFileURL(webserverModule).href}`,
      '  config:',
      '    host: 127.0.0.1',
      '    port: 0',
      '- id: web-app',
      `  name: ${pathToFileURL(webAppModule).href}`,
      '  config:',
      '    openBrowser: true',
      '    printUrl: false',
      '    surfaceContext: false',
      '    trustedHosts: []',
      '',
    ].join('\n'))

    const globals = globalThis as unknown as {
      __dshWebAppApply: typeof apply
      __dshWebServer: typeof WebServer
    }
    globals.__dshWebAppApply = apply
    globals.__dshWebServer = WebServer

    let openedUrl: string | undefined
    let openedStatus: number | undefined
    let resolveOpened!: () => void
    const opened = new Promise<void>((resolve) => { resolveOpened = resolve })
    internals.openBrowser = async (url) => {
      openedUrl = url
      openedStatus = (await fetch(url)).status
      resolveOpened()
    }

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(config).href },
    })
    await ctx.loader.await()
    await opened

    expect(openedUrl).toBe(`http://127.0.0.1:${String(ctx.webServer.port)}`)
    expect(openedStatus).toBe(200)

    // The supervisor health route answers over the real listener: a shell can
    // learn the process/build timestamps before offering a restart.
    const healthUrl = new URL(HEALTH_PATH, openedUrl)
    const health = await fetch(healthUrl)
    expect(health.status).toBe(200)
    const body = await health.json() as { startedAt: number; builtAt: number | null; stale: boolean }
    expect(body.startedAt).toBeGreaterThan(0)
    // The checkout may or may not carry a build record (CI coverage runs pre-build).
    expect(body.builtAt === null || Number.isFinite(body.builtAt)).toBe(true)
    expect(body.stale).toBe(body.builtAt !== null && body.builtAt > body.startedAt)
    const denied = await fetch(healthUrl, { method: 'POST' })
    expect(denied.status).toBe(405)
  })
})
