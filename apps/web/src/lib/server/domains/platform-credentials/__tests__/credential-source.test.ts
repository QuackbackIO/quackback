/**
 * CredentialSource tests.
 *
 * EnvCredentialSource is the cloud path: shared OAuth-app credentials arrive as
 * INTEGRATION_<PROVIDER>_<FIELD> env (projected from OpenBao via ESO), mirroring
 * how the CP consumes its own STRIPE_SECRET_KEY / GOOGLE_CLIENT_SECRET. It is pure
 * (env in, credential record out), so it is tested with real code and injected env.
 */

import { describe, it, expect } from 'vitest'
import { EnvCredentialSource } from '../credential-source'

const knownTypes = async () => ['slack', 'discord', 'azure-devops', 'linear']

describe('EnvCredentialSource', () => {
  it('get() maps INTEGRATION_<TYPE>_<FIELD> env to camelCase credential fields', async () => {
    const env = {
      INTEGRATION_SLACK_CLIENT_ID: 'cid',
      INTEGRATION_SLACK_CLIENT_SECRET: 'csec',
      INTEGRATION_SLACK_SIGNING_SECRET: 'ssec',
    }
    const src = new EnvCredentialSource(env, knownTypes)
    expect(await src.get('slack')).toEqual({
      clientId: 'cid',
      clientSecret: 'csec',
      signingSecret: 'ssec',
    })
  })

  it('get() returns null when no env vars exist for the type', async () => {
    const src = new EnvCredentialSource({ INTEGRATION_SLACK_CLIENT_ID: 'x' }, knownTypes)
    expect(await src.get('discord')).toBeNull()
  })

  it('get() handles multi-word (hyphenated) types', async () => {
    const env = {
      INTEGRATION_AZURE_DEVOPS_CLIENT_ID: 'id',
      INTEGRATION_AZURE_DEVOPS_CLIENT_SECRET: 'sec',
    }
    const src = new EnvCredentialSource(env, knownTypes)
    expect(await src.get('azure-devops')).toEqual({ clientId: 'id', clientSecret: 'sec' })
  })

  it('get() maps botToken correctly', async () => {
    const src = new EnvCredentialSource(
      {
        INTEGRATION_DISCORD_BOT_TOKEN: 'bt',
        INTEGRATION_DISCORD_CLIENT_ID: 'id',
        INTEGRATION_DISCORD_CLIENT_SECRET: 's',
      },
      knownTypes
    )
    expect(await src.get('discord')).toEqual({ botToken: 'bt', clientId: 'id', clientSecret: 's' })
  })

  it('get() ignores empty-string values', async () => {
    const src = new EnvCredentialSource(
      { INTEGRATION_SLACK_CLIENT_ID: 'id', INTEGRATION_SLACK_CLIENT_SECRET: '' },
      knownTypes
    )
    expect(await src.get('slack')).toEqual({ clientId: 'id' })
  })

  it('has() reflects presence', async () => {
    const src = new EnvCredentialSource({ INTEGRATION_SLACK_CLIENT_ID: 'id' }, knownTypes)
    expect(await src.has('slack')).toBe(true)
    expect(await src.has('discord')).toBe(false)
  })

  it('listConfigured() returns known types that have env present', async () => {
    const env = {
      INTEGRATION_SLACK_CLIENT_ID: 'id',
      INTEGRATION_AZURE_DEVOPS_CLIENT_SECRET: 's',
      INTEGRATION_NOTATYPE_FOO: 'x', // not a known type → ignored
    }
    const src = new EnvCredentialSource(env, knownTypes)
    const result = await src.listConfigured()
    expect([...result].sort()).toEqual(['azure-devops', 'slack'])
  })
})
