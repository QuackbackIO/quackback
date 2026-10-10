// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SunIcon } from '@heroicons/react/24/solid'
import { PreviewToggleButton } from '../preview-toggle'

afterEach(cleanup)

describe('PreviewToggleButton', () => {
  it('renders a text-only segment without an icon', () => {
    const { container } = render(<PreviewToggleButton active onClick={() => {}} label="Light" />)
    expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders the icon when one is given', () => {
    const { container } = render(
      <PreviewToggleButton active onClick={() => {}} icon={SunIcon} label="Light" />
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
