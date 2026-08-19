import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import {
  operations,
  mockTransaction,
  opsFor,
  resetDbMockState,
} from '@/lib/server/__tests__/principal-merge-db-mock'

// Pure-orchestration pins that a rolled-back real-DB run cannot observe:
// transaction wrapping, teardown ordering masked by CASCADE, and option
// branches. Row movement, SQL validity, and constraint semantics live in
// merge-anonymous.db.test.ts (real DB); per-step registry behavior lives in
// principals/__tests__/principal-repoint.test.ts.
vi.mock('@/lib/server/db', async () =>
  (await import('@/lib/server/__tests__/principal-merge-db-mock')).mockDbModule()
)

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { mergeAnonymousToIdentified, absorbSignupIntoAnonymous } from '../merge-anonymous'

const ANON_PRINCIPAL_ID = createId('principal')
const TARGET_PRINCIPAL_ID = createId('principal')
const ANON_USER_ID = 'user_anon' as UserId

beforeEach(() => {
  resetDbMockState()
})

describe('mergeAnonymousToIdentified', () => {
  const defaultParams = {
    anonPrincipalId: ANON_PRINCIPAL_ID,
    targetPrincipalId: TARGET_PRINCIPAL_ID,
    anonUserId: ANON_USER_ID,
    anonDisplayName: 'Curious Penguin',
    targetDisplayName: 'Jane Doe',
  }

  it('runs the merge inside a single database transaction', async () => {
    await mergeAnonymousToIdentified(defaultParams)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('passes display names through so the notification title fixup runs', async () => {
    await mergeAnonymousToIdentified(defaultParams)

    // Three ops = self-notification delete, title rewrite, re-point. The
    // rewrite only runs when the orchestrator forwards displayNames; the
    // registry-level branches are pinned in principal-repoint.test.ts.
    expect(opsFor('in_app_notifications')).toEqual([
      'delete:in_app_notifications',
      'update:in_app_notifications',
      'update:in_app_notifications',
    ])
  })

  it('deletes principal before sessions and user', async () => {
    // Not observable on a real DB: deleting the user first would CASCADE the
    // principal away and leave the same end state, so the ordering (principal
    // references userId) is pinned here on the ops log.
    await mergeAnonymousToIdentified(defaultParams)

    const principalIdx = operations.indexOf('delete:principal')
    const sessionIdx = operations.indexOf('delete:session')
    const userIdx = operations.indexOf('delete:user')

    expect(principalIdx).toBeLessThan(sessionIdx)
    expect(principalIdx).toBeLessThan(userIdx)
  })
})

describe('absorbSignupIntoAnonymous', () => {
  const NEW_USER_ID = 'user_new' as UserId
  const NEW_PRINCIPAL_ID = createId('principal')

  const defaultParams = {
    anonUserId: ANON_USER_ID,
    anonPrincipalId: ANON_PRINCIPAL_ID,
    newUserId: NEW_USER_ID,
    newUserPrincipalId: NEW_PRINCIPAL_ID,
    name: 'Jane Doe',
    email: 'jane@example.com',
    image: null,
    displayName: 'Jane Doe',
  }

  it('runs inside a single transaction', async () => {
    await absorbSignupIntoAnonymous(defaultParams)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('skips the registry when the new user never got a principal', async () => {
    await absorbSignupIntoAnonymous({ ...defaultParams, newUserPrincipalId: null })

    expect(operations).not.toContain('update:post_votes')
    expect(operations).not.toContain('delete:principal')
    expect(operations).toContain('delete:user')
  })
})
