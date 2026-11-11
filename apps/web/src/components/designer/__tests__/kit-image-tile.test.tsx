// @vitest-environment happy-dom
/**
 * A brand kit image tile: an empty one takes the builder's colours, so in
 * dark mode it is not a bright box in the design's page colour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/lib/server/functions/uploads', () => ({}))
const { KitImageTile } = await import('../kit-image-tile')

afterEach(cleanup)

const tile = (url: string | null) =>
  render(
    <KitImageTile
      label="Icon"
      url={url}
      accept="image/png"
      presign={vi.fn()}
      onUploaded={vi.fn()}
      backdrop="#ffffff"
    />
  ).container.querySelector('label > span') as HTMLElement

describe('KitImageTile', () => {
  it('draws an empty tile in the builder’s colours, not the design’s page', () => {
    expect(tile(null).style.background).toBe('')
  })

  it('shows an image on the design’s page colour', () => {
    expect(tile('/icon.png').style.background).not.toBe('')
  })
})
