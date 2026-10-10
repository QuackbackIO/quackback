// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsMetricStrip } from '../analytics-metric-strip'

const items = [
  { key: 'a', label: 'Posts', color: 'var(--primary)', value: 3, delta: null },
  { key: 'b', label: 'Votes', color: 'var(--primary)', value: 5, delta: null },
]

describe('<AnalyticsMetricStrip>', () => {
  it('does not uppercase tile labels', () => {
    render(<AnalyticsMetricStrip items={items} activeKey="a" onChange={vi.fn()} gridClassName="" />)
    expect(screen.getByText('Posts').className).not.toContain('uppercase')
  })

  it('keeps the active label in the foreground colour rather than the series colour', () => {
    render(<AnalyticsMetricStrip items={items} activeKey="a" onChange={vi.fn()} gridClassName="" />)
    expect(screen.getByText('Posts').getAttribute('style') ?? '').not.toContain('color')
  })
})
