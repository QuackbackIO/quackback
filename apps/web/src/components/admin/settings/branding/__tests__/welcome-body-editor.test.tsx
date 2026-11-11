// @vitest-environment happy-dom
/**
 * The Welcome message's editor: the builder offers it behind a click, so by
 * default it loads the editor only when it first draws; Settings › Portal,
 * which always shows it, hands in the editor it loads with the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const loaded = vi.fn()
vi.mock('@/components/ui/rich-text-editor', () => {
  loaded()
  return { RichTextEditor: () => <div data-testid="lazy-editor" /> }
})

const { WelcomeBodyEditor } = await import('../welcome-body-editor')

afterEach(cleanup)

const body = { type: 'doc', content: [] }

describe('WelcomeBodyEditor', () => {
  it('draws the editor handed in at once, as Settings › Portal does', () => {
    render(
      <WelcomeBodyEditor
        value={body}
        onChange={vi.fn()}
        editor={() => <div data-testid="page-editor" />}
      />
    )
    expect(screen.getByTestId('page-editor')).toBeTruthy()
    expect(loaded).not.toHaveBeenCalled()
  })

  it('loads the editor only once it draws, its empty state standing in meanwhile', async () => {
    expect(loaded).not.toHaveBeenCalled()
    render(<WelcomeBodyEditor value={body} onChange={vi.fn()} />)
    expect(screen.getByText(/Tell visitors what kind of feedback/)).toBeTruthy()
    expect(await screen.findByTestId('lazy-editor')).toBeTruthy()
    expect(loaded).toHaveBeenCalledOnce()
  })
})
