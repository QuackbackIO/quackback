// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(cleanup)

import { SearchSnippet } from '../search-snippet'

describe('<SearchSnippet>', () => {
  const segments = [
    { text: '…we still cannot export the ', match: false },
    { text: 'invoice', match: true },
    { text: ' as a PDF…', match: false },
  ]

  it('renders the excerpt as one continuous line of text', () => {
    const { container } = render(<SearchSnippet segments={segments} />)
    expect(container.textContent).toBe('…we still cannot export the invoice as a PDF…')
  })

  it('marks only the matched run, so the keyword stands out in context', () => {
    render(<SearchSnippet segments={segments} />)
    const marks = screen.getAllByRole('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('invoice')
  })

  it('renders markup in the excerpt as literal text, never as elements', () => {
    const { container } = render(
      <SearchSnippet segments={[{ text: '<img src=x onerror=1>', match: false }]} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('<img src=x onerror=1>')
  })
})
