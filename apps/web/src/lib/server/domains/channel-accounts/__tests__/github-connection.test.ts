import { describe, expect, it } from 'vitest'
import {
  GITHUB_INBOX_CONNECT_COPY,
  githubAccessTokenPresent,
  githubInboxEnableDeniedReason,
} from '../github-connection'

describe('github inbox enable gate', () => {
  it('refuses enable when GitHub is not connected or has no access token', () => {
    expect(githubInboxEnableDeniedReason({ status: null, accessToken: 'tok' })).toBe(
      GITHUB_INBOX_CONNECT_COPY
    )
    expect(githubInboxEnableDeniedReason({ status: 'active', accessToken: undefined })).toBe(
      GITHUB_INBOX_CONNECT_COPY
    )
    expect(githubInboxEnableDeniedReason({ status: 'active', accessToken: '' })).toBe(
      GITHUB_INBOX_CONNECT_COPY
    )
    expect(githubInboxEnableDeniedReason({ status: 'paused', accessToken: 'tok' })).toBe(
      'Resume GitHub before enabling the inbox channel.'
    )
    expect(githubInboxEnableDeniedReason({ status: 'active', accessToken: 'tok' })).toBeNull()
  })

  it('treats a stored accessToken as present only when it is a non-empty string', () => {
    expect(githubAccessTokenPresent({ accessToken: 'tok' })).toBe(true)
    expect(githubAccessTokenPresent({ accessToken: '' })).toBe(false)
    expect(githubAccessTokenPresent({})).toBe(false)
    expect(githubAccessTokenPresent(null)).toBe(false)
  })
})
