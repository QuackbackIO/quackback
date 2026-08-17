import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceScope } from '@/lib/server/workspaces/workspace-context'
import { originsForWorkspaceHostnames } from '../trusted-origins'

function scopeFor(workspaceKey: string, primary: string, hostnames: string[]) {
  return createWorkspaceScope({
    workspace: {
      workspaceKey,
      revision: 1,
      routing: { primaryHostname: primary, hostnames, baseUrl: `https://${primary}` },
    },
    db: {},
    sql: {},
    origin: 'test',
    secrets: { secretKey: 'b'.repeat(64), storage: null, storageProblem: 'not read here' },
  } as never)
}

describe('originsForWorkspaceHostnames', () => {
  it('includes the pinned origin and every registered hostname', () => {
    expect(
      originsForWorkspaceHostnames('https://ws-abc.saas.example', [
        'ws-abc.saas.example',
        'hello.saas.example',
        'shop.customer.test',
      ])
    ).toEqual([
      'https://ws-abc.saas.example',
      'https://hello.saas.example',
      'https://shop.customer.test',
    ])
  })

  it('skips empty and wildcard hostnames', () => {
    expect(
      originsForWorkspaceHostnames('https://ws-abc.saas.example', [
        '',
        '*.saas.example',
        'ok.saas.example',
      ])
    ).toEqual(['https://ws-abc.saas.example', 'https://ok.saas.example'])
  })
})

describe('workspaceAuthTrustedOrigins', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('BASE_URL', 'https://fleet.example.com')
    vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
    vi.stubEnv('TRUSTED_ORIGINS', 'https://attacker.example')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lists every hostname on the live workspace and ignores fleet TRUSTED_ORIGINS', async () => {
    const { runWithWorkspaceScope } = await import('@/lib/server/workspaces/workspace-context')
    const { workspaceAuthTrustedOrigins } = await import('../trusted-origins')
    const origins = runWithWorkspaceScope(
      scopeFor('inst_t1', 'ws-abc.saas.example', [
        'ws-abc.saas.example',
        'hello.saas.example',
        'shop.customer.test',
      ]),
      () => workspaceAuthTrustedOrigins()
    )
    expect(origins).toEqual([
      'https://ws-abc.saas.example',
      'https://hello.saas.example',
      'https://shop.customer.test',
    ])
    expect(origins).not.toContain('https://attacker.example')
  })

  it('sees a custom host added after the first read without rebuilding modules', async () => {
    const { runWithWorkspaceScope } = await import('@/lib/server/workspaces/workspace-context')
    const { workspaceAuthTrustedOrigins } = await import('../trusted-origins')
    const first = runWithWorkspaceScope(
      scopeFor('inst_t1', 'ws-abc.saas.example', ['ws-abc.saas.example']),
      () => workspaceAuthTrustedOrigins()
    )
    const second = runWithWorkspaceScope(
      scopeFor('inst_t1', 'shop.customer.test', ['ws-abc.saas.example', 'shop.customer.test']),
      () => workspaceAuthTrustedOrigins()
    )
    expect(first).toEqual(['https://ws-abc.saas.example'])
    expect(second).toContain('https://shop.customer.test')
  })

  it('uses process TRUSTED_ORIGINS only outside a workspace scope', async () => {
    const { workspaceAuthTrustedOrigins } = await import('../trusted-origins')
    expect(workspaceAuthTrustedOrigins()).toContain('https://attacker.example')
  })
})
