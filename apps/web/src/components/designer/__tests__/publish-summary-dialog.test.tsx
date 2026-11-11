// @vitest-environment happy-dom
/**
 * Once it has published, the summary closes still saying so: its Publish
 * stays busy while it fades out, and is ready again when it opens anew.
 * A refused publish leaves it open, ready to try again, with why. One-page
 * looks are headed as the panel names them: "Set differently".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PublishSummaryDialog } from '../publish-summary-dialog'

afterEach(cleanup)

const summary = { menu: [], look: [{ kind: 'Look', title: 'Brand colour' }], overrides: [] }

function dialog(onPublish: () => Promise<{ ok: true } | { ok: false; message: string }>) {
  const props = {
    count: 1,
    summary,
    newLogo: false,
    onSeeEverything: vi.fn(),
    onPublish,
    // Fading out: still drawn, as the dialog is while it closes.
    onOpenChange: vi.fn(),
  }
  const view = render(<PublishSummaryDialog open {...props} />)
  return { ...view, props }
}

const publishButton = () =>
  screen.getAllByRole('button').find((each) => /^Publish/.test(each.textContent ?? ''))!

describe('PublishSummaryDialog', () => {
  it('stays busy once published, and is ready again when opened anew', async () => {
    const { rerender, props } = dialog(async () => ({ ok: true }))
    await act(async () => fireEvent.click(publishButton()))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(publishButton().textContent).toBe('Publishing…')
    expect(publishButton().hasAttribute('disabled')).toBe(true)
    rerender(<PublishSummaryDialog open={false} {...props} />)
    rerender(<PublishSummaryDialog open {...props} />)
    expect(publishButton().textContent).toBe('Publish')
  })

  it('stays open and ready to try again when the publish is refused', async () => {
    const { props } = dialog(async () => ({ ok: false, message: 'Not today.' }))
    await act(async () => fireEvent.click(publishButton()))
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(publishButton().textContent).toBe('Publish')
    expect(screen.getByRole('alert').textContent).toBe('Not today.')
  })

  it('heads one-page looks "Set differently", never "Overrides"', () => {
    render(
      <PublishSummaryDialog
        open
        onOpenChange={() => {}}
        count={1}
        summary={{ menu: [], look: [], overrides: [{ kind: 'Roadmap', title: 'Buttons' }] }}
        newLogo={false}
        onSeeEverything={() => {}}
        onPublish={async () => ({ ok: true }) as never}
      />
    )
    expect(screen.getByRole('heading', { name: 'Set differently' })).toBeTruthy()
    expect(screen.queryByText('Overrides')).toBeNull()
  })
})
