// @vitest-environment happy-dom
/** The publish summary names looks set for one page or part as the panel does: "Set differently". */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PublishSummaryDialog } from '../publish-summary-dialog'

describe('PublishSummaryDialog', () => {
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
