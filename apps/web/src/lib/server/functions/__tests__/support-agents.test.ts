import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { RecentSignInRequiredError } from '@/lib/shared/recent-sign-in'

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  recent: vi.fn(),
  available: vi.fn(),
  register: vi.fn(),
  update: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
  mode: vi.fn(),
  saveMode: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | undefined
    return {
      validator(next: typeof schema) {
        schema = next
        return this
      },
      handler(handler: (args: { data: unknown }) => unknown) {
        return (args = { data: undefined }) =>
          handler({ data: schema ? schema.parse(args.data) : args.data })
      },
    }
  },
}))
vi.mock('../auth-helpers', () => ({ requireAuth: state.auth }))
vi.mock('@/lib/server/auth/recent-sign-in', () => ({ requireRecentSignIn: state.recent }))
vi.mock('@/lib/server/domains/support-agents/availability', () => ({
  assertOwnAgentAvailable: state.available,
}))
vi.mock('@/lib/server/domains/support-agents/support-agents.service', () => ({
  getExternalSupportAgent: state.get,
  registerExternalAgent: state.register,
  updateExternalAgent: state.update,
  rotateExternalAgentSecrets: state.rotate,
  deleteExternalAgent: state.remove,
  toSupportAgentView: (agent: { id: string; status: string }) => ({
    id: agent.id,
    status: agent.status,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.answering', () => ({
  getAnswering: state.mode,
  updateAnswering: state.saveMode,
}))
import { getSupportAgentConfigFn, manageSupportAgentFn, updateAnsweringFn } from '../support-agents'
const create = {
  action: 'create' as const,
  name: 'Acme AI',
  endpointUrl: 'https://agent.acme.test/turn',
  replyDeadlineSeconds: 20,
  fallback: 'team' as const,
}
beforeEach(() => {
  vi.resetAllMocks()
  state.auth.mockResolvedValue({ principal: { role: 'admin' }, user: { id: 'you' } })
  state.get.mockResolvedValue({
    id: 'agent',
    status: 'active',
    credentialHash: 'private',
    signingSecretEnc: 'private',
  })
  state.register.mockResolvedValue({
    agent: { id: 'agent', status: 'active' },
    credential: 'qba_secret',
    signingSecret: 'whsec_secret',
  })
  state.mode.mockResolvedValue({ mode: 'quackback_ai' })
})
describe('own-agent management boundaries', () => {
  it('requires the API credential permission before reading configuration', async () => {
    const result = await getSupportAgentConfigFn()
    expect(state.auth).toHaveBeenCalledWith({ permission: PERMISSIONS.API_KEY_MANAGE })
    expect(result.agent).toEqual({ id: 'agent', status: 'active' })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('refuses an unauthenticated registration without creating an agent', async () => {
    state.auth.mockRejectedValue(new Error('Authentication required'))
    await expect(manageSupportAgentFn({ data: create })).rejects.toThrow('Authentication required')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('requires an admin even when a member holds the API credential permission', async () => {
    state.auth.mockResolvedValue({ principal: { role: 'member' } })
    await expect(manageSupportAgentFn({ data: create })).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
    })
    expect(state.register).not.toHaveBeenCalled()
  })
  it('returns a sign-in refusal without generating secrets', async () => {
    state.recent.mockRejectedValue(new RecentSignInRequiredError())
    expect(await manageSupportAgentFn({ data: create })).toMatchObject({
      ok: false,
      code: 'RECENT_SIGN_IN_REQUIRED',
    })
    expect(state.register).not.toHaveBeenCalled()
  })
  it('refuses registration when Labs or the paid-plan gate refuses it', async () => {
    state.available.mockRejectedValue(new Error('Not available'))
    await expect(manageSupportAgentFn({ data: create })).rejects.toThrow('Not available')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('returns newly issued secrets only in the successful creation response', async () => {
    expect(await manageSupportAgentFn({ data: create })).toMatchObject({
      ok: true,
      credential: 'qba_secret',
      signingSecret: 'whsec_secret',
    })
    expect(state.recent).toHaveBeenCalled()
  })
  it('does not choose an unavailable agent as the answerer', async () => {
    state.get.mockResolvedValue(null)
    await expect(updateAnsweringFn({ data: { mode: 'own_agent' } })).rejects.toMatchObject({
      code: 'AGENT_NOT_READY',
    })
    expect(state.saveMode).not.toHaveBeenCalled()
  })
  it('does not change who receives customer conversations from a stale session', async () => {
    state.recent.mockRejectedValue(new RecentSignInRequiredError())
    expect(await updateAnsweringFn({ data: { mode: 'own_agent' } })).toMatchObject({
      ok: false,
      code: 'RECENT_SIGN_IN_REQUIRED',
    })
    expect(state.saveMode).not.toHaveBeenCalled()
  })
  it('allows a workspace admin to choose the human team explicitly', async () => {
    await updateAnsweringFn({ data: { mode: 'team' } })
    expect(state.auth).toHaveBeenCalledWith({ permission: PERMISSIONS.SETTINGS_MANAGE })
    expect(state.saveMode).toHaveBeenCalledWith({ mode: 'team' })
  })
})
