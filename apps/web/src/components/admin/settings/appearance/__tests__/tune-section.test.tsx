// @vitest-environment happy-dom
/**
 * Appearance's exact values: each one typed sets the design's tune, held
 * within its bounds; blank gives it back to the choices; clearing removes all.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { changeLabel } from '@/lib/shared/design/labels'
import { TuneSection } from '../tune-section'

let latest: PortalDesign

function Harness() {
  const [design, setDesign] = useState(defaultDesign())
  latest = design
  return (
    <TuneSection
      design={design}
      update={(change) =>
        setDesign((current) => {
          const draft = structuredClone(current)
          change(draft)
          return draft
        })
      }
    />
  )
}

afterEach(cleanup)

describe('Appearance’s exact values', () => {
  it('sets a value typed, within its bounds, and blank gives it back to the choices', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fine-tune' }))
    const size = screen.getByLabelText('Size', { selector: '#tune-headline-size' })
    fireEvent.change(size, { target: { value: '48' } })
    expect(latest.tune).toEqual({ headline: { size: 48 } })
    fireEvent.change(screen.getByLabelText('Height', { selector: '#tune-button-height' }), {
      target: { value: '400' },
    })
    expect(latest.tune?.button).toEqual({ height: 72 })
    fireEvent.change(size, { target: { value: '' } })
    expect(latest.tune).toEqual({ button: { height: 72 } })
  })

  it('clears every exact value at once', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fine-tune' }))
    fireEvent.change(screen.getByLabelText('Corners', { selector: '#tune-card-radius' }), {
      target: { value: '6' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear exact values' }))
    expect(latest.tune).toBeUndefined()
  })

  it('names its changes for the review list', () => {
    expect(changeLabel('tune.headline.size')).toBe('Headline exact values')
    expect(changeLabel('tune')).toBe('Exact values')
  })
})
