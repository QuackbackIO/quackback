import { beforeEach, it, expect, vi } from 'vitest'
import { generateId } from '@quackback/ids'
import { resolveSlackPrincipal, type SlackIdentityDeps } from '../identity'
const person = { id: generateId('principal'), role: 'member' as const, displayName: 'Member' }
const deps: SlackIdentityDeps = { linked: vi.fn(), byEmail: vi.fn(), link: vi.fn() }
const info = vi.fn()
const client = { users: { info } } as any
beforeEach(() => {
  vi.resetAllMocks()
  info.mockResolvedValue({ ok: true, user: { profile: { email: 'USER@example.com' } } })
})
it('reuses links without Slack lookup and refuses invalidated membership', async () => {
  vi.mocked(deps.linked).mockResolvedValueOnce(person).mockResolvedValueOnce(null)
  expect(await resolveSlackPrincipal('T', 'U', client, deps)).toEqual(person)
  expect(await resolveSlackPrincipal('T', 'U', client, deps)).toBeNull()
  expect(info).not.toHaveBeenCalled()
})
it('links a verified matching member and reads the persisted race winner', async () => {
  vi.mocked(deps.linked).mockResolvedValueOnce(undefined).mockResolvedValueOnce(person)
  vi.mocked(deps.byEmail).mockResolvedValue(person)
  expect(await resolveSlackPrincipal('T', 'U', client, deps)).toEqual(person)
  expect(deps.link).toHaveBeenCalledWith('T', 'U', person.id)
})
it('refuses unmatched users and bots', async () => {
  vi.mocked(deps.linked).mockResolvedValue(undefined)
  vi.mocked(deps.byEmail).mockResolvedValue(null)
  expect(await resolveSlackPrincipal('T', 'U', client, deps)).toBeNull()
  info.mockResolvedValue({
    ok: true,
    user: { is_bot: true, profile: { email: 'USER@example.com' } },
  })
  expect(await resolveSlackPrincipal('T', 'U', client, deps)).toBeNull()
  expect(deps.link).not.toHaveBeenCalled()
})
