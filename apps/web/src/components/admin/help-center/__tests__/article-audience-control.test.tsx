// @vitest-environment happy-dom
/**
 * The article editor's audience control restricts an article to visitor
 * segments: the trigger summarizes the current selection and the popover
 * lists every segment as a toggle.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { ArticleAudienceControl } from '../article-audience-control'

const SEGMENTS = [
  { id: 'seg_1', name: 'Enterprise' },
  { id: 'seg_2', name: 'Beta testers' },
]

describe('ArticleAudienceControl', () => {
  afterEach(cleanup)

  it('summarizes an unrestricted audience as everyone', () => {
    render(<ArticleAudienceControl segments={SEGMENTS} value={[]} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /audience/i }).textContent).toContain('Everyone')
  })

  it('shows the selected segment count on the trigger', () => {
    render(<ArticleAudienceControl segments={SEGMENTS} value={['seg_1']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /audience/i }).textContent).toContain('1')
  })

  it('toggles a segment from the popover list', () => {
    const onChange = vi.fn()
    render(<ArticleAudienceControl segments={SEGMENTS} value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /audience/i }))
    fireEvent.click(screen.getByText('Beta testers'))
    expect(onChange).toHaveBeenCalledWith(['seg_2'])
  })

  it('removes an already-selected segment', () => {
    const onChange = vi.fn()
    render(<ArticleAudienceControl segments={SEGMENTS} value={['seg_1']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /audience/i }))
    fireEvent.click(screen.getByText('Enterprise'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('explains the restriction inside the popover', () => {
    render(<ArticleAudienceControl segments={SEGMENTS} value={[]} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /audience/i }))
    expect(screen.getByText(/only visible to the selected segments/i)).toBeTruthy()
  })
})
