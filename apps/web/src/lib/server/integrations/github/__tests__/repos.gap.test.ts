/**
 * Differential-coverage tests for listGitHubRepos — the success mapping and the
 * GitHubApiError thrown on a non-ok response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listGitHubRepos, GitHubApiError } from '../repos'

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('listGitHubRepos', () => {
  it('maps the GitHub REST payload to id/fullName/private', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1, full_name: 'acme/app', private: true }]), {
        status: 200,
      })
    )
    const repos = await listGitHubRepos('token')
    expect(repos).toEqual([{ id: 1, fullName: 'acme/app', private: true }])
  })

  it('throws a GitHubApiError carrying the status and body on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    await expect(listGitHubRepos('token')).rejects.toBeInstanceOf(GitHubApiError)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 401 }))
    await expect(listGitHubRepos('token')).rejects.toMatchObject({ status: 401, body: 'nope' })
  })
})
