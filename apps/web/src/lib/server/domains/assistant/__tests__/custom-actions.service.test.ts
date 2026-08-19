// Encryption derives a key from SECRET_KEY; the unit env doesn't set one, so
// provide a deterministic test key BEFORE any module pulls in the config.
process.env.SECRET_KEY ||= 'test-secret-key-for-custom-actions-abcdefgh'

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantActions } from '@/lib/server/db'
import { decrypt } from '@/lib/server/encryption'
import { assistantActionInputSchema } from '@/lib/shared/assistant/custom-actions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The unit env never fully validates the app config, so `config.secretKey`
// (which encryption derives from) would throw. Supply just the secret key the
// header encryption needs; no other config field is read on these paths.
vi.mock('@/lib/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/config')>()
  return {
    ...actual,
    config: new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === 'secretKey'
            ? 'test-secret-key-for-custom-actions-abcdefgh'
            : (actual.config as unknown as Record<string | symbol, unknown>)[prop],
      }
    ),
  }
})

import {
  substituteTemplate,
  projectAllowlisted,
  capSerializedResponse,
  actionToolName,
  performActionRequest,
  buildActionToolSpec,
  toActionDTO,
  createCustomAction,
  updateCustomAction,
  listCustomActions,
  deleteCustomAction,
  listActionSpecsForAgent,
  getActionSpecByToolName,
  type AssistantActionRow,
} from '../custom-actions.service'

const VALID_INPUT = {
  name: 'Lookup order',
  whenToUse: 'Call to look up an order by id.',
  request: {
    method: 'GET' as const,
    url: 'https://api.example.test/orders/{{order_id}}',
    headers: [],
  },
  variables: [{ name: 'order_id', description: 'The order id.' }],
  responseAllowlist: ['status'],
  responseCharLimit: 4000,
  assignments: { agent: true, copilot: false },
  enabled: true,
}

describe('substituteTemplate', () => {
  it('percent-encodes values in url context', () => {
    expect(substituteTemplate('https://x.test/{{q}}', { q: 'a b/c?d&e' }, 'url')).toBe(
      'https://x.test/a%20b%2Fc%3Fd%26e'
    )
  })

  it('escapes values for a JSON string literal in json context', () => {
    expect(substituteTemplate('{"q":"{{q}}"}', { q: 'he said "hi"\n\\x' }, 'json')).toBe(
      '{"q":"he said \\"hi\\"\\n\\\\x"}'
    )
  })

  it('leaves undeclared placeholders literal', () => {
    expect(substituteTemplate('{{a}}-{{b}}', { a: 'X' }, 'url')).toBe('X-{{b}}')
  })
})

describe('projectAllowlisted', () => {
  const source = {
    status: 'shipped',
    secretToken: 'sk-123',
    customer: { email: 'a@b.test', name: 'Ada' },
    items: [
      { name: 'Widget', sku: 'W1' },
      { name: 'Gadget', sku: 'G1' },
    ],
  }

  it('exposes ONLY allowlisted scalar fields', () => {
    expect(projectAllowlisted(source, ['status'])).toEqual({ status: 'shipped' })
  })

  it('never leaks a non-allowlisted field', () => {
    const out = projectAllowlisted(source, ['status', 'customer.name'])
    expect(out).toEqual({ status: 'shipped', 'customer.name': 'Ada' })
    expect(JSON.stringify(out)).not.toContain('sk-123')
    expect(JSON.stringify(out)).not.toContain('a@b.test')
  })

  it('fans out across arrays with []', () => {
    expect(projectAllowlisted(source, ['items[].name'])).toEqual({
      'items[].name': ['Widget', 'Gadget'],
    })
  })

  it('returns an empty projection for an empty allowlist (nothing exposed)', () => {
    expect(projectAllowlisted(source, [])).toEqual({})
  })

  it('drops paths that do not resolve', () => {
    expect(projectAllowlisted(source, ['missing.path'])).toEqual({})
  })
})

describe('capSerializedResponse', () => {
  it('passes through under the limit', () => {
    const { data, truncated } = capSerializedResponse({ a: 1 }, 4000)
    expect(truncated).toBe(false)
    expect(data).toBe('{"a":1}')
  })

  it('truncates and flags over the limit', () => {
    const { data, truncated } = capSerializedResponse({ a: 'x'.repeat(100) }, 20)
    expect(truncated).toBe(true)
    expect(data.length).toBe(20)
  })
})

describe('actionToolName', () => {
  it('is the stable `action_<slug>` name — no de-collision suffix (names are unique)', () => {
    expect(actionToolName({ name: 'Lookup order' })).toBe('action_lookup_order')
    // Names that would slugify equal can never coexist (service + unique index),
    // so the tool name is a plain 1:1 function of the name with no suffixing.
    expect(actionToolName({ name: 'Lookup-order' })).toBe('action_lookup_order')
  })
})

describe('assistantActionInputSchema (validation)', () => {
  it('accepts a valid definition', () => {
    expect(assistantActionInputSchema.safeParse(VALID_INPUT).success).toBe(true)
  })

  it('rejects a non-http url', () => {
    const bad = { ...VALID_INPUT, request: { ...VALID_INPUT.request, url: 'ftp://x.test' } }
    expect(assistantActionInputSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an invalid variable name', () => {
    const bad = { ...VALID_INPUT, variables: [{ name: '1bad', description: 'x' }] }
    expect(assistantActionInputSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an out-of-shape allowlist path', () => {
    const bad = { ...VALID_INPUT, responseAllowlist: ['a..b'] }
    expect(assistantActionInputSchema.safeParse(bad).success).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'prototype', 'a.__proto__.b', 'items[].constructor'])(
    'rejects a prototype-pollution segment in an allowlist path (%s)',
    (path) => {
      const bad = { ...VALID_INPUT, responseAllowlist: [path] }
      expect(assistantActionInputSchema.safeParse(bad).success).toBe(false)
    }
  )

  it('still accepts an ordinary field literally named "prototypeVersion"', () => {
    // The refine rejects the exact reserved tokens as whole segments, not
    // substrings — a field that merely contains one is fine.
    const ok = { ...VALID_INPUT, responseAllowlist: ['prototypeVersion', 'data.constructorName'] }
    expect(assistantActionInputSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects a response char limit above the ceiling', () => {
    const bad = { ...VALID_INPUT, responseCharLimit: 999_999 }
    expect(assistantActionInputSchema.safeParse(bad).success).toBe(false)
  })
})

describe('performActionRequest (SSRF guard)', () => {
  it('refuses a private/loopback address without throwing', async () => {
    const result = await performActionRequest({
      method: 'GET',
      url: 'http://127.0.0.1:9/whatever',
      headers: {},
      body: null,
      variables: {},
      responseAllowlist: ['status'],
      responseCharLimit: 4000,
    })
    expect(result.ok).toBe(false)
    expect(result.note).toMatch(/not an allowed address/i)
    expect(result.data).toBe('')
  })

  it('refuses a link-local cloud-metadata address', async () => {
    const result = await performActionRequest({
      method: 'GET',
      url: 'http://169.254.169.254/latest/meta-data/',
      headers: {},
      body: null,
      variables: {},
      responseAllowlist: ['status'],
      responseCharLimit: 4000,
    })
    expect(result.ok).toBe(false)
    expect(result.note).toMatch(/not an allowed address/i)
  })
})

describe('buildActionToolSpec', () => {
  const row = {
    id: 'assistant_custom_action_x',
    name: 'Lookup order',
    whenToUse: 'Look up an order.',
    method: 'GET' as const,
    url: 'http://127.0.0.1:9/{{order_id}}',
    headers: [],
    body: null,
    variables: [{ name: 'order_id', description: 'The order id.' }],
    responseAllowlist: ['status'],
    responseCharLimit: 4000,
    assignments: { agent: true, copilot: false },
    enabled: true,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AssistantActionRow

  it('is a write-risk spec on both parents with a per-variable input schema', () => {
    const spec = buildActionToolSpec(row, 'action_lookup_order')
    expect(spec.risk).toBe('write')
    expect(spec.permissions).toEqual([])
    expect(spec.parents).toEqual(['conversation', 'ticket'])
    expect(spec.name).toBe('action_lookup_order')
    const parsed = spec.definition.inputSchema.safeParse({ order_id: 'o-1' })
    expect(parsed.success).toBe(true)
    // Output schema admits the gate envelope (copilot propose path).
    expect(
      spec.definition.outputSchema.safeParse({ status: 'pending_approval', note: 'x' }).success
    ).toBe(true)
  })

  it('execute returns a graceful failure (never throws into the loop)', async () => {
    const spec = buildActionToolSpec(row, 'action_lookup_order')
    const out = (await spec.execute({ order_id: 'o-1' }, {} as never)) as { ok: boolean }
    expect(out.ok).toBe(false)
  })
})

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ name: assistantActions.name }).from(assistantActions).limit(0)
  },
})

describe.skipIf(!fixture.available)('custom-actions.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates, lists, updates, and deletes a definition', async () => {
    const row = await createCustomAction(VALID_INPUT, testDb)
    expect(row.name).toBe('Lookup order')
    expect((await listCustomActions(testDb)).map((r) => r.id)).toContain(row.id)

    const updated = await updateCustomAction(
      row.id,
      { ...VALID_INPUT, name: 'Renamed', enabled: false },
      testDb
    )
    expect(updated?.name).toBe('Renamed')
    expect(updated?.enabled).toBe(false)

    await deleteCustomAction(row.id, testDb)
    expect((await listCustomActions(testDb)).map((r) => r.id)).not.toContain(row.id)
  })

  it('encrypts secret header values at rest and masks them in the DTO', async () => {
    const row = await createCustomAction(
      {
        ...VALID_INPUT,
        request: {
          method: 'GET',
          url: 'https://api.example.test/x',
          headers: [
            { name: 'Authorization', value: 'Bearer super-secret', secret: true },
            { name: 'X-Env', value: 'prod', secret: false },
          ],
        },
      },
      testDb
    )
    const secret = row.headers.find((h) => h.name === 'Authorization')!
    // Stored value is ciphertext, not the plaintext, and round-trips.
    expect(secret.value).not.toContain('super-secret')
    expect(decrypt(secret.value, 'assistant-custom-action-headers')).toBe('Bearer super-secret')

    const dto = toActionDTO(row)
    const secretDto = dto.request.headers.find((h) => h.name === 'Authorization')!
    expect(secretDto.value).toBe('')
    expect(secretDto.hasValue).toBe(true)
    // Non-secret header value is visible.
    expect(dto.request.headers.find((h) => h.name === 'X-Env')!.value).toBe('prod')
  })

  it('keeps a stored secret when an edit re-sends it empty (masked, unchanged)', async () => {
    const row = await createCustomAction(
      {
        ...VALID_INPUT,
        request: {
          method: 'GET',
          url: 'https://api.example.test/x',
          headers: [{ name: 'Authorization', value: 'Bearer keep-me', secret: true }],
        },
      },
      testDb
    )
    const original = row.headers[0].value
    const updated = await updateCustomAction(
      row.id,
      {
        ...VALID_INPUT,
        request: {
          method: 'GET',
          url: 'https://api.example.test/x',
          headers: [{ name: 'Authorization', value: '', secret: true }],
        },
      },
      testDb
    )
    expect(updated?.headers[0].value).toBe(original)
    expect(decrypt(updated!.headers[0].value, 'assistant-custom-action-headers')).toBe(
      'Bearer keep-me'
    )
  })

  it('rejects a second action whose name slugifies to an existing one (case-insensitive)', async () => {
    await createCustomAction({ ...VALID_INPUT, name: 'Lookup order' }, testDb)
    // Different casing/punctuation, same slug — must be rejected as a duplicate.
    await expect(
      createCustomAction({ ...VALID_INPUT, name: 'Lookup-Order' }, testDb)
    ).rejects.toMatchObject({ code: 'ASSISTANT_ACTION_DUPLICATE_NAME' })
  })

  it('rejects an update that collides another action’s slug, but allows renaming a row to itself', async () => {
    const a = await createCustomAction({ ...VALID_INPUT, name: 'Alpha action' }, testDb)
    await createCustomAction({ ...VALID_INPUT, name: 'Beta action' }, testDb)

    // Renaming Alpha to collide with Beta is rejected.
    await expect(
      updateCustomAction(a.id, { ...VALID_INPUT, name: 'beta_action' }, testDb)
    ).rejects.toMatchObject({ code: 'ASSISTANT_ACTION_DUPLICATE_NAME' })

    // Re-saving Alpha under its own (same-slug) name is fine — self never collides.
    const updated = await updateCustomAction(
      a.id,
      { ...VALID_INPUT, name: 'Alpha  action', enabled: false },
      testDb
    )
    expect(updated?.enabled).toBe(false)
  })

  it('resolves a deleted action’s tool name to null (approve-after-delete surfaces gone)', async () => {
    const row = await createCustomAction(
      { ...VALID_INPUT, name: 'Lookup order', assignments: { agent: false, copilot: true } },
      testDb
    )
    const toolName = actionToolName(row)
    expect(await getActionSpecByToolName(toolName, 'copilot', testDb)).not.toBeNull()

    await deleteCustomAction(row.id, testDb)
    // Gone: nothing resolves, so the approve path throws its "no longer
    // available" (ToolSpecGoneError, 410) rather than executing anything.
    expect(await getActionSpecByToolName(toolName, 'copilot', testDb)).toBeNull()
  })

  it('rejects a template that references an undeclared variable', async () => {
    await expect(
      createCustomAction(
        {
          ...VALID_INPUT,
          request: { method: 'GET', url: 'https://x.test/{{undeclared}}', headers: [] },
          variables: [],
        },
        testDb
      )
    ).rejects.toThrow(/undeclared variable/i)
  })

  it('registers per agent assignment (matrix): enabled+assigned only', async () => {
    await createCustomAction(
      { ...VALID_INPUT, name: 'Agent action', assignments: { agent: true, copilot: false } },
      testDb
    )
    await createCustomAction(
      { ...VALID_INPUT, name: 'Copilot action', assignments: { agent: false, copilot: true } },
      testDb
    )
    await createCustomAction(
      {
        ...VALID_INPUT,
        name: 'Disabled action',
        assignments: { agent: true, copilot: true },
        enabled: false,
      },
      testDb
    )

    const agentSpecs = await listActionSpecsForAgent('agent', testDb)
    const copilotSpecs = await listActionSpecsForAgent('copilot', testDb)
    expect(agentSpecs.map((s) => s.label)).toEqual(['Agent action'])
    expect(copilotSpecs.map((s) => s.label)).toEqual(['Copilot action'])
  })

  it('resolves a persisted tool name back to its spec for the approve path', async () => {
    const row = await createCustomAction(
      { ...VALID_INPUT, name: 'Lookup order', assignments: { agent: false, copilot: true } },
      testDb
    )
    const specs = await listActionSpecsForAgent('copilot', testDb)
    const toolName = specs[0].name
    expect(toolName).toBe('action_lookup_order')

    const resolved = await getActionSpecByToolName(toolName, 'copilot', testDb)
    expect(resolved?.name).toBe(toolName)
    expect(resolved?.risk).toBe('write')
    // Wrong agent (assigned to copilot only) resolves to null for the agent.
    expect(await getActionSpecByToolName(toolName, 'agent', testDb)).toBeNull()
    // Unknown name resolves to null.
    expect(await getActionSpecByToolName('action_nope', 'copilot', testDb)).toBeNull()
    expect(row.id).toBeTruthy()
  })
})
