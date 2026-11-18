// @vitest-environment happy-dom
/**
 * The note composer's mention typeahead asks for teammates only and names the
 * item being noted on, so the server can mark who cannot see it. The default
 * extension (comments) names no item.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { MentionExtension, teamMentionExtensionFor } from '../mention-extension'

type ItemsFn = (props: { editor: Editor; query: string }) => Promise<unknown[]>

const itemsOf = (ext: { options: unknown }) =>
  (ext.options as { suggestion: { items: ItemsFn } }).suggestion.items

const fetchMock = vi.fn(async (_url: string) => new Response('[]', { status: 200 }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function requestedUrl(items: ItemsFn): Promise<URL> {
  const pending = items({ editor: {} as Editor, query: 'Sa' })
  await vi.runAllTimersAsync()
  await pending
  return new URL(fetchMock.mock.calls[0][0], 'http://localhost')
}

describe('mention typeahead requests', () => {
  it('a note composer asks for teammates and names its item', async () => {
    const url = await requestedUrl(
      itemsOf(teamMentionExtensionFor({ kind: 'ticket', id: 'ticket_1' }))
    )
    expect(url.pathname).toBe('/api/v1/mentions/suggest')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'sa',
      scope: 'team',
      itemKind: 'ticket',
      itemId: 'ticket_1',
    })
  })

  it('the default extension names no item', async () => {
    const url = await requestedUrl(itemsOf(MentionExtension))
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'sa' })
  })
})
