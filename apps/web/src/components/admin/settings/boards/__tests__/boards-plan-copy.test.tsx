// @vitest-environment happy-dom
/**
 * The words read-only boards show people: none of the plan limits words that
 * are never shown (the glossary), and no em dashes. Scans the values people
 * read (messages, locale strings, rendered labels), never source text, where
 * identifiers and comments may use those words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import en from '@/locales/en.json'
import { BOARD_READ_ONLY_MESSAGE } from '@/lib/shared/board-read-only'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

const { BoardsList } = await import('../boards-list')

afterEach(cleanup)

const BANNED = [
  /\bgrace\b/i,
  /\bfrozen\b/i,
  /\bfreeze\b/i,
  /\bheld\b/i,
  /\bswitch\b/i,
  /\benforce/i,
  /\bextras\b/i,
  /current plan/i,
  /on your plan/i,
  /choose a plan/i,
  /keep pro/i,
  /choose pro/i,
  /—/,
]

function bannedIn(text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map(String)
}

const LOCALE_KEYS = [
  'portal.feedback.readOnly',
  'portal.postCard.vote.ariaClosed',
  'widget.voteButton.ariaClosed',
  'widget.readOnly',
] as const

function board(over: Record<string, unknown>) {
  return {
    id: 'board_1',
    name: 'Acme',
    slug: 'acme',
    description: null,
    access: DEFAULT_BOARD_ACCESS,
    settings: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    postCount: 0,
    ...over,
  }
}

describe('read-only board copy', () => {
  it('flags a planted banned word, so the scan can fail', () => {
    expect(bannedIn('Boards are frozen during the grace period')).not.toHaveLength(0)
  })

  it('keeps the visitor line plain and neutral', () => {
    expect(bannedIn(BOARD_READ_ONLY_MESSAGE)).toEqual([])
    expect(BOARD_READ_ONLY_MESSAGE).not.toMatch(/plan|billing|upgrade/i)
  })

  it.each(LOCALE_KEYS)('keeps %s free of banned words', (key) => {
    const value = (en as Record<string, string>)[key]
    expect(value).toBeDefined()
    expect(bannedIn(value)).toEqual([])
  })

  it('keeps the admin labels free of banned words in every state', () => {
    const { container } = render(
      <BoardsList
        boards={
          [
            board({ id: 'b1' }),
            board({ id: 'b2', readOnly: true }),
            board({ id: 'b3', planReadOnly: 'Free' }),
            board({ id: 'b4', planReadOnly: '' }),
          ] as never
        }
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Read-only on the Free plan')
    expect(bannedIn(text)).toEqual([])
  })
})
