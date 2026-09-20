/**
 * Exact input validation against a connector's discovered JSON Schema.
 *
 * The converter this replaces kept only `description` and `required`: an
 * `enum` became a bare string, an `integer` became any number, a nested object
 * became an opaque record and an array's `items` were dropped entirely. Every
 * case in the first block below is an argument the remote server declared
 * invalid and the old converter waved through, so each one is written as the
 * rejection it must now be.
 */
import { describe, expect, it } from 'vitest'
import {
  analyzeToolInputSchema,
  validateToolInput,
  CONNECTOR_MAX_ARGUMENT_BYTES,
} from '../tool-input-schema'
import { jsonSchemaToZod } from '../connector-tools'

const refundSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'requested_by_customer'] },
    amountCents: { type: 'integer', minimum: 1, maximum: 100_000 },
    customer: {
      type: 'object',
      properties: { id: { type: 'string' }, vip: { type: 'boolean' } },
      required: ['id'],
    },
    lineItems: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['reason', 'amountCents'],
}

function reject(args: Record<string, unknown>) {
  const result = validateToolInput(refundSchema, args)
  expect(result.ok).toBe(false)
  return result
}

describe('validateToolInput: violations the old converter accepted', () => {
  it('rejects a value outside the declared enum', () => {
    expect(
      jsonSchemaToZod(refundSchema).safeParse({ reason: 'because', amountCents: 5 }).success
    ).toBe(false)
    reject({ reason: 'because', amountCents: 5 })
  })

  it('rejects a fractional value for an integer', () => {
    reject({ reason: 'duplicate', amountCents: 12.5 })
  })

  it('rejects an integer outside its declared bounds', () => {
    reject({ reason: 'duplicate', amountCents: 0 })
    reject({ reason: 'duplicate', amountCents: 100_001 })
  })

  it('rejects a wrong type inside a nested object', () => {
    reject({ reason: 'duplicate', amountCents: 5, customer: { id: 42 } })
  })

  it('rejects a nested object missing its own required property', () => {
    reject({ reason: 'duplicate', amountCents: 5, customer: { vip: true } })
  })

  it('rejects array items of the wrong type', () => {
    reject({ reason: 'duplicate', amountCents: 5, lineItems: ['ok', 7] })
  })

  it('rejects an array longer than maxItems', () => {
    reject({ reason: 'duplicate', amountCents: 5, lineItems: ['a', 'b', 'c', 'd'] })
  })

  it('rejects a missing required property', () => {
    reject({ reason: 'duplicate' })
  })

  it('accepts a payload that satisfies every declared constraint', () => {
    const result = validateToolInput(refundSchema, {
      reason: 'fraudulent',
      amountCents: 250,
      customer: { id: 'cus_1', vip: true },
      lineItems: ['a'],
    })
    expect(result).toEqual({ ok: true })
  })

  it('accepts an absent optional property', () => {
    expect(validateToolInput(refundSchema, { reason: 'duplicate', amountCents: 1 }).ok).toBe(true)
  })
})

describe('validateToolInput: payload bound', () => {
  it('rejects an argument payload past the byte ceiling before any dispatch', () => {
    const huge = {
      reason: 'duplicate',
      amountCents: 1,
      customer: { id: 'x'.repeat(CONNECTOR_MAX_ARGUMENT_BYTES + 1) },
    }
    const result = validateToolInput(refundSchema, huge)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.join(' ')).toContain('too large')
  })
})

describe('analyzeToolInputSchema: the supported-construct policy', () => {
  it('supports the object/string/number/integer/boolean/array subset', () => {
    expect(analyzeToolInputSchema(refundSchema).supported).toBe(true)
  })

  it('supports a union of declared alternatives', () => {
    expect(
      analyzeToolInputSchema({
        type: 'object',
        properties: { id: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      }).supported
    ).toBe(true)
  })

  it('supports an absent schema as an unconstrained object', () => {
    expect(analyzeToolInputSchema(undefined).supported).toBe(true)
    expect(validateToolInput(undefined, { anything: 1 }).ok).toBe(true)
  })

  for (const [label, schema] of [
    ['a $ref', { type: 'object', properties: { a: { $ref: '#/$defs/x' } } }],
    ['allOf', { type: 'object', properties: { a: { allOf: [{ type: 'string' }] } } }],
    ['patternProperties', { type: 'object', patternProperties: { '^x': { type: 'string' } } }],
    ['a conditional', { type: 'object', if: { type: 'object' }, then: { type: 'object' } }],
    [
      'a schema-valued additionalProperties',
      { type: 'object', additionalProperties: { type: 'string' } },
    ],
    ['an unknown keyword', { type: 'object', properties: { a: { type: 'string', bogus: 1 } } }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`reports ${label} as unsupported rather than validating permissively`, () => {
      const analysis = analyzeToolInputSchema(schema)
      expect(analysis.supported).toBe(false)
      expect(analysis.supported === false && analysis.reason.length > 0).toBe(true)
    })
  }

  it('never treats an unsupported schema as a pass', () => {
    const result = validateToolInput(
      { type: 'object', properties: { a: { $ref: '#/$defs/x' } } },
      { a: 'anything' }
    )
    expect(result.ok).toBe(false)
  })

  it('ignores annotation-only keywords', () => {
    expect(
      analyzeToolInputSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Refund',
        description: 'Refund a charge',
        type: 'object',
        properties: { reason: { type: 'string', description: 'why', default: 'duplicate' } },
      }).supported
    ).toBe(true)
  })
})

describe('jsonSchemaToZod: model-facing contract', () => {
  it('carries the enum, the integer constraint, the nested object and the array items', () => {
    const zodSchema = jsonSchemaToZod(refundSchema)
    expect(zodSchema.safeParse({ reason: 'duplicate', amountCents: 5 }).success).toBe(true)
    expect(zodSchema.safeParse({ reason: 'nope', amountCents: 5 }).success).toBe(false)
    expect(zodSchema.safeParse({ reason: 'duplicate', amountCents: 5.5 }).success).toBe(false)
    expect(
      zodSchema.safeParse({ reason: 'duplicate', amountCents: 5, customer: { id: 1 } }).success
    ).toBe(false)
    expect(
      zodSchema.safeParse({ reason: 'duplicate', amountCents: 5, lineItems: [1] }).success
    ).toBe(false)
  })

  it('stays permissive for a schema outside the supported subset', () => {
    const zodSchema = jsonSchemaToZod({ type: 'object', properties: { a: { $ref: '#/x' } } })
    expect(zodSchema.safeParse({ a: 'anything' }).success).toBe(true)
  })
})

it('refuses remote patterns before attempting any match', () => {
  const schema = { type: 'object', properties: { text: { type: 'string', pattern: '(a+)+$' } } }
  expect(analyzeToolInputSchema(schema)).toMatchObject({
    supported: false,
    reason: expect.stringContaining('pattern'),
  })
  expect(validateToolInput(schema, { text: 'a' })).toMatchObject({ ok: false })
})

it('refuses deeply nested schema and annotation payloads without overflowing', () => {
  let nested: Record<string, unknown> = { type: 'string' }
  for (let i = 0; i < 10000; i++) nested = { type: 'object', properties: { child: nested } }
  expect(analyzeToolInputSchema(nested)).toMatchObject({
    supported: false,
    reason: expect.stringContaining('depth'),
  })
  expect(analyzeToolInputSchema({ type: 'object', default: nested })).toMatchObject({
    supported: false,
  })
})

it('rejects inherited property names unless explicitly declared', () => {
  const schema = { type: 'object', properties: {}, additionalProperties: false }
  expect(validateToolInput(schema, { constructor: 'inherited' })).toMatchObject({ ok: false })
  expect(
    validateToolInput(
      { ...schema, properties: { constructor: { type: 'string' } } },
      { constructor: 'declared' }
    )
  ).toEqual({ ok: true })
})
