// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NewButton } from '../new-button'

afterEach(cleanup)

describe('NewButton', () => {
  it('reads "New {noun}" with a plus icon', () => {
    render(<NewButton noun="post" />)
    const btn = screen.getByRole('button', { name: 'New post' })
    expect(btn.querySelector('svg')).toBeTruthy()
  })

  it('is a small primary button', () => {
    render(<NewButton noun="post" />)
    const btn = screen.getByRole('button', { name: 'New post' })
    expect(btn.className).toContain('bg-primary')
    expect(btn.className).toContain('h-8')
  })

  it('lets children override the label', () => {
    render(<NewButton noun="post">Neuer Beitrag</NewButton>)
    expect(screen.getByRole('button', { name: 'Neuer Beitrag' })).toBeTruthy()
    expect(screen.queryByText('New post')).toBeNull()
  })

  it('forwards button props', () => {
    const onClick = vi.fn()
    render(<NewButton noun="tag" onClick={onClick} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'New tag' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('asChild styles a link and keeps it a link', () => {
    render(
      <NewButton noun="board" asChild>
        <a href="/admin/boards/new" />
      </NewButton>
    )
    const link = screen.getByRole('link', { name: 'New board' })
    expect(link.getAttribute('href')).toBe('/admin/boards/new')
    expect(link.className).toContain('bg-primary')
    expect(link.querySelector('svg')).toBeTruthy()
  })

  it('asChild keeps the child label when it has one', () => {
    render(
      <NewButton noun="board" asChild>
        <a href="/x">Neues Board</a>
      </NewButton>
    )
    expect(screen.getByRole('link', { name: 'Neues Board' })).toBeTruthy()
  })
})
