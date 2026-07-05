import { describe, it, expect } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  ASSISTANT_TOOL_SPECS,
  resolveToolSpecs,
  type ToolControlMode,
} from '../assistant.toolspec'

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const VALID_RISKS = ['read', 'write']
const VALID_MODES: ToolControlMode[] = ['disabled', 'approval', 'autonomous']

describe('assistant.toolspec registry completeness', () => {
  const specs = resolveToolSpecs()

  it('is non-empty', () => {
    expect(specs.length).toBeGreaterThan(0)
  })

  it('every spec has non-empty name, label, and description', () => {
    for (const spec of specs) {
      expect(spec.name.length).toBeGreaterThan(0)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.description.length).toBeGreaterThan(0)
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

  it('summarizes with the query', () => {
    expect(spec.summarize({ query: 'refund policy' })).toBe('Search knowledge for "refund policy"')
  })
})

describe('get_conversation_context spec', () => {
  const spec = ASSISTANT_TOOL_SPECS.get_conversation_context

  it('exists with the expected shape', () => {
    expect(spec).toBeDefined()
    expect(spec.risk).toBe('read')
    expect(spec.defaultMode).toBe('autonomous')
    expect(spec.supportedModes).toEqual(['disabled', 'autonomous'])
  })

  it('requires conversation.view (it reads the linked conversation)', () => {
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_VIEW])
  })

  it('summarizes without needing args', () => {
    expect(spec.summarize({})).toBe('Read conversation context')
  })
})

describe('resolveToolSpecs', () => {
  it('returns exactly the read and write specs that exist today', () => {
    const names = resolveToolSpecs()
      .map((s) => s.name)
      .sort()
    expect(names).toEqual([
      'capture_feedback',
      'create_ticket',
      'end_conversation',
      'get_conversation_context',
      'search_knowledge',
      'set_attribute',
    ])
  })
})
