import { beforeEach, expect, it, vi } from 'vitest'
import { SLACK_REQUIRED_SCOPES } from '../../../scopes'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  apiCall: vi.fn(),
  ephemeral: vi.fn(),
  replies: vi.fn(),
  chatStream: vi.fn(),
  runtime: vi.fn(),
  runAssistantTurn: vi.fn(),
  endSlackTurn: vi.fn(),
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: { query: { integrations: { findFirst: mocks.read } } },
}))
vi.mock('@/lib/server/integrations/encryption', async (original) => ({
  ...(await original<typeof import('@/lib/server/integrations/encryption')>()),
  decryptSecrets: JSON.parse,
}))
vi.mock('@slack/web-api', () => ({
  WebClient: class {
    apiCall = mocks.apiCall
    chat = { postEphemeral: mocks.ephemeral }
    conversations = { replies: mocks.replies }
    chatStream = mocks.chatStream
  },
}))
vi.mock('@/lib/server/domains/settings/settings.assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantRuntimeConfig: mocks.runtime,
}))
vi.mock('@/lib/server/domains/assistant/assistant.runtime', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/assistant/assistant.runtime')>()),
  isAssistantConfigured: () => true,
  runAssistantTurn: mocks.runAssistantTurn,
}))
vi.mock('@/lib/server/domains/settings/cloud/entitlements', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/cloud/entitlements')>()),
  hasEntitlement: async () => true,
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/tier-enforce')>()),
  enforceAiTokenBudget: async () => {},
}))
vi.mock('@/lib/server/domains/assistant/assistant.principal', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/assistant/assistant.principal')>()),
  ensureAssistantPrincipal: async () => ({ id: 'prin_assistant' }),
}))
vi.mock('../identity', async (original) => ({
  ...(await original<typeof import('../identity')>()),
  resolveSlackPrincipal: async () => ({ id: 'prin_user', role: 'admin', displayName: 'Ada' }),
  slackMemberActor: async () => ({
    principalId: 'prin_user',
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(['copilot.use']),
  }),
}))
vi.mock('../sessions', async (original) => ({
  ...(await original<typeof import('../sessions')>()),
  slackThreadSessionIsActive: async () => ({ active: false, lastSpeaker: 'none' }),
}))
vi.mock('../turns', async (original) => {
  const actual = await original<typeof import('../turns')>()
  return {
    ...actual,
    endSlackTurn: (...args: Parameters<typeof actual.endSlackTurn>) => {
      mocks.endSlackTurn(...args)
      return actual.endSlackTurn(...args)
    },
  }
})

import { handleSlackHookJob } from '../handler'
import { abortSlackTurn } from '../turns'

const installed = {
  id: 'install',
  status: 'active',
  config: {
    workspaceId: 'T1',
    botUserId: 'Ubot',
    scopes: SLACK_REQUIRED_SCOPES.join(','),
  },
  secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
}
const job = {
  payload: {
    kind: 'events',
    encryptedPayload: JSON.stringify({
      team_id: 'T1',
      event_id: 'EvAsk',
      event: {
        type: 'app_mention',
        channel: 'C1',
        thread_ts: '1.2',
        ts: '1.3',
        user: 'U1',
        text: '<@Ubot> hello',
      },
    }),
  },
} as never

beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue(installed)
  mocks.apiCall.mockResolvedValue({ ok: true })
  mocks.ephemeral.mockResolvedValue({ ok: true })
  mocks.replies.mockResolvedValue({ messages: [] })
  mocks.runtime.mockResolvedValue({
    config: {
      agents: { workspace: { slack: { enabled: true }, capabilities: { qa: true } } },
      identity: { name: 'Quinn' },
    },
    workspaceName: 'Acme',
  })
})

it('ends the turn and sets the session active when Stop aborts during preflight', async () => {
  let finishProcessing!: (value: unknown) => void
  const processing = new Promise((resolve) => {
    finishProcessing = resolve
  })
  mocks.apiCall.mockImplementation((method: string, args: { status?: string }) => {
    if (method === 'agents.sessions.setStatus' && args.status === 'processing') return processing
    return Promise.resolve({ ok: true })
  })

  const running = handleSlackHookJob(job)
  await vi.waitFor(() =>
    expect(mocks.apiCall).toHaveBeenCalledWith(
      'agents.sessions.setStatus',
      expect.objectContaining({ status: 'processing' })
    )
  )
  abortSlackTurn('T1', 'C1', '1.2')
  finishProcessing({ ok: true })
  await running

  expect(mocks.runAssistantTurn).not.toHaveBeenCalled()
  expect(mocks.endSlackTurn).toHaveBeenCalledWith('T1', 'C1', '1.2', expect.any(AbortController))
  expect(mocks.apiCall).toHaveBeenCalledWith(
    'agents.sessions.setStatus',
    expect.objectContaining({
      channel_id: 'C1',
      thread_ts: '1.2',
      status: 'active',
    })
  )
})
