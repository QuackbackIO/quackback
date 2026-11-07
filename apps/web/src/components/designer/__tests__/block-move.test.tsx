// @vitest-environment happy-dom
/**
 * A Home block moves without dragging: Move up, Move down, and Move to a
 * place picked from a list (WCAG 2.5.7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BlockMove, placeOfPosition } from '../block-move'

afterEach(cleanup)

const names = ['Welcome', 'Top posts', 'Roadmap', 'Status']

function show(index: number) {
  const onMove = vi.fn()
  const onPlace = vi.fn()
  render(<BlockMove names={names} index={index} onMove={onMove} onPlace={onPlace} />)
  return { onMove, onPlace }
}

describe('BlockMove', () => {
  it('moves a block one place up or down', () => {
    const { onMove } = show(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }))
    expect(onMove.mock.calls).toEqual([[-1], [1]])
  })

  it('cannot move the first block up or the last one down', () => {
    show(0)
    expect(screen.getByRole('button', { name: 'Move up' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Move down' })).toHaveProperty('disabled', false)
    cleanup()
    show(3)
    expect(screen.getByRole('button', { name: 'Move down' })).toHaveProperty('disabled', true)
  })

  it('keeps focus on the other move when a move reaches an end', async () => {
    show(1)
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    await act(() => new Promise((done) => requestAnimationFrame(() => done(null))))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move down' }))
  })

  const openPlaces = async () => {
    const places = screen.getByRole('combobox', { name: 'Move to' })
    places.focus()
    fireEvent.keyDown(places, { key: 'ArrowDown' })
    await screen.findAllByRole('option')
  }

  it('offers every place by number and the block there', async () => {
    show(1)
    await openPlaces()
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '1 · Welcome',
      '2 · Top posts (here)',
      '3 · Roadmap',
      '4 · Status',
    ])
  })

  it('moves to the place picked, counted as the list reads now', async () => {
    const { onPlace } = show(1)
    await openPlaces()
    const status = screen.getByRole('option', { name: '4 · Status' })
    fireEvent.pointerDown(status)
    fireEvent.pointerUp(status)
    fireEvent.click(status)
    expect(onPlace).toHaveBeenCalledWith(3)
  })
})

describe('placeOfPosition', () => {
  it('turns a final position into a place counted before the block is taken out', () => {
    // From second to last of four: the gap after the fourth.
    expect(placeOfPosition(1, 3)).toBe(4)
    // From last to first: the gap before the first.
    expect(placeOfPosition(3, 0)).toBe(0)
    expect(placeOfPosition(2, 2)).toBe(2)
  })
})
