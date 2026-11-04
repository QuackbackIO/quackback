/**
 * Where a new sending domain's return path CNAME points, when the operator
 * serves bounce records under a domain of its own.
 */
import { describe, expect, it } from 'vitest'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import { returnPathLabel, returnPathTarget } from '../return-path'

function scopeFor(workspaceKey: string) {
  return createWorkspaceScope({
    workspace: {
      workspaceKey,
      revision: 1,
      routing: { primaryHostname: 'ws.example.com', hostnames: [], baseUrl: 'https://ws.example.com' },
      email: { from: null, mailSlug: 'acme' },
    },
    db: {},
    sql: {},
    origin: 'test',
    secrets: { secretKey: 'b'.repeat(64), storage: null, storageProblem: 'not read here' },
  } as never)
}

describe('returnPathLabel', () => {
  it('is a DNS label derived from the workspace key alone, stable across releases', () => {
    expect(returnPathLabel('inst_example1')).toBe('ws-8fc0ff855f96e8aa09b38e87')
    expect(returnPathLabel('inst_example1')).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  })

  it('differs per workspace', () => {
    expect(returnPathLabel('inst_example1')).not.toBe(returnPathLabel('inst_example2'))
  })
})

describe('returnPathTarget', () => {
  const ON = { EMAIL_RETURN_PATH_DOMAIN: 'bounces.example.net' }

  it('is null when the operator serves no return path domain', () => {
    expect(runWithWorkspaceScope(scopeFor('inst_example1'), () => returnPathTarget({}))).toBeNull()
    expect(returnPathTarget({})).toBeNull()
  })

  it('names the scoped workspace under the operator domain, never its mail slug', () => {
    expect(runWithWorkspaceScope(scopeFor('inst_example1'), () => returnPathTarget(ON))).toBe(
      'ws-8fc0ff855f96e8aa09b38e87.bounces.example.net'
    )
  })

  it('uses the instance id, then the single workspace, outside a scope', () => {
    expect(returnPathTarget({ ...ON, QUACKBACK_INSTANCE_ID: 'inst_example1' })).toBe(
      'ws-8fc0ff855f96e8aa09b38e87.bounces.example.net'
    )
    expect(returnPathTarget(ON)).toBe(`${returnPathLabel('__single__')}.bounces.example.net`)
  })

  it('is null on a pooled process with no workspace scope', () => {
    expect(returnPathTarget({ ...ON, QUACKBACK_TENANCY: 'pooled' })).toBeNull()
  })
})
