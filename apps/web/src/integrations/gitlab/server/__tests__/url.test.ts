import { describe, it, expect } from 'vitest'
import {
  GITLAB_COM_ORIGIN,
  GitLabInstanceUrlError,
  extractGitLabProjectPath,
  gitlabApiBase,
  normalizeGitLabInstanceUrl,
} from '@/integrations/gitlab/server/url'

describe('normalizeGitLabInstanceUrl', () => {
  it('defaults to gitlab.com when the URL is omitted', () => {
    expect(normalizeGitLabInstanceUrl(undefined)).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl(null)).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl('')).toBe(GITLAB_COM_ORIGIN)
    expect(normalizeGitLabInstanceUrl('   ')).toBe(GITLAB_COM_ORIGIN)
  })

  it('reduces a custom HTTPS instance to its origin', () => {
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com/')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com/foo')).toBe(
      'https://gitlab.example.com'
    )
    expect(normalizeGitLabInstanceUrl('https://gitlab.example.com:8443')).toBe(
      'https://gitlab.example.com:8443'
    )
  })

  it('rejects non-http(s) schemes', () => {
    expect(() => normalizeGitLabInstanceUrl('javascript:alert(1)')).toThrow(GitLabInstanceUrlError)
    expect(() => normalizeGitLabInstanceUrl('file:///etc/passwd')).toThrow(GitLabInstanceUrlError)
  })

  it('rejects URLs that embed credentials', () => {
    expect(() => normalizeGitLabInstanceUrl('https://user:pass@gitlab.example.com')).toThrow(
      GitLabInstanceUrlError
    )
  })

  it('rejects unparseable strings', () => {
    expect(() => normalizeGitLabInstanceUrl('not a url')).toThrow(GitLabInstanceUrlError)
  })
})

describe('gitlabApiBase', () => {
  it('appends /api/v4 to gitlab.com by default', () => {
    expect(gitlabApiBase()).toBe('https://gitlab.com/api/v4')
  })

  it('appends /api/v4 to a custom instance origin', () => {
    expect(gitlabApiBase('https://gitlab.example.com/')).toBe('https://gitlab.example.com/api/v4')
  })
})

describe('extractGitLabProjectPath', () => {
  it('extracts the project path from a gitlab.com issue URL', () => {
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project/-/issues/7')).toBe(
      'my-org/my-project'
    )
  })

  it('extracts the project path from a self-hosted issue URL', () => {
    expect(
      extractGitLabProjectPath('https://gitlab.example.com/group/sub/project/-/issues/42')
    ).toBe('group/sub/project')
  })

  it('accepts the older /issues/ form', () => {
    expect(extractGitLabProjectPath('https://gitlab.com/acme/widgets/issues/142')).toBe(
      'acme/widgets'
    )
  })

  it('returns null when the URL is missing or not an issue URL', () => {
    expect(extractGitLabProjectPath(null)).toBeNull()
    expect(extractGitLabProjectPath('https://gitlab.com/my-org/my-project')).toBeNull()
  })
})
