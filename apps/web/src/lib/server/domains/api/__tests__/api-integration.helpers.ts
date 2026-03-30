/**
 * Shared helpers for API integration tests.
 */

export const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api/v1'
export const API_KEY = process.env.API_KEY || ''
export const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === 'true'

// Helper to make API calls
export async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let data: unknown = null
  if (res.status !== 204) {
    try {
      data = await res.json()
    } catch {
      data = null
    }
  }

  return { status: res.status, data }
}

export interface TestState {
  serverAvailable: boolean
  testBoardId: string | null
  testPostId: string | null
  createdIds: { posts: string[]; boards: string[]; tags: string[]; roadmaps: string[] }
}

export function createTestState(): TestState {
  return {
    serverAvailable: false,
    testBoardId: null,
    testPostId: null,
    createdIds: { posts: [], boards: [], tags: [], roadmaps: [] },
  }
}

// Check if server is running and populate test state
export async function checkServerAndSetup(state: TestState): Promise<boolean> {
  if (!API_KEY) {
    console.warn('⚠️ No API_KEY provided - skipping API integration tests')
    console.warn('   Run with: API_KEY=qb_xxx bun run test api-integration')
    return false
  }

  try {
    const res = await fetch(`${BASE_URL}/boards`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    if (res.status === 401) {
      console.warn('⚠️ Invalid API key - skipping API integration tests')
      return false
    }
    if (res.status !== 200) {
      console.warn('⚠️ Server not responding correctly - skipping API integration tests')
      return false
    }

    // Get test data
    const boardsData = await res.json()
    const boards = (boardsData as { data: Array<{ id: string }> })?.data || []
    if (boards.length > 0) {
      state.testBoardId = boards[0].id
    }

    const { data: postsData } = await api('GET', '/posts')
    const posts = (postsData as { data: Array<{ id: string }> })?.data || []
    if (posts.length > 0) {
      state.testPostId = posts[0].id
    }

    return true
  } catch {
    console.warn('⚠️ Server not running - skipping API integration tests')
    console.warn('   Start server with: bun run dev')
    return false
  }
}

// Cleanup all created resources
export async function cleanupCreatedResources(createdIds: TestState['createdIds']): Promise<void> {
  for (const id of createdIds.posts) {
    await api('DELETE', `/posts/${id}`)
  }
  for (const id of createdIds.tags) {
    await api('DELETE', `/tags/${id}`)
  }
  for (const id of createdIds.roadmaps) {
    await api('DELETE', `/roadmaps/${id}`)
  }
  for (const id of createdIds.boards) {
    await api('DELETE', `/boards/${id}`)
  }
}
