// @vitest-environment happy-dom
/**
 * The portal's moving parts ask Motion for reduced motion as the visitor's
 * device does, the way `<MotionConfig reducedMotion="user">` would, while
 * keeping whatever an outer config already set.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useContext } from 'react'
import { cleanup, render } from '@testing-library/react'
import { MotionConfig, MotionConfigContext } from 'framer-motion'
import { MotionAsAsked } from '../motion-as-asked'

afterEach(cleanup)

let seen: React.ContextType<typeof MotionConfigContext> | null = null
function Probe() {
  seen = useContext(MotionConfigContext)
  return null
}

describe('MotionAsAsked', () => {
  it('asks for reduced motion as the device does', () => {
    render(
      <MotionAsAsked>
        <Probe />
      </MotionAsAsked>
    )
    expect(seen?.reducedMotion).toBe('user')
  })

  it('keeps what an outer config set', () => {
    const transformPagePoint = (point: { x: number; y: number }) => point
    render(
      <MotionConfig reducedMotion="always" transformPagePoint={transformPagePoint}>
        <MotionAsAsked>
          <Probe />
        </MotionAsAsked>
      </MotionConfig>
    )
    expect(seen?.reducedMotion).toBe('user')
    expect(seen?.transformPagePoint).toBe(transformPagePoint)
  })
})
