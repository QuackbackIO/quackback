import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  apiCall: vi.fn(),
  ephemeral: vi.fn(),
  runtime: vi.fn(),
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
  },
}))
vi.mock('@/lib/server/domains/settings/settings.assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantRuntimeConfig: mocks.runtime,
}))
import { handleSlackHookJob } from '../handler'

const installed = {
  id: 'install',
  status: 'active',
  config: { workspaceId: 'T1', botUserId: 'Ubot', scopes: 'chat:write,assistant:write' },
  secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
}
const job = {
  payload: {
    kind: 'events',
    encryptedPayload: JSON.stringify({
      team_id: 'T1',
      event_id: 'EvStop',
      event: {
        type: 'agent_session_stopped',
        channel: 'C1',
        thread_ts: '1.2',
        user: 'U1',
        streaming_message_ts: ['1.3'],
      },
    }),
  },
} as never

beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue(installed)
  mocks.apiCall.mockResolvedValue({ ok: true })
  mocks.ephemeral.mockResolvedValue({ ok: true })
  mocks.runtime.mockResolvedValue({
    config: { identity: { name: 'Quinn' } },
    workspaceName: 'Acme',
  })
})

it('sets the agent session active and confirms when the user hits Stop', async () => {
  await handleSlackHookJob(job)
  expect(mocks.apiCall).toHaveBeenCalledWith(
    'agents.sessions.setStatus',
    expect.objectContaining({
      channel_id: 'C1',
      thread_ts: '1.2',
      status: 'active',
    })
  )
  expect(mocks.ephemeral).toHaveBeenCalledWith(
    expect.objectContaining({ channel: 'C1', user: 'U1', text: 'Okay — I stopped.' })
  )
})
