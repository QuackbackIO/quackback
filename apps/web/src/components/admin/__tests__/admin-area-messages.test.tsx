// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider } from 'react-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAdminMessages, messageArea, seedAdminAreas } from '@/lib/shared/i18n'
import en from '@/locales/en.json'

let matches: { loaderData?: unknown }[] = []

vi.mock('@tanstack/react-router', () => ({
  useMatches: ({ select }: { select: (m: typeof matches) => unknown }) => select(matches),
}))

const { AdminAreaMessages, mergeSeededAreas } = await import('../admin-area-messages')

function seeded(messages: Record<string, string>): { areaMessages: Record<string, string> } {
  return { areaMessages: messages }
}

describe('seedAdminAreas', () => {
  it('seeds only the named areas, in the admin language', async () => {
    const messages = (await seedAdminAreas('de', 'adminPeople')).areaMessages ?? {}
    const keys = Object.keys(messages)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => messageArea(key) === 'adminPeople')).toBe(true)
    expect(messages['admin.people.new.title']).toBeTruthy()
    expect(messages['admin.people.new.title']).not.toBe(en['admin.people.new.title'])
  })

  it("adds nothing to an English page's data, or without a language", async () => {
    expect(await seedAdminAreas('en', 'adminPeople')).toEqual({})
    expect(await seedAdminAreas(undefined, 'adminPeople')).toEqual({})
  })

  it("leaves the admin areas' strings out of the admin layout's seed", async () => {
    const layout = await loadAdminMessages('de')
    expect(Object.keys(layout).filter((key) => key.startsWith('admin.people.'))).toEqual([])
    expect(Object.keys(layout).filter((key) => key.startsWith('admin.changelog.'))).toEqual([])
    // The shell's own strings stay in it.
    expect(layout['admin.nav.settings']).toBeTruthy()
  })
})

describe('mergeSeededAreas', () => {
  it('merges what every matched route seeded', () => {
    expect(
      mergeSeededAreas([undefined, { other: 1 }, seeded({ a: 'A' }), seeded({ b: 'B' })])
    ).toEqual({ a: 'A', b: 'B' })
  })

  it('is empty when no route seeded', () => {
    expect(mergeSeededAreas([undefined, {}])).toEqual({})
  })
})

describe('AdminAreaMessages', () => {
  beforeEach(() => {
    matches = []
  })

  function page() {
    return render(
      <IntlProvider locale="de" defaultLocale="en" messages={{ shell: 'Schale' }}>
        <AdminAreaMessages>
          <FormattedMessage id="shell" defaultMessage="Shell" />{' '}
          <FormattedMessage id="admin.people.new.title" defaultMessage="New person" />
        </AdminAreaMessages>
      </IntlProvider>
    )
  }

  it("hands the page its route's area strings beside the shell's", () => {
    matches = [{ loaderData: {} }, { loaderData: seeded({ 'admin.people.new.title': 'Neu' }) }]
    page()
    expect(screen.getByText('Schale Neu')).toBeTruthy()
  })

  it('renders the English for a page whose route seeded nothing', () => {
    matches = [{ loaderData: {} }]
    page()
    expect(screen.getByText('Schale New person')).toBeTruthy()
  })
})
