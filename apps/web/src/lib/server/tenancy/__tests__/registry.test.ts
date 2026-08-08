/**
 * Reading a registry row, and refusing to read one that does not hold up.
 *
 * `interpretRow` is the only place a control-database row becomes something the
 * fleet will serve, so every refusal here is load-bearing. The rule the suite
 * enforces throughout: a refusal must carry **no connection material at all**.
 * Not a redacted DSN, not a partially-filled record — nothing. That is the
 * fail-closed property expressed as a type, and a test that only checked
 * `kind !== 'ok'` would not notice it eroding.
 */
import { describe, expect, it } from 'vitest'
import { interpretRow, normalizeHostHeader } from '../registry'

const ROW: {
  tenant_id: string
  contract_version: number
  state: string
  state_reason: string | null
  primary_hostname: string
  base_url: string
  db_pooled_url: string
  db_direct_url: string
  db_name: string
  db_role: string
  db_credential_ref: string
  app_secrets_ref: string
  workspace_id: string
  fingerprint_stamped_at: Date | string
  storage: unknown
  email_from: string
  ai_enabled: boolean
  revision: string | number
  neon_project_id: string | null
  neon_branch_id: string | null
  hostnames: string[]
} = {
  tenant_id: 'inst_gauntlet_neon_t1',
  contract_version: 1,
  state: 'active',
  state_reason: null,
  primary_hostname: 'neon-t1.quackback.co.uk',
  base_url: 'https://neon-t1.quackback.co.uk',
  db_pooled_url:
    'postgresql://qb_neon_t1@ep-tiny-poetry-auqd4saj-pooler.c-10.us-east-1.aws.neon.tech/qb_neon_t1?sslmode=require',
  db_direct_url:
    'postgresql://qb_neon_t1@ep-tiny-poetry-auqd4saj.c-10.us-east-1.aws.neon.tech/qb_neon_t1?sslmode=require',
  db_name: 'qb_neon_t1',
  db_role: 'qb_neon_t1',
  db_credential_ref: 'neon+role://tiny-credit-36813255/br-weathered-lake-aupi87in/qb_neon_t1',
  app_secrets_ref: 'openbao+kv://apps/neon-t1',
  workspace_id: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
  fingerprint_stamped_at: '2026-08-08T14:32:43.928Z',
  storage: {
    provider: 'r2',
    bucket: 'qb-neon-t1',
    endpoint: 'https://gauntlet-account.r2.cloudflarestorage.com',
    region: 'auto',
    forcePathStyle: false,
    publicUrl: 'https://neon-t1.quackback.co.uk/api/storage',
    credentialRef: 'openbao+kv://apps/neon-t1',
  },
  email_from: 'Quackback Cloud <noreply@notifications.quackback.io>',
  ai_enabled: false,
  revision: 2,
  neon_project_id: 'tiny-credit-36813255',
  neon_branch_id: 'br-weathered-lake-aupi87in',
  hostnames: ['neon-t1.quackback.co.uk', 't1.localhost'],
}

type Row = typeof ROW

function row(over: Partial<Row> = {}): Row {
  return { ...ROW, ...over }
}

/** No refusal variant may carry anything a caller could connect with. */
function assertCarriesNoDsn(value: unknown): void {
  const serialised = JSON.stringify(value)
  expect(serialised).not.toContain('postgres')
  expect(serialised).not.toContain('neon+role')
  expect(serialised).not.toContain('aws.neon.tech')
}

describe('interpretRow', () => {
  it('accepts a complete, active record and attaches the physical placement', () => {
    const result = interpretRow(row(), 't1.localhost')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.tenant.tenantId).toBe('inst_gauntlet_neon_t1')
    expect(result.tenant.database.pooledUrl).toContain('-pooler.')
    // The branch id is not part of contract v1's TenantRecord, so it has to be
    // carried alongside — and without it the branch check has nothing to compare.
    expect(result.tenant.physical).toEqual({
      neonProjectId: 'tiny-credit-36813255',
      neonBranchId: 'br-weathered-lake-aupi87in',
    })
  })

  it('reports a suspended tenant with its reason and no DSN', () => {
    const result = interpretRow(
      row({ state: 'suspended', state_reason: 'nonpayment' }),
      't1.localhost'
    )
    expect(result).toMatchObject({ kind: 'suspended', reason: 'nonpayment' })
    assertCarriesNoDsn(result)
  })

  it('reports a deleting tenant with no DSN', () => {
    const result = interpretRow(row({ state: 'deleting' }), 't1.localhost')
    expect(result.kind).toBe('deleting')
    assertCarriesNoDsn(result)
  })

  it('gates on state BEFORE validating, so a suspended stale record still reads as suspended', () => {
    // Otherwise suspending a tenant whose record has some unrelated defect
    // reads to the operator as corruption rather than as the thing they did.
    const result = interpretRow(
      row({ state: 'suspended', state_reason: 'nonpayment', base_url: 'not-a-url' }),
      't1.localhost'
    )
    expect(result.kind).toBe('suspended')
  })

  it('refuses a contract version it does not implement', () => {
    const result = interpretRow(row({ contract_version: 99 }), 't1.localhost')
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.problems.join(' ')).toContain('99')
    assertCarriesNoDsn(result)
  })

  it('refuses a base URL that does not match the primary hostname', () => {
    // The `https://*.quackback.io` trap: once a wildcard domain is attached to
    // the fleet, the platform's own public domain is that literal string, and a
    // baseUrl derived from it would poison cookies, email links and every
    // absolute asset URL.
    const result = interpretRow(row({ base_url: 'https://someone-else.example.com' }), 't1.localhost')
    expect(result.kind).toBe('invalid')
  })

  it('refuses a direct endpoint that is really a pooler', () => {
    // LISTEN registration is lost through a transaction pooler in proportion to
    // contention, so this fails silently under load rather than at deploy.
    const result = interpretRow(
      row({
        db_direct_url:
          'postgresql://qb_neon_t1@ep-tiny-poetry-auqd4saj-pooler.c-10.us-east-1.aws.neon.tech/qb_neon_t1',
      }),
      't1.localhost'
    )
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.problems.join(' ')).toMatch(/pooler/)
  })

  it('refuses a DSN carrying a password', () => {
    const result = interpretRow(
      row({
        db_pooled_url:
          'postgresql://qb_neon_t1:hunter2@ep-tiny-poetry-auqd4saj-pooler.c-10.us-east-1.aws.neon.tech/qb_neon_t1',
      }),
      't1.localhost'
    )
    expect(result.kind).toBe('invalid')
  })

  it('refuses a credential ref outside the known schemes', () => {
    const result = interpretRow(row({ db_credential_ref: 'env://AWS_SECRET_ACCESS_KEY' }), 't1.localhost')
    expect(result.kind).toBe('invalid')
  })

  it('refuses a record whose primary hostname is not among its hostnames', () => {
    const result = interpretRow(row({ hostnames: ['t1.localhost'] }), 't1.localhost')
    expect(result.kind).toBe('invalid')
  })

  it('refuses an unknown state rather than treating it as active', () => {
    const result = interpretRow(row({ state: 'paused' }), 't1.localhost')
    expect(result.kind).toBe('invalid')
  })

  it('refuses a NULL workspace id instead of substituting a default', () => {
    const result = interpretRow(row({ workspace_id: null as unknown as string }), 't1.localhost')
    expect(result.kind).toBe('invalid')
  })
})

describe('normalizeHostHeader', () => {
  it.each([
    ['neon-t1.quackback.co.uk', 'neon-t1.quackback.co.uk'],
    ['Neon-T1.Quackback.Co.Uk', 'neon-t1.quackback.co.uk'],
    ['t1.localhost:3000', 't1.localhost'],
    ['t1.localhost.', 't1.localhost'],
    ['  t1.localhost  ', 't1.localhost'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeHostHeader(input)).toBe(expected)
  })

  it.each([
    ['a path', 'evil.com/../t1.localhost'],
    ['userinfo', 'user@t1.localhost'],
    ['an IPv6 literal', '[::1]'],
    ['a wildcard', '*.quackback.io'],
    ['empty', ''],
    ['only a port', ':3000'],
    ['a bare dot', '.'],
  ])('rejects %s rather than coercing it', (_label, input) => {
    expect(normalizeHostHeader(input)).toBeNull()
  })

  it('rejects a non-string', () => {
    expect(normalizeHostHeader(null)).toBeNull()
    expect(normalizeHostHeader(undefined)).toBeNull()
  })
})
