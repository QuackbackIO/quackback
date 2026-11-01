// @vitest-environment happy-dom
/**
 * The writing surface is a multi-line text field named by what it asks for,
 * so a screen reader says what to write there.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RichTextEditor } from '../rich-text-editor'

afterEach(cleanup)

describe('the rich text editor', () => {
  it('is a multi-line text field named by its placeholder', async () => {
    render(
      <IntlProvider locale="en" onError={() => {}}>
        <RichTextEditor placeholder="Add more details" />
      </IntlProvider>
    )
    const field = await screen.findByRole('textbox', { name: 'Add more details' })
    expect(field.getAttribute('aria-multiline')).toBe('true')
  })
})
