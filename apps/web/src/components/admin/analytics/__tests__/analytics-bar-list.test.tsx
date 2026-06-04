// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsBarList } from '../analytics-bar-list'

describe('<AnalyticsBarList>', () => {
  const rows = [
    { key: 'a', label: 'Alpha', value: 10 },
    { key: 'b', label: 'Beta', value: 5 },
  ]

  it('renders the header labels', () => {
    render(<AnalyticsBarList header={{ label: 'Name', value: 'Count' }} rows={rows} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Count')).toBeInTheDocument()
  })

  it('renders one row per item with formatted values', () => {
    render(<AnalyticsBarList header={{ label: 'Name', value: 'Count' }} rows={rows} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('prefers an explicit display string over the numeric value', () => {
    render(
      <AnalyticsBarList
        header={{ label: 'Name', value: 'Views' }}
        rows={[{ key: 'a', label: 'Alpha', value: 1234, display: '1,234' }]}
      />
    )
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })
})
