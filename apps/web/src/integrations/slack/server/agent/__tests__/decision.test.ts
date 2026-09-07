import { beforeEach, expect, it, vi } from 'vitest'
import { generateId } from '@quackback/ids'
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  actor: vi.fn(),
  pending: vi.fn(),
  decide: vi.fn(),
  spec: vi.fn(),
  can: vi.fn(),
}))
vi.mock('../identity', () => ({
  resolveSlackPrincipal: mocks.resolve,
  slackMemberActor: mocks.actor,
}))
vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  getPendingActionById: mocks.pending,
}))
vi.mock('@/lib/server/functions/assistant-actions', () => ({ decideAssistantAction: mocks.decide }))
vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  getToolSpecByName: mocks.spec,
}))
vi.mock('@/lib/server/domains/assistant/connectors/connector-tools', () => ({
  getConnectorSpecByToolName: async () => null,
}))
vi.mock('@/lib/server/domains/assistant/mcp-workspace-tools', () => ({
  getWorkspaceMcpSpecByName: async () => null,
}))
vi.mock('@/lib/server/policy/authorize', () => ({ can: mocks.can }))
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantRuntimeConfig: async () => ({
    config: { identity: { name: 'Quinn' } },
    workspaceName: 'Test',
  }),
}))
import { handleSlackDecision } from '../handler'
const id = generateId('assistant_action')
const member = { id: generateId('principal'), role: 'member' }
const actor = { principalId: member.id }
const payload = {
  user: { id: 'U' },
  channel: { id: 'C' },
  message: { ts: '2', thread_ts: '1', blocks: [] },
  actions: [{ action_id: 'qb_action_approve', value: id }],
}
const client = { chat: { postEphemeral: vi.fn(), update: vi.fn() } } as any
beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolve.mockResolvedValue(member)
  mocks.actor.mockResolvedValue(actor)
  mocks.pending.mockResolvedValue({
    id,
    originRole: 'workspace_assistant',
    workspaceThreadKey: JSON.stringify(['T', 'C', '1']),
    toolName: 'create_post',
  })
  mocks.spec.mockReturnValue({
    name: 'create_post',
    risk: 'write',
    permissions: ['post.create'],
  })
  mocks.can.mockReturnValue(true)
  mocks.decide.mockResolvedValue({ status: 'executed', result: {} })
})
it('refuses unlinked actors before loading or executing a proposal', async () => {
  mocks.resolve.mockResolvedValue(null)
  await handleSlackDecision(payload, client, 'T')
  expect(mocks.pending).not.toHaveBeenCalled()
  expect(mocks.decide).not.toHaveBeenCalled()
  expect(client.chat.postEphemeral).toHaveBeenCalled()
})
it.each(['qb_action_approve', 'qb_action_reject'])(
  'enforces the acting member permission for %s',
  async (action_id) => {
    mocks.can.mockReturnValue(false)
    await handleSlackDecision({ ...payload, actions: [{ action_id, value: id }] }, client, 'T')
    expect(mocks.decide).not.toHaveBeenCalled()
  }
)
it('cannot transplant a proposal to a different Slack team, channel, or thread', async () => {
  await handleSlackDecision(payload, client, 'other')
  await handleSlackDecision({ ...payload, channel: { id: 'other' } }, client, 'T')
  await handleSlackDecision(
    { ...payload, message: { ...payload.message, thread_ts: 'other' } },
    client,
    'T'
  )
  expect(mocks.decide).not.toHaveBeenCalled()
})
it('executes through the shared approval service with the member actor', async () => {
  await handleSlackDecision(payload, client, 'T')
  expect(mocks.decide).toHaveBeenCalledWith(id, 'approved', member.id, actor)
  expect(client.chat.update).toHaveBeenCalled()
})
it('retries a failed Slack update from the settled result without re-executing the write', async () => {
  const pending = await mocks.pending()
  client.chat.update.mockRejectedValueOnce(new Error('Slack unavailable'))
  await expect(handleSlackDecision(payload, client, 'T')).rejects.toThrow('Slack unavailable')
  expect(mocks.decide).toHaveBeenCalledOnce()
  expect(client.chat.postEphemeral).not.toHaveBeenCalled()
  mocks.pending.mockResolvedValue({
    ...pending,
    status: 'executed',
    result: {},
    decidedById: member.id,
  })
  await handleSlackDecision(payload, client, 'T')
  expect(mocks.decide).toHaveBeenCalledOnce()
  expect(client.chat.update).toHaveBeenCalledTimes(2)
  expect(client.chat.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'Approved by <@U>' })
  )
})

it('repairs a terminal proposal presentation after decision permissions are removed', async () => {
  const pending = await mocks.pending()
  mocks.pending.mockResolvedValue({
    ...pending,
    status: 'executed',
    result: {},
    decidedById: member.id,
  })
  mocks.can.mockReturnValue(false)
  await handleSlackDecision(payload, client, 'T')
  expect(mocks.decide).not.toHaveBeenCalled()
  expect(client.chat.update).toHaveBeenCalledOnce()
  expect(client.chat.postEphemeral).not.toHaveBeenCalled()
})
