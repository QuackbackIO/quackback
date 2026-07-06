import { describe, it, expect, vi, beforeAll } from 'vitest'
import {
  ASSISTANT_TOOL_SPECS,
  resolveToolSpecs,
  type ToolControlMode,
  type AssistantToolSpec,
} from '../assistant.toolspec'

// resolveToolSpecs checks the dataConnectors flag before merging in
// connector-backed tools; this suite is about the fixed catalogue's shape, so
// the flag stays off and the static registry is the whole story (matches the
// exact-name-list assertion below).
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const VALID_RISKS = ['read', 'write']
const VALID_MODES: ToolControlMode[] = ['disabled', 'approval', 'autonomous']

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

  it('every spec supportedModes only contains valid control modes', () => {
    for (const spec of specs) {
      for (const mode of spec.supportedModes) {
        expect(VALID_MODES).toContain(mode)
      }
    }
  })

  it('every spec supportedModes includes its own defaultMode', () => {
    for (const spec of specs) {
      expect(spec.supportedModes).toContain(spec.defaultMode)
    }
  })

  it('read-risk tools never support approval (approval is a write concept)', () => {
    for (const spec of specs) {
      if (spec.risk === 'read') {
        expect(spec.supportedModes).not.toContain('approval')
      }
    }
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
    expect(spec.defaultMode).toBe('autonomous')
    expect(spec.supportedModes).toEqual(['disabled', 'autonomous'])
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

describe('resolveToolSpecs', () => {
  it('returns exactly the read and write specs that exist today', async () => {
    const names = (await resolveToolSpecs()).map((s) => s.name).sort()
    expect(names).toEqual([
      'capture_feedback',
      'create_ticket',
      'end_conversation',
      'search_knowledge',
      'set_attribute',
    ])
  })
})
