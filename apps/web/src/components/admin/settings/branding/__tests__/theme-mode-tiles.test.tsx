// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeModeTiles } from '../theme-mode-tiles'

afterEach(cleanup)

describe('ThemeModeTiles', () => {
  it('offers Light, Dark and Visitor chooses as radios', () => {
    render(<ThemeModeTiles value="user" onChange={() => {}} />)
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ])
    expect(screen.getByText('Light')).toBeTruthy()
    expect(screen.getByText('Dark')).toBeTruthy()
    expect(screen.getByText('Visitor chooses')).toBeTruthy()
  })

  it('selects Light and Dark from a visitor-chooses value', async () => {
    const onChange = vi.fn()
    render(<ThemeModeTiles value="user" onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Light'))
    await user.click(screen.getByText('Dark'))
    expect(onChange.mock.calls).toEqual([['light'], ['dark']])
  })

  it('maps each tile to its theme mode', async () => {
    const onChange = vi.fn()
    render(<ThemeModeTiles value="light" onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Dark'))
    await user.click(screen.getByText('Visitor chooses'))
    expect(onChange.mock.calls).toEqual([['dark'], ['user']])
  })
})
