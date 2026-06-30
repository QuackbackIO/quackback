// @vitest-environment happy-dom
/**
 * <SegmentRow> — member count in Settings -> People.
 *
 * The member count used to be inert text, the only "home" for a segment's
 * roster lived on a completely different page (Users). It's now a link into
 * the Users page pre-filtered to that segment, so membership is reachable
 * from the segment itself.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SegmentRow } from '../segment-list'
import type { SegmentId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    className,
    title,
  }: {
    to: string
    search?: Record<string, unknown>
    children: React.ReactNode
    className?: string
    title?: string
  }) => (
    <a href={to} data-search={JSON.stringify(search)} className={className} title={title}>
      {children}
    </a>
  ),
}))

const MANUAL_SEGMENT = {
  id: 'seg_beta' as SegmentId,
  name: 'Beta Testers',
  slug: 'beta-testers',
  description: null,
  type: 'manual' as const,
  color: '#3b82f6',
  memberCount: 14,
  rules: null,
  evaluationSchedule: null,
  weightConfig: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('<SegmentRow> member count link', () => {
  it('links the member count to the Users page filtered to this segment', () => {
    render(
      <SegmentRow
        segment={MANUAL_SEGMENT}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onEvaluate={vi.fn()}
        isEvaluating={false}
      />
    )
    const link = screen.getByRole('link', { name: /14 people/i })
    expect(link).toHaveAttribute('href', '/admin/users')
    expect(link).toHaveAttribute('data-search', JSON.stringify({ segments: 'seg_beta' }))
  })

  it('pluralizes singular member count correctly', () => {
    render(
      <SegmentRow
        segment={{ ...MANUAL_SEGMENT, memberCount: 1 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onEvaluate={vi.fn()}
        isEvaluating={false}
      />
    )
    expect(screen.getByRole('link', { name: '1 person' })).toBeInTheDocument()
  })
})
