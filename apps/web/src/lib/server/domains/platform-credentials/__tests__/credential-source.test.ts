/**
 * CredentialSource tests.
 *
 * EnvCredentialSource is the cloud path: shared OAuth-app credentials arrive as
 * INTEGRATION_<PROVIDER>_<FIELD> env (projected from OpenBao via ESO). It reports an
 * integration as configured only when EVERY field the provider declares is present
 * (fail closed), matching the DB write validation. Pure (env in, record out), so it
 * is tested with real code and injected env / known types / required fields.
 */

import { describe, it, expect } from 'vitest'
import { EnvCredentialSource } from '../credential-source'

const knownTypes = async () => ['slack', 'discord', 'azure-devops', 'linear']
const requiredFields = async (t: string): Promise<string[]> =>
  (
    ({
      slack: ['clientId', 'clientSecret', 'signingSecret'],
      discord: ['clientId', 'clientSecret', 'botToken'],
      'azure-devops': ['clientId', 'clientSecret'],
      linear: ['clientId', 'clientSecret'],
    }) as Record<string, string[]>
  )[t] ?? []

const src = (env: Record<string, string | undefined>) =>
  new EnvCredentialSource(env, knownTypes, requiredFields)

describe('EnvCredentialSource', () => {
  it('get() maps INTEGRATION_<TYPE>_<FIELD> env to camelCase fields when fully configured', async () => {
    expect(
      await src({
        INTEGRATION_SLACK_CLIENT_ID: 'cid',
        INTEGRATION_SLACK_CLIENT_SECRET: 'csec',
        INTEGRATION_SLACK_SIGNING_SECRET: 'ssec',
      }).get('slack')
    ).toEqual({ clientId: 'cid', clientSecret: 'csec', signingSecret: 'ssec' })
  })

  it('get() returns null when no env vars exist for the type', async () => {
    expect(await src({ INTEGRATION_SLACK_CLIENT_ID: 'x' }).get('discord')).toBeNull()
  })

  it('get() handles multi-word (hyphenated) types', async () => {
    expect(
      await src({
        INTEGRATION_AZURE_DEVOPS_CLIENT_ID: 'id',
        INTEGRATION_AZURE_DEVOPS_CLIENT_SECRET: 'sec',
      }).get('azure-devops')
    ).toEqual({ clientId: 'id', clientSecret: 'sec' })
  })

  it('get() maps botToken correctly', async () => {
    expect(
      await src({
        INTEGRATION_DISCORD_BOT_TOKEN: 'bt',
        INTEGRATION_DISCORD_CLIENT_ID: 'id',
        INTEGRATION_DISCORD_CLIENT_SECRET: 's',
      }).get('discord')
    ).toEqual({ botToken: 'bt', clientId: 'id', clientSecret: 's' })
  })

  it('get() fails closed when a required field is missing or empty', async () => {
    // clientSecret empty + signingSecret absent → not fully configured → null,
    // so the integration is never reported configured on a partial OpenBao path.
    expect(
      await src({
        INTEGRATION_SLACK_CLIENT_ID: 'id',
        INTEGRATION_SLACK_CLIENT_SECRET: '',
      }).get('slack')
    ).toBeNull()
  })

  it('has() is true only when fully configured', async () => {
    expect(await src({ INTEGRATION_SLACK_CLIENT_ID: 'id' }).has('slack')).toBe(false)
    expect(
      await src({
        INTEGRATION_SLACK_CLIENT_ID: 'id',
        INTEGRATION_SLACK_CLIENT_SECRET: 's',
        INTEGRATION_SLACK_SIGNING_SECRET: 'sig',
      }).has('slack')
    ).toBe(true)
    expect(await src({ INTEGRATION_SLACK_CLIENT_ID: 'id' }).has('discord')).toBe(false)
  })

  it('listConfigured() returns only fully-configured known types', async () => {
    const result = await src({
      INTEGRATION_SLACK_CLIENT_ID: 'id',
      INTEGRATION_SLACK_CLIENT_SECRET: 's',
      INTEGRATION_SLACK_SIGNING_SECRET: 'sig',
      INTEGRATION_AZURE_DEVOPS_CLIENT_SECRET: 's', // incomplete (no clientId) → excluded
      INTEGRATION_NOTATYPE_FOO: 'x', // not a known type → ignored
    }).listConfigured()
    expect([...result].sort()).toEqual(['slack'])
  })
})
