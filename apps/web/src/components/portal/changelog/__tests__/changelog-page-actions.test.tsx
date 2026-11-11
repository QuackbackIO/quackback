// @vitest-environment happy-dom
/** Subscribe and the RSS button sit as a pair of one height, however tall a brand's buttons are. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/client/hooks/use-root-context', () => ({ useSessionContext: () => null }))
vi.mock('@/components/auth/auth-popover-context', () => ({ useAuthPopoverSafe: () => null }))
vi.mock('@/components/public/portal-page-title', () => ({ useDesignTitles: () => false }))
vi.mock('@/components/public/preview-draft-context', () => ({
  usePageChoices: () => ({ changelog: {} }),
}))
vi.mock('../changelog-list-public', () => ({ ChangelogListPublic: () => null }))
vi.mock('../changelog-subscribe-button', () => ({
  ChangelogSubscribeButton: () => <button type="button">Subscribe</button>,
}))

const { ChangelogPage } = await import('../changelog-page')

describe('ChangelogPage actions', () => {
  it('sizes the RSS button to the brand’s button height, square', () => {
    render(
      <IntlProvider locale="en">
        <ChangelogPage />
      </IntlProvider>
    )
    const rss = screen.getByRole('link', { name: 'RSS feed' })
    // A primary button's height is --qb-button-height where the brand sets one: the RSS button takes it too.
    expect(rss.className.split(' ')).toContain('qb-square-button')
    const css = readFileSync(join(__dirname, '../../../../globals.css'), 'utf8')
    const start = css.indexOf('.qb-square-button {')
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('min-height: var(--qb-button-height, 2rem)')
    expect(rule).toContain('min-width: var(--qb-button-height, 2rem)')
    expect(rss.parentElement!.className).toContain('items-center')
  })
})
