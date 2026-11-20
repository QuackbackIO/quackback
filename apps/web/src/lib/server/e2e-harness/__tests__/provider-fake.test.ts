import { describe, expect, it } from 'vitest'
import {
  E2E_PROVIDER_FAKE_HOSTS,
  e2eProviderFakeOrigin,
  e2eProviderFakeUrl,
  e2eSlackApiUrl,
} from '../provider-fake'

const ENV = {
  E2E_HARNESS: '1',
  BASE_URL: 'http://acme.localhost:3000',
  E2E_PROVIDER_FAKE_URL: 'http://127.0.0.1:4013',
}

describe('e2eProviderFakeUrl', () => {
  it('sends each known provider host to the fake behind the gate, keeping path and query', () => {
    expect(e2eProviderFakeUrl('https://api.linear.app/graphql', ENV)).toBe(
      'http://127.0.0.1:4013/api.linear.app/graphql'
    )
    expect(e2eProviderFakeUrl('https://api.github.com/user/repos?per_page=100', ENV)).toBe(
      'http://127.0.0.1:4013/api.github.com/user/repos?per_page=100'
    )
    expect(e2eProviderFakeUrl('https://API.Atlassian.com/ex/jira/1/rest', ENV)).toBe(
      'http://127.0.0.1:4013/api.atlassian.com/ex/jira/1/rest'
    )
    for (const host of E2E_PROVIDER_FAKE_HOSTS) {
      expect(e2eProviderFakeUrl(`https://${host}/x`, ENV), host).toBe(
        `http://127.0.0.1:4013/${host}/x`
      )
    }
  })

  it('leaves every request alone without the harness flag', () => {
    expect(
      e2eProviderFakeUrl('https://api.linear.app/graphql', { ...ENV, E2E_HARNESS: undefined })
    ).toBeNull()
  })

  it('leaves every request alone with the flag on a public BASE_URL (a real deployment)', () => {
    const env = { ...ENV, BASE_URL: 'https://feedback.example.com' }
    expect(e2eProviderFakeUrl('https://api.linear.app/graphql', env)).toBeNull()
    expect(e2eSlackApiUrl(env)).toBeUndefined()
  })

  it('leaves every request alone on the pooled fleet', () => {
    const env = { ...ENV, QUACKBACK_TENANCY: 'pooled' }
    expect(e2eProviderFakeUrl('https://api.linear.app/graphql', env)).toBeNull()
  })

  it('leaves every request alone when no fake is configured', () => {
    const env = { ...ENV, E2E_PROVIDER_FAKE_URL: undefined }
    expect(e2eProviderFakeUrl('https://api.linear.app/graphql', env)).toBeNull()
    expect(e2eSlackApiUrl(env)).toBeUndefined()
  })

  it('refuses a fake that is not on a loopback host or carries extras', () => {
    for (const fake of [
      'http://10.0.0.5:4013',
      'http://fake.example.com',
      'http://169.254.169.254',
      'ftp://127.0.0.1:4013',
      'http://user:pw@127.0.0.1:4013',
      'http://127.0.0.1:4013/?x=1',
      'not a url',
    ]) {
      const env = { ...ENV, E2E_PROVIDER_FAKE_URL: fake }
      expect(e2eProviderFakeOrigin(env), fake).toBeNull()
      expect(e2eProviderFakeUrl('https://api.linear.app/graphql', env), fake).toBeNull()
    }
  })

  it('maps only the exact provider hosts over https on the default port', () => {
    for (const url of [
      'http://api.linear.app/graphql',
      'https://api.linear.app:8443/graphql',
      'https://evil.api.linear.app/graphql',
      'https://api.linear.app.evil.com/graphql',
      'https://example.com/graphql',
      'https://user:pw@api.github.com/user',
      'not a url',
    ]) {
      expect(e2eProviderFakeUrl(url, ENV), url).toBeNull()
    }
  })
})

describe('e2eSlackApiUrl', () => {
  it('is the fake Slack Web API base behind the gate', () => {
    expect(e2eSlackApiUrl(ENV)).toBe('http://127.0.0.1:4013/slack.com/api/')
  })
})
