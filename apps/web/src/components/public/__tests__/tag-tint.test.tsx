// @vitest-environment happy-dom
/**
 * Tags are marked as status markers are: in the brand's colours where the
 * design maps statuses to them, and plain where it draws them in the ink.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StatusColourContext } from '@/components/ui/status-badge'
import { TAG_TINT, useTagStyle } from '../tag-tint'

function Chip({ colour }: { colour: string | null }) {
  const style = useTagStyle()
  return (
    <span data-qb-part="tag" className={TAG_TINT} style={style(colour)}>
      tag
    </span>
  )
}

const chip = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-qb-part=tag]')!

describe('a tag chip', () => {
  it('is tinted with its colour as the page shows it', () => {
    const { container } = render(
      <StatusColourContext.Provider value={() => '#2f5d3a'}>
        <Chip colour="#ec4899" />
      </StatusColourContext.Provider>
    )
    expect(chip(container).style.getPropertyValue('--qb-tag')).toBe('#2f5d3a')
  })

  it('reads in the ink, and turns plain where statuses are in the ink', () => {
    const { container } = render(<Chip colour={null} />)
    expect(chip(container).style.getPropertyValue('--qb-tag')).toBe('var(--muted-foreground)')
    expect(TAG_TINT).toContain('text-foreground')
    expect(TAG_TINT).toContain('[[data-qb-status=ink]_&]:[background:var(--muted)]')
  })
})
