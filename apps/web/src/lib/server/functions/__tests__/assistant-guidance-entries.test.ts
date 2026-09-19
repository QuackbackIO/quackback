import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    let handler: ((args: { data: never }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: (schema ? schema.parse(args?.data) : args?.data) as never })
    }
    fn.validator = (nextSchema: { parse: (value: unknown) => unknown }) => {
      schema = nextSchema
      return fn
    }
    fn.handler = (nextHandler: (args: { data: never }) => Promise<unknown>) => {
      handler = nextHandler
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getAssistantSettings: vi.fn(),
  ensureCanonicalGuidance: vi.fn(),
  projectConfigGuidance: vi.fn(),
  listGuidanceEntries: vi.fn(),
  saveGuidanceEntry: vi.fn(),
  deleteGuidanceEntry: vi.fn(),
  recordAuditEvent: vi.fn(),
  actorFromAuth: vi.fn(() => ({ email: 'admin@example.com' })),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantSettings: hoisted.getAssistantSettings,
}))
vi.mock('@/lib/server/domains/assistant/guidance-conversion', () => ({
  ensureCanonicalGuidance: hoisted.ensureCanonicalGuidance,
  projectConfigGuidance: hoisted.projectConfigGuidance,
  WRITING_GUIDELINES_PATH: 'agents.agent.voice.additionalInstructions',
}))
vi.mock('@/lib/server/domains/assistant/guidance-entries.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/assistant/guidance-entries.service')>()
  return {
    // The DTO mapper is the thing under test here, so it stays real.
    toGuidanceEntryDTO: actual.toGuidanceEntryDTO,
    listGuidanceEntries: hoisted.listGuidanceEntries,
    saveGuidanceEntry: hoisted.saveGuidanceEntry,
    deleteGuidanceEntry: hoisted.deleteGuidanceEntry,
  }
})
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: hoisted.actorFromAuth,
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))

import {
  listGuidanceEntriesFn,
  saveGuidanceEntryFn,
  deleteGuidanceEntryFn,
} from '../assistant-guidance-entries'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guidance_entry_1',
    kind: 'situational' as const,
    owner: 'canonical' as const,
    title: 'Refunds',
    body: 'Check the policy.',
    appliesWhen: 'Refund requested',
    enabled: true,
    priority: 0,
    version: 2,
    uses: ['agent' as const],
    legacySource: null,
    legacyId: null,
    createdById: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  }
}

const writingGuidelines = row({
  id: 'guidance_entry_voice',
  kind: 'always' as const,
  owner: 'config' as const,
  title: 'Everyday instructions',
  body: 'Name the plan first.',
  appliesWhen: null,
  legacySource: 'voice',
  legacyId: 'agents.agent.voice.additionalInstructions',
})

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
  hoisted.getAssistantSettings.mockResolvedValue({
    config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    revision: 9,
    managedFieldPaths: [],
  })
  hoisted.listGuidanceEntries.mockResolvedValue([writingGuidelines, row()])
  hoisted.saveGuidanceEntry.mockImplementation(async () => row({ version: 3 }))
})

describe('guidance entry functions', () => {
  it('gates every entry point on assistant.manage', async () => {
    await listGuidanceEntriesFn()
    await saveGuidanceEntryFn({
      data: {
        entry: {
          kind: 'always',
          title: 'Be clear',
          body: 'Answer plainly.',
          appliesWhen: null,
          uses: ['agent'],
        },
      },
    })
    await deleteGuidanceEntryFn({ data: { id: 'guidance_entry_1' } })

    expect(hoisted.requireAuth).toHaveBeenCalledTimes(3)
    for (const call of hoisted.requireAuth.mock.calls) {
      expect(call[0]).toEqual({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    }
  })

  it('refreshes the config projection from the settings it read, then lists', async () => {
    const result = await listGuidanceEntriesFn()

    const config = hoisted.getAssistantSettings.mock.results[0].value
    expect(hoisted.projectConfigGuidance).toHaveBeenCalledWith((await config).config)
    expect(hoisted.ensureCanonicalGuidance).toHaveBeenCalledTimes(1)
    expect(result.configRevision).toBe(9)
    expect(result.entries.map((entry) => entry.id)).toEqual([
      'guidance_entry_voice',
      'guidance_entry_1',
    ])
  })

  it('marks the writing guidelines managed only when the deployment pins that path', async () => {
    const open = await listGuidanceEntriesFn()
    expect(open.entries.find((entry) => entry.legacySource === 'voice')?.managed).toBe(false)

    hoisted.getAssistantSettings.mockResolvedValue({
      config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
      revision: 9,
      managedFieldPaths: ['assistant.agents.agent.voice'],
    })
    const pinned = await listGuidanceEntriesFn()
    expect(pinned.entries.find((entry) => entry.legacySource === 'voice')?.managed).toBe(true)
    // A canonical entry is never managed: the deployment configuration has no
    // path that reaches one.
    expect(pinned.entries.find((entry) => entry.owner === 'canonical')?.managed).toBe(false)
  })

  it('carries the version the editor read into the save and audits the roles written', async () => {
    await saveGuidanceEntryFn({
      data: {
        id: 'guidance_entry_1',
        expectedVersion: 2,
        entry: {
          kind: 'situational',
          title: 'Refunds',
          body: 'Check the policy, then the shipment.',
          appliesWhen: 'Refund requested',
          uses: ['agent', 'copilot'],
        },
      },
    })

    expect(hoisted.saveGuidanceEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'guidance_entry_1',
        expectedVersion: 2,
        createdById: 'principal_1',
        entry: expect.objectContaining({ uses: ['agent', 'copilot'] }),
      })
    )
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'assistant.guidance.updated',
        target: { type: 'assistant_guidance_entry', id: 'guidance_entry_1' },
        after: expect.objectContaining({ uses: ['agent'], version: 3 }),
      })
    )
  })

  it('refuses an entry whose application and condition disagree', async () => {
    await expect(
      saveGuidanceEntryFn({
        data: {
          entry: {
            kind: 'situational',
            title: 'Missing situation',
            body: 'This has no condition.',
            appliesWhen: null,
            uses: ['agent'],
          },
        },
      })
    ).rejects.toThrow(/situation/i)
    expect(hoisted.saveGuidanceEntry).not.toHaveBeenCalled()
  })
})
