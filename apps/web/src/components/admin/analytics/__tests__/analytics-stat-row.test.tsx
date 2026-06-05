// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsStatRow } from '../analytics-stat-row'

describe('<AnalyticsStatRow>', () => {
  it('renders a label, value, and suffix for each stat', () => {
    render(
      <AnalyticsStatRow
        stats={[
          { label: 'Avg rating', value: '5.0', suffix: '/ 5', delta: 12 },
          { label: 'Responses', value: '2' },
        ]}
      />
    )
    expect(screen.getByText('Avg rating')).toBeInTheDocument()
    expect(screen.getByText('5.0')).toBeInTheDocument()
    expect(screen.getByText('/ 5')).toBeInTheDocument()
    expect(screen.getByText('Responses')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the trend delta when provided', () => {
    render(<AnalyticsStatRow stats={[{ label: 'Posts', value: '14', delta: 12 }]} />)
    expect(screen.getByText(/\+12%/)).toBeInTheDocument()
  })

  it('omits the delta badge when no delta is given', () => {
    render(<AnalyticsStatRow stats={[{ label: 'Entries', value: '12' }]} />)
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('shows a scope caption for a snapshot stat with no delta', () => {
    render(<AnalyticsStatRow stats={[{ label: 'Followers', value: '4', caption: 'current' }]} />)
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it('renders no caption when none is given', () => {
    render(<AnalyticsStatRow stats={[{ label: 'Active users', value: '5' }]} />)
    expect(screen.queryByText('current')).toBeNull()
    expect(screen.queryByText('all time')).toBeNull()
  })

  it('prefers the delta over a caption when both are present', () => {
    render(
      <AnalyticsStatRow stats={[{ label: 'Posts', value: '14', delta: 12, caption: 'current' }]} />
    )
    expect(screen.getByText(/\+12%/)).toBeInTheDocument()
    expect(screen.queryByText('current')).toBeNull()
  })
})
