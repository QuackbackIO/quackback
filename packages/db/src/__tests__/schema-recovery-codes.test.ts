import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { ssoRecoveryCode } from '../schema/sso-recovery-code'

describe('sso_recovery_code schema', () => {
  it('has correct table name', () => {
    expect(getTableName(ssoRecoveryCode)).toBe('sso_recovery_code')
  })

  it('exposes id, user_id, code_hash, used_at, created_at', () => {
    const columns = Object.keys(getTableColumns(ssoRecoveryCode))
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'userId', 'codeHash', 'usedAt', 'createdAt'])
    )
  })

  it('codeHash and createdAt are not null; usedAt is nullable', () => {
    const cols = getTableColumns(ssoRecoveryCode)
    expect(cols.codeHash.notNull).toBe(true)
    expect(cols.createdAt.notNull).toBe(true)
    expect(cols.usedAt.notNull).toBe(false)
  })
})
