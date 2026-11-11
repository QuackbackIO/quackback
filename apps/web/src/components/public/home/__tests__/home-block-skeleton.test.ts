/**
 * A Home block that waits on its data holds about the room it will draw in,
 * so the blocks below it and the footer do not move when it streams in.
 * The heights are the blocks' drawn heights on the bench's designed portals.
 */
import { describe, expect, it } from 'vitest'
import { blockSkeletonHeight, type HomeBlock } from '../home-blocks'

/** A `calc(a rem + n * b rem)` or `a rem` height, in px. */
function px(height: string | undefined): number {
  if (!height) return 0
  const calc = /^calc\(([\d.]+)rem \+ (\d+) \* ([\d.]+)rem\)$/.exec(height)
  if (calc) return (Number(calc[1]) + Number(calc[2]) * Number(calc[3])) * 16
  return Number(/^([\d.]+)rem$/.exec(height)![1]) * 16
}

const block = (type: string, count?: number) => ({ type, count }) as unknown as HomeBlock

describe('a waiting Home block holds its room', () => {
  it.each([
    ['ideas', 3, 324],
    ['ideas', 5, 474],
    ['updates', 3, 282],
    ['updates', 4, 338],
  ])('%s with %i rows holds about %ipx', (type, count, drawn) => {
    expect(Math.abs(px(blockSkeletonHeight(block(type, count))) - drawn)).toBeLessThan(12)
  })

  it('holds a topics block at its drawn height', () => {
    expect(Math.abs(px(blockSkeletonHeight(block('help_topics'))) - 247)).toBeLessThan(12)
  })
})
