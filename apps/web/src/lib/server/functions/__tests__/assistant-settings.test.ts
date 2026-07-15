import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantConfig } from '@/lib/shared/assistant/config'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
  actorFromAuth: vi.fn(),
  getAssistantSettings: vi.fn(),
  updateAssistantIdentity: vi.fn(),
  updateAssistantVoice: vi.fn(),
  updateWidgetAssistantDeployment: vi.fn(),
  requestHeaders: new Headers({
    'user-agent': 'assistant-settings-test',
    'x-request-id': 'request_1',
  }),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantSettings: hoisted.getAssistantSettings,
  updateAssistantIdentity: hoisted.updateAssistantIdentity,
  updateAssistantVoice: hoisted.updateAssistantVoice,
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  updateWidgetAssistantDeployment: hoisted.updateWidgetAssistantDeployment,
}))

vi.mock('@/lib/server/audit/log', () => ({
  actorFromAuth: hoisted.actorFromAuth,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => hoisted.requestHeaders,
}))

import {
  getAssistantSettingsFn,
  updateAssistantIdentityFn,
  updateAssistantVoiceFn,
  updateWidgetAssistantDeploymentFn,
} from '../assistant-settings'

const CONFIG: AssistantConfig = {
  version: 3,
  identity: { name: 'Quinn', avatarUrl: null },
  agents: {
    agent: {
      voice: { tone: 'balanced', responseLength: 'balanced', additionalInstructions: '' },
      knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
    },
    copilot: {
      capabilities: { qa: true, suggestedReplies: true },
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

const SETTINGS_RESULT = {
  config: CONFIG,
  revision: 41,
  managedFieldPaths: ['assistant.agents.agent.voice.tone'],
}

const CONFIG_RESULT = {
  config: {
    ...CONFIG,
    agents: {
      ...CONFIG.agents,
      agent: {
        ...CONFIG.agents.agent,
        voice: { ...CONFIG.agents.agent.voice, tone: 'professional' as const },
      },
    },
  },
  revision: 42,
}

const AUTH_CONTEXT = {
  user: { id: 'user_admin', email: 'admin@example.com' },
  principal: { id: 'principal_admin', role: 'admin', type: 'user' },
}

const AUDIT_ACTOR = {
  userId: 'user_admin',
  email: 'admin@example.com',
  role: 'admin',
  type: 'user',
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH_CONTEXT)
  hoisted.actorFromAuth.mockReturnValue(AUDIT_ACTOR)
  hoisted.getAssistantSettings.mockResolvedValue(SETTINGS_RESULT)
  hoisted.updateAssistantIdentity.mockResolvedValue(CONFIG_RESULT)
  hoisted.updateAssistantVoice.mockResolvedValue(CONFIG_RESULT)
  hoisted.updateWidgetAssistantDeployment.mockResolvedValue({ enabled: true, respond: true })
})

describe('assistant settings permission gates', () => {
  it('requires assistant.manage for the query, every config mutation, and deployment', async () => {
    await getAssistantSettingsFn()
    await updateAssistantIdentityFn({
      data: {
        expectedRevision: 41,
        identity: CONFIG.identity,
      },
    })
    await updateAssistantVoiceFn({
      data: {
        expectedRevision: 41,
        voice: CONFIG.agents.agent.voice,
      },
    })
    await updateWidgetAssistantDeploymentFn({ data: { enabled: true, respond: true } })

    expect(hoisted.requireAuth).toHaveBeenCalledTimes(4)
    for (const call of hoisted.requireAuth.mock.calls) {
      expect(call[0]).toEqual({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    }
  })

  it('propagates auth rejection without reaching a settings domain mutation', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))

    await expect(
      updateAssistantVoiceFn({
        data: { expectedRevision: 41, voice: CONFIG.agents.agent.voice },
      })
    ).rejects.toThrow('Access denied')
    expect(hoisted.updateAssistantVoice).not.toHaveBeenCalled()
  })
})

describe('assistant settings V2 boundary', () => {
  it('returns the complete config, revision, and managed paths from the strict read', async () => {
    await expect(getAssistantSettingsFn()).resolves.toEqual(SETTINGS_RESULT)
    expect(hoisted.getAssistantSettings).toHaveBeenCalledOnce()
  })

  it('rejects invalid identity, voice, revisions, and deployment input', async () => {
    await expect(
      updateAssistantIdentityFn({
        data: {
          expectedRevision: 41,
          identity: { name: ' ', avatarUrl: null },
        },
      })
    ).rejects.toThrow()
    await expect(
      updateAssistantVoiceFn({
        data: {
          expectedRevision: 41,
          voice: {
            tone: 'balanced',
            responseLength: 'balanced',
            additionalInstructions: 'x'.repeat(2_001),
          },
        },
      })
    ).rejects.toThrow()
    await expect(
      updateAssistantVoiceFn({
        data: {
          expectedRevision: 0,
          voice: {
            tone: 'balanced',
            responseLength: 'balanced',
            additionalInstructions: '',
          },
        },
      })
    ).rejects.toThrow()
    await expect(
      updateWidgetAssistantDeploymentFn({
        data: { enabled: true, respond: 'yes' } as never,
      })
    ).rejects.toThrow()

    expect(hoisted.updateAssistantIdentity).not.toHaveBeenCalled()
    expect(hoisted.updateAssistantVoice).not.toHaveBeenCalled()
    expect(hoisted.updateWidgetAssistantDeployment).not.toHaveBeenCalled()
  })

  it('propagates expectedRevision and returns complete config state for every section mutation', async () => {
    const identity = {
      name: 'Avery',
      avatarUrl: 'https://cdn.example.test/avery.png',
    }
    const voice = {
      tone: 'professional' as const,
      responseLength: 'detailed' as const,
      additionalInstructions: 'Explain the next step.',
    }
    const actor = { ...AUDIT_ACTOR, headers: hoisted.requestHeaders }

    await expect(
      updateAssistantIdentityFn({ data: { expectedRevision: 41, identity } })
    ).resolves.toEqual(CONFIG_RESULT)
    await expect(
      updateAssistantVoiceFn({ data: { expectedRevision: 41, voice } })
    ).resolves.toEqual(CONFIG_RESULT)

    expect(hoisted.updateAssistantIdentity).toHaveBeenCalledWith(41, identity, actor)
    expect(hoisted.updateAssistantVoice).toHaveBeenCalledWith(41, voice, actor)
  })

  it('normalizes identity input at the server boundary before delegation', async () => {
    await updateAssistantIdentityFn({
      data: {
        expectedRevision: 41,
        identity: {
          name: '  Avery  ',
          avatarUrl: '  https://cdn.example.test/avery.png  ',
        },
      },
    })

    expect(hoisted.updateAssistantIdentity).toHaveBeenCalledWith(
      41,
      {
        name: 'Avery',
        avatarUrl: 'https://cdn.example.test/avery.png',
      },
      expect.objectContaining(AUDIT_ACTOR)
    )
  })

  it('keeps widget deployment separate and forwards the authenticated audit actor', async () => {
    await expect(
      updateWidgetAssistantDeploymentFn({ data: { enabled: true, respond: true } })
    ).resolves.toEqual({ enabled: true, respond: true })

    expect(hoisted.updateWidgetAssistantDeployment).toHaveBeenCalledWith(
      { enabled: true, respond: true },
      { ...AUDIT_ACTOR, headers: hoisted.requestHeaders }
    )
  })
})
