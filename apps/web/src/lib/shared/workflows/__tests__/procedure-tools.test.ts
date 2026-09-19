/**
 * Drift guard for the hand-maintained procedure-step tool catalogue.
 *
 * The builder's tool picker cannot read the server registry (it is client
 * code), so the catalogue is written by hand. The server only ever dispatches
 * a built-in WRITE tool whose `parents` includes 'conversation'
 * (workflow-tool-step.ts's resolveWorkflowToolStep), so a catalogue entry
 * outside that set is an option the admin can pick and the run can only
 * refuse. Importing the registry here, in the test alone, is what keeps the
 * two from parting company.
 */
import { describe, expect, it, vi } from 'vitest'
import { PROCEDURE_TOOLS } from '../procedure-tools'

vi.mock('@/lib/server/config', () => ({ config: {} }))
// The registry module also pulls in the read tools' retrieval and message
// lookups; stubbed so importing it never risks a real DB or embedding call,
// the same approach the toolspec's own unit tests take.
vi.mock('@/lib/server/domains/assistant/retrieval', () => ({ retrieveKbArticles: vi.fn() }))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({ listMessages: vi.fn() }))

describe('PROCEDURE_TOOLS', () => {
  it('lists only built-in write tools that can act on a conversation', async () => {
    const { resolveToolSpecs } = await import('@/lib/server/domains/assistant/assistant.toolspec')
    const authorable = new Set(
      resolveToolSpecs()
        .filter((spec) => spec.risk === 'write' && spec.parents.includes('conversation'))
        .map((spec) => spec.name)
    )
    for (const tool of PROCEDURE_TOOLS) {
      expect([...authorable], tool.name).toContain(tool.name)
    }
  })

  it('names arguments each tool actually declares', async () => {
    const { getToolSpecByName } = await import('@/lib/server/domains/assistant/assistant.toolspec')
    for (const tool of PROCEDURE_TOOLS) {
      const spec = getToolSpecByName(tool.name)
      expect(spec, tool.name).not.toBeNull()
      const shape = (spec!.definition.inputSchema as { shape?: Record<string, unknown> }).shape
      expect(shape, tool.name).toBeDefined()
      for (const arg of tool.args) {
        expect(Object.keys(shape!), `${tool.name}.${arg}`).toContain(arg)
      }
    }
  })
})
