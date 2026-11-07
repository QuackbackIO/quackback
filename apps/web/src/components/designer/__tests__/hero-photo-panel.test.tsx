// @vitest-environment happy-dom
/**
 * A hero photo from a brand match in the builder: the hero's panel says on
 * hover that the photo was cut from the screenshot, offers to replace it
 * with the original, to crop it again from the photo it came from, or to
 * remove it; a hero with no image adds one with "+"; and the brand match's
 * follow-up chip "Add a hero photo" uploads a photo rather than filling the
 * request box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const uploads = vi.hoisted(() => ({ asked: [] as string[], cropped: [] as unknown[] }))
vi.mock('@/lib/server/functions/uploads', () => ({
  getBandImageUploadUrlFn: async ({ data }: { data: { filename: string } }) => {
    uploads.asked.push(data.filename)
    return { uploadUrl: 'https://storage.test/put', key: `portal-images/${data.filename}` }
  },
}))
vi.mock('@/lib/client/hero-photo-crop', () => ({
  cropPhoto: async (url: string, box: unknown) => {
    uploads.cropped.push({ url, box })
    return new File(['x'], 'recrop.jpg', { type: 'image/jpeg' })
  },
}))

const { HeroPanel } = await import('../hero-panel')
const { AskAiPanel } = await import('@/components/admin/settings/appearance/ask-ai-panel')

const fromShot = (): PortalDesign => {
  const d = defaultDesign()
  d.layout.band = 'brand'
  d.layout.imagePlace = 'cover'
  d.brand.bandImage = {
    key: 'portal-images/hero.jpg',
    alt: 'A lake',
    screenshot: { key: 'portal-images/hero-source.jpg', box: { x: 0, y: 0, w: 1, h: 0.7 } },
    shade: { tone: 'dark', strength: 40, under: '#333333' },
  }
  return d
}

function show(start: PortalDesign) {
  const seen = { design: start, labels: [] as Array<string | undefined> }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <HeroPanel
        crumbs={[{ label: 'Hero' }]}
        design={design}
        page="home"
        gates={{
          feedback: true,
          roadmap: true,
          changelog: true,
          help: true,
          support: true,
          status: true,
        }}
        locale="en"
        say={() => {}}
        update={(change, label) => {
          const next = structuredClone(seen.design)
          change(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
      />
    )
  }
  render(<Harness />)
  return seen
}

/** Pictures load at once, 1600 by 900. */
class LoadedImage {
  onload: (() => void) | null = null
  naturalWidth = 1600
  naturalHeight = 900
  set src(_: string) {
    setTimeout(() => this.onload?.(), 0)
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 }))
  )
})
afterEach(() => {
  cleanup()
  uploads.asked = []
  uploads.cropped = []
  vi.unstubAllGlobals()
})

describe('a hero photo cut from a screenshot, in the hero’s panel', () => {
  it('says where it came from and asks for the original', () => {
    show(fromShot())
    expect(screen.getByRole('img', { name: MATCH_BRAND.fromScreenshot })).toBeTruthy()
    expect(screen.queryByText(MATCH_BRAND.fromScreenshot)).toBeNull()
    expect(screen.getByRole('button', { name: MATCH_BRAND.adjustCrop })).toBeTruthy()
    expect(screen.getByText('Replace')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeTruthy()
  })

  it('crops it again from the photo it came from, as a new image', async () => {
    vi.stubGlobal('Image', LoadedImage)
    const seen = show(fromShot())
    fireEvent.click(screen.getByRole('button', { name: MATCH_BRAND.adjustCrop }))
    const save = await screen.findByRole('button', { name: MATCH_BRAND.save })
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() => expect(seen.design.brand.bandImage?.key).toBe('portal-images/recrop.jpg'))
    expect(uploads.cropped).toEqual([
      { url: '/api/storage/portal-images/hero-source.jpg', box: { x: 0, y: 0, w: 1, h: 0.7 } },
    ])
    // Still from the screenshot, its description kept.
    expect(seen.design.brand.bandImage).toMatchObject({
      alt: 'A lake',
      screenshot: { key: 'portal-images/hero-source.jpg' },
    })
    expect(seen.labels).toEqual(['Hero: Image'])
  })

  it('is no longer marked once the original replaces it', async () => {
    const seen = show(fromShot())
    const file = new File(['x'], 'original.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Replace'), { target: { files: [file] } })
    await waitFor(() =>
      expect(seen.design.brand.bandImage).toEqual({ key: 'portal-images/original.jpg' })
    )
    expect(screen.queryByRole('button', { name: MATCH_BRAND.adjustCrop })).toBeNull()
  })

  it('shows on Home only, or on every page again', () => {
    const start = fromShot()
    start.brand.bandImage!.homeOnly = true
    const seen = show(start)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to every page' }))
    expect(seen.design.brand.bandImage).not.toHaveProperty('homeOnly')
    // Its crop and description stay.
    expect(seen.design.brand.bandImage).toMatchObject({
      key: 'portal-images/hero.jpg',
      alt: 'A lake',
    })
  })

  it('is removed like any image', () => {
    const seen = show(fromShot())
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(seen.design.brand.bandImage).toBeUndefined()
  })
})

describe('Add a hero photo', () => {
  it('is the image section’s "+" while the hero has no image, and uploads one', async () => {
    const seen = show(defaultDesign())
    const file = new File(['x'], 'team.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText(MATCH_BRAND.addHeroPhoto), { target: { files: [file] } })
    await waitFor(() =>
      expect(seen.design.brand.bandImage).toEqual({ key: 'portal-images/team.jpg' })
    )
  })

  it('is not offered once the hero has an image', () => {
    show(fromShot())
    expect(screen.queryByLabelText(MATCH_BRAND.addHeroPhoto)).toBeNull()
  })

  it('uploads from the brand match’s follow-ups instead of filling the request box', async () => {
    const onChip = vi.fn()
    const onHeroPhoto = vi.fn()
    render(
      <AskAiPanel
        available
        turns={[
          { role: 'user', text: 'match my brand' },
          { role: 'assistant', text: 'Matched.', chips: [MATCH_BRAND.addHeroPhoto, 'Calmer hero'] },
        ]}
        busy={false}
        design={defaultDesign()}
        update={() => {}}
        onWiden={() => {}}
        onChip={onChip}
        onHeroPhoto={onHeroPhoto}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Calmer hero' }))
    expect(onChip).toHaveBeenCalledWith('Calmer hero')
    const file = new File(['x'], 'lake.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText(MATCH_BRAND.addHeroPhoto), { target: { files: [file] } })
    await waitFor(() => expect(onHeroPhoto).toHaveBeenCalledWith('portal-images/lake.jpg'))
    expect(onChip).toHaveBeenCalledTimes(1)
  })
})
