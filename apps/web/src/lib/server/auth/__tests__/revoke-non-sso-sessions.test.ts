/**
 * revokeNonSsoTeamSessions — invoked on enable of ssoOidc.required.
 *
 * Deletes session rows for any admin/member who hasn't authenticated
 * via SSO (no account row with provider_id='sso'). Returns the count
 * deleted. Pure SQL — no audit emission inside the helper (caller
 * decides whether to record session.revoked.bulk).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  executeFn: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    execute: (...a: unknown[]) => hoisted.executeFn(...a),
  },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings,
    values,
  }),
}))

const { revokeNonSsoTeamSessions } = await import('../revoke-non-sso-sessions')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('revokeNonSsoTeamSessions', () => {
  it('returns the affected-row count from the DELETE query', async () => {
    // postgres-js's drizzle driver exposes the count as `.count` on the
    // result array — NOT a `{ rowCount }` wrapper like node-postgres.
    hoisted.executeFn.mockResolvedValue(Object.assign([], { count: 7 }))

    const result = await revokeNonSsoTeamSessions()

    expect(result).toBe(7)
    expect(hoisted.executeFn).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when no non-SSO team sessions exist', async () => {
    hoisted.executeFn.mockResolvedValue(Object.assign([], { count: 0 }))

    expect(await revokeNonSsoTeamSessions()).toBe(0)
  })

  it('falls back to 0 when count is missing', async () => {
    hoisted.executeFn.mockResolvedValue([])
    expect(await revokeNonSsoTeamSessions()).toBe(0)
  })
})
