import { it, expect } from 'vitest'
import { CloudCredentialSource } from '../cloud-source'
import { CLOUD_INTEGRATION_FIELDS } from '@/lib/shared/integration-credentials'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
it('reads complete credentials from the effective container environment', async () => {
  const source = new CloudCredentialSource({
    INTEGRATION_SLACK_CLIENT_ID: 'id',
    INTEGRATION_SLACK_CLIENT_SECRET: 'secret',
    INTEGRATION_SLACK_SIGNING_SECRET: 'signing',
    INTEGRATION_SLACK_EXTRA: 'never',
  })
  expect(await source.get('slack')).toEqual({
    clientId: 'id',
    clientSecret: 'secret',
    signingSecret: 'signing',
  })
  expect(await source.listConfigured()).toEqual(['slack'])
})
it('requires complete settings and never returns unknown fields/providers', async () => {
  const source = new CloudCredentialSource({ INTEGRATION_SLACK_CLIENT_ID: 'id' })
  expect(await source.get('slack')).toBeNull()
  expect(await source.get('__proto__')).toBeNull()
  expect(Object.keys(CLOUD_INTEGRATION_FIELDS)).toHaveLength(16)
})
it('pins the CP catalogue contract', () => {
  expect(
    createHash('sha256')
      .update(readFileSync('apps/web/src/lib/shared/integration-credentials.ts'))
      .digest('hex')
  ).toBe('2dc62547efbca3dc388594603dcf7a1f4301fca3989077b29a966c3c0cc6ec2b')
})
