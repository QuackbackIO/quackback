// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { DocsLink } from '../docs-link'
import { NewTabHint } from '../button'

afterEach(cleanup)

describe('NewTabHint', () => {
  it('adds visually hidden text that names the new tab', () => {
    render(
      <IntlProvider locale="en">
        <NewTabHint />
      </IntlProvider>
    )
    const hint = screen.getByText('(opens in a new tab)')
    expect(hint.className).toContain('sr-only')
  })

  it('is part of the accessible name of a docs link', () => {
    render(
      <IntlProvider locale="en">
        <DocsLink href="https://example.com/docs">Read the guide</DocsLink>
      </IntlProvider>
    )
    expect(screen.getByRole('link', { name: 'Read the guide (opens in a new tab)' })).toBeTruthy()
  })
})
