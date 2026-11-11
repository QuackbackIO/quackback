// @vitest-environment happy-dom
/**
 * The portal's placeholders draw in ui/Skeleton's look through one class,
 * qb-skeleton, so a page's loading markup stays small and the look is
 * defined once for it.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton } from '@/components/ui/skeleton'
import { portalUtility } from '@/test/portal-utilities'

describe('qb-skeleton', () => {
  it('applies the look ui/Skeleton draws', () => {
    const rule = portalUtility('qb-skeleton')
    const applied = rule.match(/@apply ([^;]+);/)![1]!.split(' ')
    const { container } = render(<Skeleton />)
    const skeleton = container.querySelector('[data-slot=skeleton]')!.className.split(' ')
    // Its pulse rests under reduced motion by the global rule (reduced-motion.test.ts).
    expect(skeleton.filter((name) => !name.startsWith('motion-reduce:'))).toEqual(
      expect.arrayContaining(applied)
    )
    expect(applied).toEqual(expect.arrayContaining(['rounded-md', 'bg-muted', 'animate-pulse']))
  })
})
