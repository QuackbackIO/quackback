/**
 * GitHub repository listing via REST API.
 */

const GITHUB_API = 'https://api.github.com'

/**
 * List GitHub repositories accessible to the authenticated user.
 */
export async function listGitHubRepos(
  accessToken: string
): Promise<Array<{ id: number; fullName: string; private: boolean }>> {
  const response = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list GitHub repos: HTTP ${response.status}`)
  }

  const data = (await response.json()) as Array<{
    id: number
    full_name: string
    private: boolean
  }>

  return data.map((repo) => ({
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
  }))
}
