/**
 * Which principal the REST settings endpoints act as for each kind of key.
 *
 * A personal key acts as its creator. A workspace key belongs to nobody, so it
 * acts as its own principal: its creator leaving must not lock it out of the
 * settings areas its role allows, and audit rows must name the key.
 */
import { describe, it, expect, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'

vi.mock('@/lib/server/domains/api/auth', () => ({ assertApiPermissions: vi.fn() }))

import { settingsCallerFromApiAuth } from '../http'

const KEY_PRINCIPAL = 'principal_key' as PrincipalId
const CREATOR = 'principal_creator' as PrincipalId

function auth(kind: 'personal' | 'workspace'): ApiAuthContext {
  return {
    apiKey: { kind, createdById: CREATOR },
    principalId: KEY_PRINCIPAL,
    role: 'member',
    permissions: new Set(),
    principal: null,
    importMode: false,
  } as unknown as ApiAuthContext
}

describe('settingsCallerFromApiAuth', () => {
  it('acts as the creator for a personal key', () => {
    expect(settingsCallerFromApiAuth(auth('personal')).actor).toMatchObject({
      principalId: CREATOR,
      principalType: 'user',
    })
  })

  it('acts as the key itself for a workspace key', () => {
    expect(settingsCallerFromApiAuth(auth('workspace')).actor).toMatchObject({
      principalId: KEY_PRINCIPAL,
      principalType: 'service',
    })
  })
})
