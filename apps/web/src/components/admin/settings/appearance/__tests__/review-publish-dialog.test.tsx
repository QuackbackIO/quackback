// @vitest-environment happy-dom
/**
 * The full review leads with what changes, by part, then the page before and
 * after, then what else visitors get (only when the draft touches it), then
 * every change. It is titled and its button named by how many changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { DesignChange } from '@/lib/shared/design/diff'

vi.mock('@/lib/server/functions/portal-design-email', () => ({
  getSignInEmailSampleFn: vi.fn(async () => ({ ok: false, message: 'No sample' })),
  getShareCardSampleFn: vi.fn(async () => ({ ok: false, message: 'No card' })),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme Corp' }),
  useBaseUrl: () => 'https://acme.test',
}))

import { defaultDesign } from '@/lib/shared/design/schema'
import { ReviewPublishDialog, SUMMARY_ROWS } from '../review-publish-dialog'

afterEach(cleanup)

const change = (path: string, before: unknown = 'a', after: unknown = 'b'): DesignChange => ({
  path,
  before,
  after,
})
const PARTS = ['Site styles', 'Header and menu', 'Hero', 'Home', 'Feedback page', 'Roadmap page']

function show({
  changes = [change('brand.light.accent', '#d9202b', '#1d4ed8')],
  reason,
}: { changes?: DesignChange[]; reason?: string } = {}) {
  render(
    <ReviewPublishDialog
      open
      onOpenChange={() => {}}
      changes={changes}
      summary={PARTS.map((kind) => ({ kind, title: `${kind} things`, detail: '1 change' }))}
      report={{ adjustments: [], errors: [] }}
      onPublish={async () => ({ ok: true })}
      canPublish
      reason={reason}
      design={defaultDesign()}
      compare={<section aria-label="Home, before and after" />}
    />
  )
  return screen.getByRole('dialog')
}

describe('the full review', () => {
  it('is titled by its count and publishes by it, without a reason to give', () => {
    const many = Array.from({ length: 14 }, (_, at) => change(`layout.thing${at}`))
    const dialog = show({ changes: many })
    expect(screen.getByRole('dialog', { name: 'Review 14 changes' })).toBe(dialog)
    expect(within(dialog).getByRole('button', { name: 'Publish 14 changes' })).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/a lot to sum up|here is everything/)
  })

  it('says why it opened when a check needs a look', () => {
    show({ reason: 'A check needs a look before you publish.' })
    const dialog = screen.getByRole('dialog', { name: 'Review and publish' })
    expect(dialog.textContent).toContain('A check needs a look before you publish.')
    expect(within(dialog).getByRole('button', { name: 'Publish 1 change' })).toBeTruthy()
  })

  it('leads with a short summary by part, before the page compare and the full list', () => {
    const dialog = show()
    const order = [...dialog.querySelectorAll('section[aria-label], section[aria-labelledby]')].map(
      (each) =>
        each.getAttribute('aria-label') ??
        document.getElementById(each.getAttribute('aria-labelledby')!)?.textContent
    )
    expect(order.indexOf('What changes')).toBeLessThan(order.indexOf('Home, before and after'))
    expect(order.indexOf('Home, before and after')).toBeLessThan(order.indexOf('Every change'))
    const summary = screen.getByRole('region', { name: 'What changes' })
    const rows = within(summary).getAllByRole('listitem')
    // A few rows, then how many more parts.
    expect(rows).toHaveLength(SUMMARY_ROWS + 1)
    expect(rows.at(-1)!.textContent).toBe(`And ${PARTS.length - SUMMARY_ROWS} more parts`)
  })

  it('takes Show all to the full list', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 1 change' }))
    expect(scrolled).toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe('Every change')
  })

  it('shows what else visitors get only when the draft changes what it is drawn from', () => {
    show({ changes: [change('layout.width', 'default', 'wide')] })
    expect(screen.queryByRole('region', { name: /Visitors also get/ })).toBeNull()
    cleanup()
    show({ changes: [change('brand.fonts.heading.id', 'inter', 'poppins')] })
    expect(
      screen.getByRole('region', { name: 'Visitors also get, after you publish' })
    ).toBeTruthy()
  })

  it('heads each section, and leaves the items in it as captions', () => {
    show()
    const sections = screen.getAllByRole('heading', { level: 3 }).map((each) => each.textContent)
    expect(sections).toEqual([
      'What changes',
      'Visitors also get, after you publish',
      'Every change',
    ])
    // The email and the link preview are named by captions, not headings.
    expect(screen.queryByRole('heading', { name: 'Sign-in email' })).toBeNull()
    expect(screen.getByText('Sign-in email').tagName).toBe('FIGCAPTION')
  })
})
