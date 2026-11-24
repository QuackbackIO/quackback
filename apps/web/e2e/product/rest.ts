/**
 * REST helpers for product tests that need feedback rows of their own (a
 * board, a post) to set an event off: created through the public API with a
 * workspace key, as an integration or a script would, so the app's events
 * fire exactly as in production.
 *
 *   const api = await workspaceApi(playwright, baseURL, people)
 *   const board = await createBoard(api, marker)
 *   const post = await createPost(api, board.id, `${marker} title`)
 */
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { apiFor, createKey, expectJson } from '../support/api-client'
import type { SeededPeople } from '../support/people'

/** A REST client with a fresh workspace key made by the seeded admin. */
export async function workspaceApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  people: SeededPeople
): Promise<APIRequestContext> {
  const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
  return apiFor(playwright, baseURL, key)
}

export async function createBoard(
  api: APIRequestContext,
  name: string
): Promise<{ id: string; slug: string }> {
  const body = await expectJson<{ data: { id: string; slug: string } }>(
    await api.post('/api/v1/boards', { data: { name: name.slice(0, 100) } }),
    201
  )
  return body.data
}

export async function createPost(
  api: APIRequestContext,
  boardId: string,
  title: string,
  content = ''
): Promise<{ id: string; title: string }> {
  const body = await expectJson<{ data: { id: string; title: string } }>(
    await api.post('/api/v1/posts', { data: { boardId, title, content } }),
    201
  )
  return body.data
}
