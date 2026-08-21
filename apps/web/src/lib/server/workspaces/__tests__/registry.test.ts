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
import { SELECT_COLUMNS, interpretRow, normalizeHostHeader } from '../registry'

const ROW: {
  workspace_key: string
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
  mail_slug: string
  ai_enabled: boolean
  revision: string | number
  pg_database_oid: string | number | null
  hostnames: string[]
} = {
  workspace_key: 'inst_cloud_ws_t1',
  contract_version: 1,
  state: 'active',
  state_reason: null,
  primary_hostname: 'ws-t1.quackback.co.uk',
  base_url: 'https://ws-t1.quackback.co.uk',
  db_pooled_url: 'postgresql://qb_ws_t1@db-pooler.example.com/qb_ws_t1?sslmode=require',
  db_direct_url: 'postgresql://qb_ws_t1@db.example.com/qb_ws_t1?sslmode=require',
  db_name: 'qb_ws_t1',
  db_role: 'qb_ws_t1',
  db_credential_ref: 'sealed+aead://v1/inst_cloud_ws_t1/db/AAAAAAAAAAAAAAAA',
  app_secrets_ref: 'derived+hkdf://v1/inst_cloud_ws_t1/app-secrets',
  workspace_id: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
  fingerprint_stamped_at: '2026-08-08T14:32:43.928Z',
  storage: {
    provider: 'r2',
    bucket: 'qb-ws-t1',
    endpoint: 'https://cloud-account.r2.cloudflarestorage.com',
    region: 'auto',
    forcePathStyle: false,
    publicUrl: 'https://ws-t1.quackback.co.uk/api/storage',
    credentialRef: 'env://QUACKBACK_TENANT_SECRET_INST_CLOUD_WS_T1_STORAGE',
  },
  email_from: 'Quackback Cloud <noreply@notifications.quackback.io>',
  mail_slug: 'neon-t1',
  ai_enabled: false,
  revision: 2,
  pg_database_oid: 4242,
  hostnames: ['ws-t1.quackback.co.uk', 't1.localhost'],
}

type Row = typeof ROW

function row(over: Partial<Row> = {}): Row {
  return { ...ROW, ...over }
}

/** No refusal variant may carry anything a caller could connect with. */
function assertCarriesNoDsn(value: unknown): void {
  const serialised = JSON.stringify(value)
  expect(serialised).not.toContain('postgres')
  expect(serialised).not.toContain('sealed+aead')
  expect(serialised).not.toContain('db.example.com')
}

describe('interpretRow', () => {
  it('accepts a record whose storage names no credential of its own', () => {
    // The pooled default: one fleet bucket, isolation in the key prefix, so
    // there is no per-workspace credential to name. This must parse as a healthy
    // record rather than a malformed one, because the app turns a storage
    // *problem* into a 503 and "no credential" is not a problem.
    const r = row()
    // `storage` is `unknown` on the row type on purpose: this is raw database
    // input and `interpretRow` is the thing that gives it a shape.
    const storage = { ...(r.storage as Record<string, unknown>) }
    delete storage.credentialRef
    const result = interpretRow({ ...r, storage }, 't1.localhost')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.workspace.storage.credentialRef).toBeUndefined()
  })

  it('accepts a complete, active record and attaches the physical placement', () => {
    const result = interpretRow(row(), 't1.localhost')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.workspace.workspaceKey).toBe('inst_cloud_ws_t1')
    expect(result.workspace.database.pooledUrl).toContain('-pooler.')
    // Catalog identity is not part of contract v1's WorkspaceRecord, so it has
    // to be carried alongside — and without it the clone check has nothing to
    // compare.
    expect(result.workspace.physical).toEqual({
      catalogName: 'qb_ws_t1',
      catalogOid: '4242',
    })
  })

  it('reports a suspended workspace with its reason and no DSN', () => {
    const result = interpretRow(
      row({ state: 'suspended', state_reason: 'nonpayment' }),
      't1.localhost'
    )
    expect(result).toMatchObject({ kind: 'suspended', reason: 'nonpayment' })
    assertCarriesNoDsn(result)
  })

  it('reports a deleting workspace with no DSN', () => {
    const result = interpretRow(row({ state: 'deleting' }), 't1.localhost')
    expect(result.kind).toBe('deleting')
    assertCarriesNoDsn(result)
  })

  it('gates on state BEFORE validating, so a suspended stale record still reads as suspended', () => {
    // Otherwise suspending a workspace whose record has some unrelated defect
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
    const result = interpretRow(
      row({ base_url: 'https://someone-else.example.com' }),
      't1.localhost'
    )
    expect(result.kind).toBe('invalid')
  })

  it('refuses a direct endpoint that is really a pooler', () => {
    // LISTEN registration is lost through a transaction pooler in proportion to
    // contention, so this fails silently under load rather than at deploy.
    const result = interpretRow(
      row({
        db_direct_url: 'postgresql://qb_ws_t1@db-pooler.example.com/qb_ws_t1',
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
        db_pooled_url: 'postgresql://qb_ws_t1:hunter2@db-pooler.example.com/qb_ws_t1',
      }),
      't1.localhost'
    )
    expect(result.kind).toBe('invalid')
  })

  it('refuses a credential ref outside the known schemes', () => {
    const result = interpretRow(
      row({ db_credential_ref: 'env://AWS_SECRET_ACCESS_KEY' }),
      't1.localhost'
    )
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

  it('surfaces the mail slug on the record', () => {
    // The label the fleet's one shared inbound domain routes on. It reaches a
    // sender through the record and nowhere else, so a projection that dropped
    // it would take reply-by-email off every workspace at once.
    const result = interpretRow(row(), 't1.localhost')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.workspace.email.mailSlug).toBe('neon-t1')
  })

  it('refuses a row with no mail slug rather than reading one as undefined', () => {
    // The half-landed change this pairs with: re-vendoring the contract without
    // adding `mail_slug` to the SELECT leaves every row projecting `undefined`
    // here. Validation is what turns that into a refusal instead of a fleet
    // quietly minting `undefined+c…@` into customers' mail clients.
    const { mail_slug: _dropped, ...withoutSlug } = row()
    const result = interpretRow(withoutSlug as Row, 't1.localhost')
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') return
    expect(result.problems.join(' ')).toContain('email.mailSlug')
    assertCarriesNoDsn(result)
  })

  it('refuses a mail slug the address grammar could not spend', () => {
    // The database CHECK constraint says the same thing, and this reader does
    // not get to assume it ran: an over-length or upper-case slug produces a
    // local part a receiving MTA rejects, i.e. mail that silently stops
    // arriving, attributed to anything but the address that caused it.
    for (const slug of ['NEON-T1', 'neon_t1', 'fourteen-chars', '']) {
      expect(interpretRow(row({ mail_slug: slug }), 't1.localhost').kind).toBe('invalid')
    }
  })
})

describe('the projection', () => {
  it('selects every column the row shape declares', () => {
    // The other half of every field this module gains. A column named on the row
    // type and read by the mapper but never selected arrives as `undefined` for
    // every workspace at once, and the contract refuses the lot — which is a
    // fleet-wide 503, from a change that looks finished everywhere it is
    // mentioned. `interpretRow` cannot see it, because a test hands it a row.
    for (const column of Object.keys(ROW)) {
      // Aggregated from the hostname table, not a registry column.
      if (column === 'hostnames') continue
      // Cast to text, so it is selected under an alias rather than bare.
      if (column === 'state') continue
      expect(SELECT_COLUMNS).toContain(`r.${column}`)
    }
    expect(SELECT_COLUMNS).toContain('r.state::text AS state')
  })
})

describe('normalizeHostHeader', () => {
  it.each([
    ['ws-t1.quackback.co.uk', 'ws-t1.quackback.co.uk'],
    ['Ws-T1.Quackback.Co.Uk', 'ws-t1.quackback.co.uk'],
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
