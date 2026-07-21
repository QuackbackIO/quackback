import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/shared/assistant/config'

const hoisted = vi.hoisted(() => ({
  requireSettings: vi.fn(),
  invalidateSettingsCache: vi.fn(),
  transaction: vi.fn(),
  txSelect: vi.fn(),
  txForUpdate: vi.fn(),
  txUpdate: vi.fn(),
  txSet: vi.fn(),
  recordAuditEventInTransaction: vi.fn(),
  settingsTable: {
    id: 'settings.id',
    assistantConfig: 'settings.assistantConfig',
    assistantConfigRevision: 'settings.assistantConfigRevision',
    managedFieldPaths: 'settings.managedFieldPaths',
  },
  principalTable: {
    type: 'principal.type',
    serviceMetadata: 'principal.serviceMetadata',
  },
  txRow: null as null | {
    id: string
    assistantConfig: unknown
    assistantConfigRevision: number
    managedFieldPaths: string[]
  },
  committedWrites: [] as Array<{
    table: unknown
    values: Record<string, unknown>
  }>,
  events: [] as string[],
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    transaction: (...args: unknown[]) => hoisted.transaction(...args),
  },
  settings: hoisted.settingsTable,
  principal: hoisted.principalTable,
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettings: hoisted.requireSettings,
  invalidateSettingsCache: hoisted.invalidateSettingsCache,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEventInTransaction: (...args: unknown[]) =>
    hoisted.recordAuditEventInTransaction(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: vi.fn() }) },
}))

import {
  getAssistantConfig,
  getAssistantRuntimeConfig,
  getAssistantSettings,
  updateAssistantIdentity,
  updateAssistantVoice,
  updateAssistantAgentKnowledge,
  updateAssistantCopilotCapabilities,
} from '../settings.assistant'

const CONFIG: AssistantConfig = {
  version: 3,
  identity: {
    name: 'Avery',
    avatarUrl: 'https://cdn.example.test/avery.png',
  },
  agents: {
    agent: {
      voice: {
        tone: 'balanced',
        responseLength: 'balanced',
        additionalInstructions: 'Use short replies.',
      },
      knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
    },
    copilot: {
      capabilities: { qa: true },
      knowledge: {
        helpCenter: true,
        posts: true,
        pastConversations: true,
        internalNotes: true,
        tickets: false,
        changelog: false,
        status: true,
      },
    },
  },
}

/** The Agent's voice, the section updateAssistantVoice writes. */
const VOICE = CONFIG.agents.agent.voice

/** Build the full config with a replaced Agent voice, for expected-config assertions. */
function withVoice(voice: AssistantConfig['agents']['agent']['voice']): AssistantConfig {
  return { ...CONFIG, agents: { ...CONFIG.agents, agent: { ...CONFIG.agents.agent, voice } } }
}

const REQUEST_HEADERS = new Headers({
  'user-agent': 'settings-test',
  'x-request-id': 'request_1',
})

const ACTOR = {
  email: 'admin@example.com',
  role: 'admin',
  type: 'user' as const,
  headers: REQUEST_HEADERS,
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings_1',
    name: 'Acme Support',
    assistantConfig: structuredClone(CONFIG),
    assistantConfigRevision: 7,
    managedFieldPaths: [],
    featureFlags: JSON.stringify({
      assistantTools: true,
    }),
    ...overrides,
  }
}

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings_1',
    assistantConfig: structuredClone(CONFIG),
    assistantConfigRevision: 7,
    managedFieldPaths: [],
    ...overrides,
  } as NonNullable<typeof hoisted.txRow>
}

function committedSettingsWrites() {
  return hoisted.committedWrites.filter((write) => write.table === hoisted.settingsTable)
}

function committedPrincipalWrites() {
  return hoisted.committedWrites.filter((write) => write.table === hoisted.principalTable)
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.events.length = 0
  hoisted.committedWrites.length = 0
  hoisted.txRow = transactionRow()
  hoisted.requireSettings.mockResolvedValue(settingsRow())
  hoisted.invalidateSettingsCache.mockImplementation(async () => {
    hoisted.events.push('invalidate')
  })
  hoisted.recordAuditEventInTransaction.mockImplementation(async () => {
    hoisted.events.push('audit')
  })

  hoisted.transaction.mockImplementation(
    async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const stagedWrites: Array<{ table: unknown; values: Record<string, unknown> }> = []
      hoisted.events.push('begin')

      const tx = {
        select: (selection: unknown) => {
          hoisted.txSelect(selection)
          return {
            from: (_table: unknown) => ({
              limit: (_limit: number) => ({
                for: async (mode: string) => {
                  hoisted.txForUpdate(mode)
                  hoisted.events.push(`lock:${mode}`)
                  return hoisted.txRow ? [hoisted.txRow] : []
                },
              }),
            }),
          }
        },
        update: (table: unknown) => {
          hoisted.txUpdate(table)
          return {
            set: (values: Record<string, unknown>) => {
              hoisted.txSet(table, values)
              return {
                where: async (_condition: unknown) => {
                  stagedWrites.push({ table, values })
                  hoisted.events.push(
                    table === hoisted.settingsTable ? 'write:settings' : 'write:principal'
                  )
                },
              }
            },
          }
        },
      }

      try {
        const result = await callback(tx)
        hoisted.events.push('commit')
        hoisted.committedWrites.push(...stagedWrites)
        for (const write of stagedWrites) {
          if (write.table === hoisted.settingsTable && hoisted.txRow) {
            Object.assign(hoisted.txRow, write.values)
          }
        }
        return result
      } catch (error) {
        hoisted.events.push('rollback')
        throw error
      }
    }
  )
})

describe('V2 assistant configuration reads', () => {
  it('strictly returns the complete persisted config and revision without inventing defaults', async () => {
    const persisted = structuredClone(CONFIG)
    persisted.identity.name = 'Persisted Agent'
    hoisted.requireSettings.mockResolvedValue(
      settingsRow({
        assistantConfig: persisted,
        assistantConfigRevision: 19,
        managedFieldPaths: ['assistant.agents.agent.voice.tone'],
      })
    )

    await expect(getAssistantConfig()).resolves.toEqual({
      config: persisted,
      revision: 19,
    })
    await expect(getAssistantSettings()).resolves.toEqual({
      config: persisted,
      revision: 19,
      managedFieldPaths: ['assistant.agents.agent.voice.tone'],
    })
  })

  it('fails settings-page loads when persisted JSON is not a valid complete V2 config', async () => {
    hoisted.requireSettings.mockResolvedValue(
      settingsRow({ assistantConfig: '{"version":2,"identity":' })
    )

    await expect(getAssistantConfig()).rejects.toMatchObject({
      code: 'ASSISTANT_CONFIG_INVALID',
      statusCode: 500,
    })
    await expect(getAssistantSettings()).rejects.toMatchObject({
      code: 'ASSISTANT_CONFIG_INVALID',
      statusCode: 500,
    })
  })

  it('uses an explicit runtime fallback for invalid config while preserving runtime fields', async () => {
    hoisted.requireSettings.mockResolvedValue(
      settingsRow({
        assistantConfig: { version: 2, identity: { name: 'Incomplete' } },
        assistantConfigRevision: 23,
      })
    )

    const result = await getAssistantRuntimeConfig()
    expect(result).toEqual({
      config: DEFAULT_ASSISTANT_CONFIG,
      revision: 23,
      workspaceName: 'Acme Support',
      actionsEnabled: true,
      customActionsEnabled: false,
      configFallbackReason: 'invalid_assistant_config',
    })
    expect(result.config).not.toBe(DEFAULT_ASSISTANT_CONFIG)
  })
})

describe('V2 assistant configuration writes', () => {
  it('validates every complete section before writing', async () => {
    await expect(
      updateAssistantIdentity(7, { name: '   ', avatarUrl: null }, ACTOR)
    ).rejects.toThrow()
    await expect(
      updateAssistantVoice(
        7,
        {
          tone: 'sarcastic',
          responseLength: 'balanced',
          additionalInstructions: '',
        } as never,
        ACTOR
      )
    ).rejects.toThrow()

    expect(hoisted.txSet).not.toHaveBeenCalled()
    expect(hoisted.recordAuditEventInTransaction).not.toHaveBeenCalled()
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
  })

  it('locks the row and atomically writes the complete normalized config with an incremented revision', async () => {
    const result = await updateAssistantVoice(
      7,
      {
        tone: 'warm',
        responseLength: 'brief',
        additionalInstructions: '  Keep\ncalm.\u0000  ',
      },
      ACTOR
    )

    const expectedConfig: AssistantConfig = withVoice({
      tone: 'warm',
      responseLength: 'brief',
      additionalInstructions: 'Keep\ncalm.',
    })
    expect(hoisted.txForUpdate).toHaveBeenCalledOnce()
    expect(hoisted.txForUpdate).toHaveBeenCalledWith('update')
    expect(committedSettingsWrites()).toEqual([
      {
        table: hoisted.settingsTable,
        values: {
          assistantConfig: expectedConfig,
          assistantConfigRevision: 8,
        },
      },
    ])
    expect(result).toEqual({ config: expectedConfig, revision: 8 })
    expect(hoisted.events).toEqual([
      'begin',
      'lock:update',
      'write:settings',
      'audit',
      'commit',
      'invalidate',
    ])
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
  })

  it('preserves a prior section update when a later revision updates another section', async () => {
    const voiceResult = await updateAssistantVoice(7, { ...VOICE, tone: 'professional' }, ACTOR)
    const identityResult = await updateAssistantIdentity(
      voiceResult.revision,
      { name: 'Robin', avatarUrl: null },
      ACTOR
    )

    expect(identityResult).toEqual({
      config: {
        ...withVoice({ ...VOICE, tone: 'professional' }),
        identity: { name: 'Robin', avatarUrl: null },
      },
      revision: 9,
    })
    expect(committedSettingsWrites()).toHaveLength(2)
  })

  it('rejects a stale revision after locking without writing, auditing, or invalidating', async () => {
    hoisted.txRow = transactionRow({ assistantConfigRevision: 8 })

    await expect(
      updateAssistantVoice(7, { ...VOICE, tone: 'professional' }, ACTOR)
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CONFIG_REVISION_CONFLICT',
      statusCode: 409,
    })

    expect(hoisted.txForUpdate).toHaveBeenCalledWith('update')
    expect(hoisted.txSet).not.toHaveBeenCalled()
    expect(hoisted.recordAuditEventInTransaction).not.toHaveBeenCalled()
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
    expect(hoisted.events).toEqual(['begin', 'lock:update', 'rollback'])
  })

  it('rejects changes to a managed path before writing', async () => {
    hoisted.txRow = transactionRow({ managedFieldPaths: ['assistant.agents.agent.voice'] })

    await expect(
      updateAssistantVoice(7, { ...VOICE, tone: 'professional' }, ACTOR)
    ).rejects.toMatchObject({ code: 'MANAGED_SETTING', statusCode: 403 })

    expect(hoisted.txSet).not.toHaveBeenCalled()
    expect(hoisted.recordAuditEventInTransaction).not.toHaveBeenCalled()
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
  })

  it('audits instruction changes by path and revision without storing instruction bodies', async () => {
    const nextInstructions = 'Never quote internal guidance.'
    await updateAssistantVoice(7, { ...VOICE, additionalInstructions: nextInstructions }, ACTOR)

    expect(hoisted.recordAuditEventInTransaction).toHaveBeenCalledWith(expect.anything(), {
      event: 'assistant.instructions.changed',
      actor: { email: 'admin@example.com', role: 'admin', type: 'user' },
      headers: REQUEST_HEADERS,
      target: { type: 'settings', id: 'settings_1' },
      metadata: {
        changedPaths: ['agents.agent.voice.additionalInstructions'],
        previousRevision: 7,
        revision: 8,
        transitions: [],
      },
    })
    const auditPayload = hoisted.recordAuditEventInTransaction.mock.calls[0]?.[1]
    expect(JSON.stringify(auditPayload)).not.toContain(VOICE.additionalInstructions)
    expect(JSON.stringify(auditPayload)).not.toContain(nextInstructions)
  })

  it('synchronizes the assistant principal identity and keeps names out of the audit payload', async () => {
    const identity = {
      name: 'Customer Care Agent',
      avatarUrl: 'https://cdn.example.test/customer-care.png',
    }
    await updateAssistantIdentity(7, identity, ACTOR)

    expect(committedPrincipalWrites()).toEqual([
      {
        table: hoisted.principalTable,
        values: {
          displayName: identity.name,
          avatarUrl: identity.avatarUrl,
        },
      },
    ])
    const auditPayload = hoisted.recordAuditEventInTransaction.mock.calls[0]?.[1] as {
      event: string
      metadata: { changedPaths: string[]; transitions: unknown[] }
    }
    expect(auditPayload.event).toBe('assistant.identity.changed')
    expect(auditPayload.metadata.changedPaths).toEqual(['identity.avatarUrl', 'identity.name'])
    expect(auditPayload.metadata.transitions).toEqual([])
    expect(JSON.stringify(auditPayload)).not.toContain(CONFIG.identity.name)
    expect(JSON.stringify(auditPayload)).not.toContain(identity.name)
  })

  it('rolls back staged config writes when the in-transaction audit insert fails', async () => {
    hoisted.recordAuditEventInTransaction.mockImplementationOnce(async () => {
      hoisted.events.push('audit')
      throw new Error('audit insert failed')
    })

    await expect(
      updateAssistantVoice(7, { ...VOICE, tone: 'professional' }, ACTOR)
    ).rejects.toThrow('audit insert failed')

    expect(hoisted.txSet).toHaveBeenCalled()
    expect(hoisted.committedWrites).toEqual([])
    expect(hoisted.txRow?.assistantConfigRevision).toBe(7)
    expect(hoisted.events).toEqual(['begin', 'lock:update', 'write:settings', 'audit', 'rollback'])
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
  })

  it('does not write, audit, increment, or invalidate for a normalized no-op', async () => {
    await expect(updateAssistantVoice(7, structuredClone(VOICE), ACTOR)).resolves.toEqual({
      config: CONFIG,
      revision: 7,
    })

    expect(hoisted.committedWrites).toEqual([])
    expect(hoisted.recordAuditEventInTransaction).not.toHaveBeenCalled()
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
    expect(hoisted.events).toEqual(['begin', 'lock:update', 'commit'])
  })

  it('writes an Agent knowledge change under the knowledge audit event', async () => {
    const result = await updateAssistantAgentKnowledge(
      7,
      { agent: 'agent', knowledge: { ...CONFIG.agents.agent.knowledge, posts: true } },
      ACTOR
    )

    expect(result.config.agents.agent.knowledge.posts).toBe(true)
    const auditPayload = hoisted.recordAuditEventInTransaction.mock.calls[0]?.[1] as {
      event: string
      metadata: { changedPaths: string[] }
    }
    expect(auditPayload.event).toBe('assistant.knowledge.changed')
    expect(auditPayload.metadata.changedPaths).toEqual(['agents.agent.knowledge.posts'])
  })

  it('writes a Copilot capability change under the capabilities audit event', async () => {
    const result = await updateAssistantCopilotCapabilities(
      7,
      { ...CONFIG.agents.copilot.capabilities, qa: false },
      ACTOR
    )

    expect(result.config.agents.copilot.capabilities.qa).toBe(false)
    const auditPayload = hoisted.recordAuditEventInTransaction.mock.calls[0]?.[1] as {
      event: string
      metadata: { changedPaths: string[] }
    }
    expect(auditPayload.event).toBe('assistant.capabilities.changed')
    expect(auditPayload.metadata.changedPaths).toEqual(['agents.copilot.capabilities.qa'])
  })
})
