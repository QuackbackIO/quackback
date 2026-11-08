// @vitest-environment happy-dom
/**
 * A hero image is stored with its smaller copies, recorded with their widths
 * in the design; a copy that fails is left out, the image itself must store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const prepared = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/client/hero-image', () => ({ prepareHeroImage: async () => prepared.value }))

const { useHeroImageUpload } = await import('../use-image-upload')

const file = (name: string) => new File(['x'], name, { type: 'image/webp' })
const presign = vi.fn(async (each: File) => ({
  uploadUrl: `https://storage.test/${each.name}`,
  key: `portal-images/${each.name}`,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  presign.mockClear()
})

function upload(failing: string[] = []) {
  const put = vi.fn(async (url: string) => ({ ok: !failing.some((name) => url.endsWith(name)) }))
  vi.stubGlobal('fetch', put)
  const onUploaded = vi.fn()
  const { result } = renderHook(() => useHeroImageUpload(presign, onUploaded))
  return { result, onUploaded, put }
}

describe('useHeroImageUpload', () => {
  it('stores the image and its copies, and records their widths', async () => {
    prepared.value = {
      file: file('room.webp'),
      width: 2560,
      copies: [
        { file: file('room-640.webp'), width: 640 },
        { file: file('room-1280.webp'), width: 1280 },
      ],
    }
    const { result, onUploaded, put } = upload()
    await act(() => result.current.upload(file('room.png')))
    expect(put).toHaveBeenCalledTimes(3)
    expect(onUploaded).toHaveBeenCalledWith({
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [
        { key: 'portal-images/room-640.webp', w: 640 },
        { key: 'portal-images/room-1280.webp', w: 1280 },
      ],
    })
  })

  it('leaves out a copy that fails to store', async () => {
    prepared.value = {
      file: file('room.webp'),
      width: 2560,
      copies: [
        { file: file('room-640.webp'), width: 640 },
        { file: file('room-1280.webp'), width: 1280 },
      ],
    }
    const { result, onUploaded } = upload(['room-640.webp'])
    await act(() => result.current.upload(file('room.png')))
    expect(onUploaded.mock.calls[0]![0].variants).toEqual([
      { key: 'portal-images/room-1280.webp', w: 1280 },
    ])
  })

  it('stores an image it could not read as it is, as one file', async () => {
    prepared.value = { file: file('anim.gif'), width: null, copies: [] }
    const { result, onUploaded } = upload()
    await act(() => result.current.upload(file('anim.gif')))
    expect(onUploaded).toHaveBeenCalledWith({ key: 'portal-images/anim.gif' })
  })

  it('says so, and changes nothing, when the image itself fails to store', async () => {
    prepared.value = { file: file('room.webp'), width: 2560, copies: [] }
    const { result, onUploaded } = upload(['room.webp'])
    await act(() => result.current.upload(file('room.png')))
    expect(onUploaded).not.toHaveBeenCalled()
    expect(result.current.problem).toBe('room.png could not be uploaded.')
  })
})
