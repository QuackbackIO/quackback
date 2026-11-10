// @vitest-environment happy-dom
/** A mix of headline size, spacing and capitals that no tile makes shows each part. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'
import { TypeStyleControls } from '../type-shape-controls'

afterEach(cleanup)

describe('TypeStyleControls', () => {
  it('shows each part of a mix no tile makes, and only then', () => {
    const tiled = defaultDesign()
    render(<TypeStyleControls design={tiled} update={() => {}} />)
    expect(screen.queryByRole('radiogroup', { name: 'Capitals' })).toBeNull()
    cleanup()
    const mixed = defaultDesign()
    Object.assign(mixed.brand.fonts, {
      scale: 'display',
      tracking: 'normal',
      headlineCase: 'upper',
    })
    render(<TypeStyleControls design={mixed} update={() => {}} />)
    const capitals = screen.getByRole('radiogroup', { name: 'Capitals' })
    expect(capitals.querySelector('[aria-checked="true"]')!.textContent).toBe('Capitals')
  })
})
