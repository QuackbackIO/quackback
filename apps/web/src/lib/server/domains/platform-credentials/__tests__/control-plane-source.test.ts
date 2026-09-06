import { it, expect, vi } from 'vitest'
import { ControlPlaneCredentialSource } from '../control-plane-source'
import { CLOUD_INTEGRATION_FIELDS } from '@/lib/shared/integration-credentials'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
it('reads changed credentials again and strips undeclared fields', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      credentials: {
        clientId: 'one',
        clientSecret: 'secret',
        signingSecret: 'signing',
        extra: 'never',
      },
    })
    .mockResolvedValueOnce({
      credentials: { clientId: 'two', clientSecret: 'secret', signingSecret: 'signing' },
    })
  const source = new ControlPlaneCredentialSource(request)
  expect(await source.get('slack')).toEqual({
    clientId: 'one',
    clientSecret: 'secret',
    signingSecret: 'signing',
  })
  expect((await source.get('slack'))?.clientId).toBe('two')
})
it('fails closed on outage, missing provider, and malformed credentials', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ credentials: null })
    .mockResolvedValueOnce({ credentials: { clientId: 'id' } })
  const source = new ControlPlaneCredentialSource(request)
  await expect(source.get('slack')).rejects.toThrow('unavailable')
  expect(await source.get('slack')).toBeNull()
  await expect(source.get('slack')).rejects.toThrow('Invalid Cloud')
  expect(await source.get('__proto__')).toBeNull()
})
it('discovery accepts only shared app names', async () => {
  const source = new ControlPlaneCredentialSource(
    vi.fn().mockResolvedValue({ providers: ['slack', 'auth_sso', '__proto__'] })
  )
  expect(await source.listConfigured()).toEqual(['slack'])
  expect(Object.keys(CLOUD_INTEGRATION_FIELDS)).toHaveLength(16)
})
it('pins the CP catalogue contract', () => {
  expect(
    createHash('sha256')
      .update(readFileSync('apps/web/src/lib/shared/integration-credentials.ts'))
      .digest('hex')
  ).toBe('d6725ff6d9b8c15a6dfdff915ab3a7f90575008fedd73487593596e27a53b4e1')
})
