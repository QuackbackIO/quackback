// @vitest-environment happy-dom
/**
 * The pointer crosses scroll areas all the time: the admin rail, a list, a
 * thread. Nothing here styles whether the pointer is over one, so crossing it
 * renders nothing, while the area still scrolls its content.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Profiler } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScrollArea } from '../scroll-area'

afterEach(cleanup)

describe('ScrollArea', () => {
  it('renders nothing again as the pointer enters, moves over and leaves it', () => {
    let commits = 0
    const { container } = render(
      <Profiler id="area" onRender={() => commits++}>
        <ScrollArea className="h-40">
          <p>rows</p>
        </ScrollArea>
      </Profiler>
    )
    const root = container.querySelector('[data-slot="scroll-area"]')!
    const rows = screen.getByText('rows')
    const settled = commits

    fireEvent.pointerEnter(root)
    fireEvent.pointerMove(rows)
    fireEvent.pointerLeave(root)
    fireEvent.pointerEnter(root)
    fireEvent.pointerLeave(root)

    expect(commits).toBe(settled)
  })

  it('still lets a caller follow the pointer', () => {
    const entered: string[] = []
    const { container } = render(
      <ScrollArea onPointerEnter={() => entered.push('enter')}>
        <p>rows</p>
      </ScrollArea>
    )
    fireEvent.pointerEnter(container.querySelector('[data-slot="scroll-area"]')!)
    expect(entered).toEqual(['enter'])
  })
})
