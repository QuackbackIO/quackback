// @vitest-environment happy-dom
/**
 * <UsersSegmentNav>: the Users side pane, a labelled Directory section and
 * a Segments section whose rows carry an icon and whose "+" names its action.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UsersSegmentNav } from '../users-segment-nav'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
import type { SegmentId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...rest }: { children: React.ReactNode; className?: string }) => (
    <a className={rest.className}>{children}</a>
  ),
}))

const SEGMENT = {
  id: 'seg_1' as SegmentId,
  name: 'Beta testers',
  slug: 'beta-testers',
  color: '#3b82f6',
  type: 'manual' as const,
  description: null,
  memberCount: 3,
  rules: null,
  evaluationSchedule: null,
  weightConfig: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as SegmentListItem

function renderNav(onCreateSegment = vi.fn()) {
  render(
    <TooltipProvider>
      <UsersSegmentNav
        segments={[SEGMENT]}
        isLoading={false}
        selectedSegmentIds={[]}
        onSelectSegment={vi.fn()}
        onClearSegments={vi.fn()}
        totalUserCount={10}
        onCreateSegment={onCreateSegment}
        onEditSegment={vi.fn()}
        onDeleteSegment={vi.fn()}
      />
    </TooltipProvider>
  )
  return onCreateSegment
}

describe('<UsersSegmentNav>', () => {
  it('labels the first group Directory, above All users', () => {
    renderNav()
    const label = screen.getByText('Directory')
    const allUsers = screen.getByText('All users')
    expect(label.compareDocumentPosition(allUsers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives the segments add button an accessible New segment name', () => {
    const onCreate = renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'New segment' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('draws a funnel icon on each segment row', () => {
    renderNav()
    const row = screen.getByText('Beta testers').closest('button')!
    expect(row.querySelector('svg')).not.toBeNull()
  })
})
