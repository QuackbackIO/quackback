// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsSectionSelect } from '../analytics-section-select'
import { SECTION_NAV_ITEMS } from '../analytics-sections'

describe('<AnalyticsSectionSelect>', () => {
  it('renders the active section label in the trigger', () => {
    render(<AnalyticsSectionSelect items={SECTION_NAV_ITEMS} value="feedback" onChange={vi.fn()} />)
    // Radix Select renders the selected value text inside the trigger.
    expect(screen.getByText('Feedback')).toBeInTheDocument()
  })

  it('exposes an accessible combobox labelled "Section"', () => {
    render(<AnalyticsSectionSelect items={SECTION_NAV_ITEMS} value="overview" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Section' })).toBeInTheDocument()
  })
})
