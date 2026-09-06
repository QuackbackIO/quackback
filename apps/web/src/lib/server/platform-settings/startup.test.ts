import { it, expect, vi } from 'vitest'
import { loadCloudEnvironment } from './startup'
import { overlayPlatformSettings } from '@/lib/shared/platform-settings'
const environment = {
  QUACKBACK_TENANCY: 'pooled',
  QUACKBACK_CONTROL_PLANE_URL: 'https://cp.example.com',
  QUACKBACK_CP_SETTINGS_TOKEN: 'k'.repeat(32),
  OPENAI_API_KEY: 'env-key',
  EMAIL_FROM: 'env@example.com',
}
function deps(settings: unknown) {
  return {
    fetch: vi.fn().mockResolvedValue(Response.json({ settings, revision: 2 })),
    pause: vi.fn().mockResolvedValue(undefined),
  }
}
it('skips CP completely for self-hosted containers', async () => {
  const d = deps({})
  const env = { OPENAI_API_KEY: 'local' }
  expect(await loadCloudEnvironment(env, d)).toEqual(env)
  expect(d.fetch).not.toHaveBeenCalled()
})
it('overlays CP values, preserves absent env keys, handles falsy values and explicit removal', async () => {
  const d = deps({
    OPENAI_API_KEY: 'cp-key',
    PORT: 4000,
    AI_ASSISTANT_VISION: false,
    EMPTY: '',
    REMOVE: null,
  })
  const result = await loadCloudEnvironment({ ...environment, REMOVE: 'old' }, d)
  expect(result).toMatchObject({
    OPENAI_API_KEY: 'cp-key',
    EMAIL_FROM: 'env@example.com',
    PORT: '4000',
    AI_ASSISTANT_VISION: 'false',
    EMPTY: '',
  })
  expect(result).not.toHaveProperty('REMOVE')
  expect(environment.OPENAI_API_KEY).toBe('env-key')
  expect(d.fetch).toHaveBeenCalledTimes(1)
  expect(d.fetch.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'manual',
    headers: { authorization: 'Bearer ' + environment.QUACKBACK_CP_SETTINGS_TOKEN },
  })
})
it('takes a fresh snapshot on the next container start', async () => {
  const d = deps({ OPENAI_API_KEY: 'first' })
  const first = await loadCloudEnvironment(environment, d)
  d.fetch.mockResolvedValue(Response.json({ settings: { OPENAI_API_KEY: 'second' }, revision: 3 }))
  expect(first.OPENAI_API_KEY).toBe('first')
  expect((await loadCloudEnvironment(environment, d)).OPENAI_API_KEY).toBe('second')
})
it.each([
  'QUACKBACK_TENANCY',
  'QUACKBACK_ROLE',
  'QUACKBACK_CONTROL_PLANE_URL',
  'QUACKBACK_CP_SETTINGS_TOKEN',
  'QUACKBACK_FLEET_ROOT_KEY',
  'QUACKBACK_CONTROL_DATABASE_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'NODE_OPTIONS',
  'PATH',
  'LD_PRELOAD',
])('rejects bootstrap/runtime overrides atomically: %s', (key) => {
  expect(() =>
    overlayPlatformSettings(environment, { OPENAI_API_KEY: 'new', [key]: 'bad' })
  ).toThrow()
  expect(environment.OPENAI_API_KEY).toBe('env-key')
})
it.each([null, [], { bad_key: 'x' }, { SETTINGS: {} }, { VALUE: 'a\0b' }])(
  'refuses malformed snapshots',
  async (settings) => {
    await expect(loadCloudEnvironment(environment, deps(settings))).rejects.toThrow(
      'response is invalid'
    )
  }
)
it('retries temporary failures and refuses to boot after exhaustion', async () => {
  const d = deps({})
  d.fetch.mockRejectedValue(new Error('do not expose this secret'))
  await expect(loadCloudEnvironment(environment, d)).rejects.toThrow('startup refused')
  expect(d.fetch).toHaveBeenCalledTimes(3)
})
it('never follows redirects or retries authentication failures', async () => {
  for (const status of [302, 401, 403]) {
    const d = deps({})
    d.fetch.mockResolvedValue(new Response(null, { status }))
    await expect(loadCloudEnvironment(environment, d)).rejects.toThrow('HTTP ' + status)
    expect(d.fetch).toHaveBeenCalledTimes(1)
  }
})
it('rejects invalid bootstrap configuration before fetching', async () => {
  const d = deps({})
  await expect(
    loadCloudEnvironment(
      { ...environment, QUACKBACK_CONTROL_PLANE_URL: 'http://cp.example.com' },
      d
    )
  ).rejects.toThrow('HTTPS')
  await expect(
    loadCloudEnvironment({ ...environment, QUACKBACK_CP_SETTINGS_TOKEN: '' }, d)
  ).rejects.toThrow('TOKEN')
  expect(d.fetch).not.toHaveBeenCalled()
})
