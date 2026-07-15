import { describe, it, expect, beforeAll } from 'vitest'
import {
  ASSISTANT_TOOL_SPECS,
  getToolSpecByName,
  makeAssistantToolContext,
  resolveToolSpecs,
  type AssistantToolSpec,
} from '../assistant.toolspec'

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const VALID_RISKS = ['read', 'write', 'control']

describe('assistant.toolspec registry completeness', () => {
  let specs: AssistantToolSpec[]
  beforeAll(async () => {
    specs = await resolveToolSpecs()
  })

  it('is non-empty', () => {
    expect(specs.length).toBeGreaterThan(0)
  })

  it('every spec has non-empty name, label, description, and promptGuidance', () => {
    for (const spec of specs) {
      expect(spec.name.length).toBeGreaterThan(0)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.description.length).toBeGreaterThan(0)
      expect(spec.promptGuidance.length).toBeGreaterThan(0)
    }
  })

  it('every spec declares a valid risk class', () => {
    for (const spec of specs) {
      expect(VALID_RISKS).toContain(spec.risk)
    }
  })

  it('there is at least one write tool in the catalogue', () => {
    expect(specs.filter((spec) => spec.risk === 'write').length).toBeGreaterThan(0)
  })

  it('every spec declares a non-empty parents array of only conversation/ticket', () => {
    for (const spec of specs) {
      expect(spec.parents.length).toBeGreaterThan(0)
      for (const parent of spec.parents) {
        expect(['conversation', 'ticket']).toContain(parent)
      }
    }
  })

  it('names are unique', () => {
    const names = specs.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('names are snake_case', () => {
    for (const spec of specs) {
      expect(spec.name).toMatch(SNAKE_CASE)
    }
  })

  it('every spec has an execute and summarize function', () => {
    for (const spec of specs) {
      expect(typeof spec.execute).toBe('function')
      expect(typeof spec.summarize).toBe('function')
    }
  })

  // The model runtime validates execute results against outputSchema AFTER the
  // pipeline wrapper runs. If a definition's schema rejects the gate envelopes,
  // pending-approval / denied / duplicate / failed / simulated results reach
  // the model as a generic validation error and the note never gets relayed.
  it('every definition outputSchema admits the pipeline gate envelopes', () => {
    const envelopes = [
      { status: 'pending_approval', note: 'x' },
      { status: 'denied', note: 'x' },
      { status: 'skipped_duplicate', note: 'x' },
      { status: 'failed', note: 'x' },
      { simulated: true, summary: 'x' },
    ]
    for (const spec of specs) {
      const schema = (spec.definition as { outputSchema?: { parse: (v: unknown) => unknown } })
        .outputSchema
      expect(schema, `${spec.name} has no outputSchema`).toBeDefined()
      for (const envelope of envelopes) {
        expect(
          () => schema!.parse(envelope),
          `${spec.name} outputSchema rejects ${JSON.stringify(envelope)}`
        ).not.toThrow()
      }
    }
  })
})

describe('search_knowledge spec', () => {
  const spec = ASSISTANT_TOOL_SPECS.search_knowledge

  it('exists with the expected shape', () => {
    expect(spec).toBeDefined()
    expect(spec.risk).toBe('read')
  })

  it('requires no conversation permission (audience scoping is the access control)', () => {
    expect(spec.permissions).toEqual([])
  })

  it('offers both conversation and ticket parents (unified inbox §2.9): it never keys its own logic off ctx.conversationId', () => {
    expect(spec.parents).toEqual(['conversation', 'ticket'])
  })

  it('summarizes with the query', () => {
    expect(spec.summarize({ query: 'refund policy' })).toBe('Search knowledge for "refund policy"')
  })
})

describe('handoff_to_human spec', () => {
  const spec = ASSISTANT_TOOL_SPECS.handoff_to_human
  const packet = {
    reason: 'low_confidence',
    customerNeed: 'Restore access to a feature that keeps failing.',
    attempted: ['Reviewed the available troubleshooting guidance.'],
    recommendedNextStep: 'Inspect the account and reproduce the failure.',
  }

  it('accepts every handoff field at its maximum bound', () => {
    expect(
      spec.definition.inputSchema.safeParse({
        reason: packet.reason,
        customerNeed: 'n'.repeat(500),
        attempted: Array.from({ length: 5 }, () => 'a'.repeat(160)),
        recommendedNextStep: 'r'.repeat(300),
      }).success
    ).toBe(true)
  })

  it('rejects handoff strings and arrays above their maximum bounds', () => {
    const invalidPackets = [
      { ...packet, customerNeed: 'n'.repeat(501) },
      { ...packet, attempted: Array.from({ length: 6 }, () => 'attempted') },
      { ...packet, attempted: ['a'.repeat(161)] },
      { ...packet, recommendedNextStep: 'r'.repeat(301) },
    ]

    for (const invalid of invalidPackets) {
      expect(spec.definition.inputSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('accepts a simulated sandbox handoff and retains the complete packet', async () => {
    const context = makeAssistantToolContext({
      db: {} as never,
      assistantPrincipalId: 'principal_assistant' as never,
      audience: 'public',
      conversationId: null,
      simulate: true,
    })

    await expect(spec.execute(packet, context)).resolves.toEqual({
      accepted: true,
      reason: 'low_confidence',
    })
    expect(context.ledger.handoffRequest).toEqual(packet)
  })
})

describe('resolveToolSpecs', () => {
  it('returns exactly the read, control, and write specs that exist today', async () => {
    const names = (await resolveToolSpecs()).map((s) => s.name).sort()
    expect(names).toEqual([
      'capture_feedback',
      'create_ticket',
      'end_conversation',
      'get_status',
      'handoff_to_human',
      'report_inability',
      'search_knowledge',
      'set_attribute',
    ])
  })

  it('looks up tools only from the static registry', () => {
    expect(getToolSpecByName('end_conversation')).toBe(ASSISTANT_TOOL_SPECS.end_conversation)
    expect(getToolSpecByName('unknown_tool')).toBeNull()
  })
})
