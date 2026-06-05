// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionSkeleton } from '../analytics-skeletons'

describe('<SectionSkeleton>', () => {
  it('feedback: matches the two-card Boards / Top posts layout', () => {
    render(<SectionSkeleton section="feedback" />)
    expect(screen.getByText('Boards')).toBeInTheDocument()
    expect(screen.getByText('Top posts')).toBeInTheDocument()
  })

  it('users: matches the signups-source card layout', () => {
    render(<SectionSkeleton section="users" />)
    expect(screen.getByText('Signups by source')).toBeInTheDocument()
  })

  it('overview and changelog do not render the feedback list cards', () => {
    const { rerender } = render(<SectionSkeleton section="overview" />)
    expect(screen.queryByText('Boards')).toBeNull()
    expect(screen.queryByText('Signups by source')).toBeNull()
    rerender(<SectionSkeleton section="changelog" />)
    expect(screen.queryByText('Boards')).toBeNull()
  })
})
