import { deflateSync } from 'node:zlib'
import type { Locator, Page, Route } from '@playwright/test'

function crc32(data: Buffer): number {
  let c = ~0
  for (const b of data) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Landscape RGB PNG so thumbs can be asserted as not 1:1. */
export function landscapePng(width = 60, height = 20): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3
      raw[i] = 30
      raw[i + 1] = 80
      raw[i + 2] = 200
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const LEGACY_WIDE_PNG = 'e2e-legacy-wide.png'
export const PASTED_PNG = 'e2e-pasted.png'
export const WIDGET_PNG = 'e2e-widget.png'
export const CHANGELOG_PNG = 'e2e-changelog.png'

/** Serve fixture PNGs and stub upload endpoints so e2e never hits MinIO. */
export async function stubConversationImageNetwork(page: Page): Promise<Buffer> {
  const png = landscapePng()
  const fulfillPng = async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: png })
  }

  await page.route('**/api/upload/image', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataBuffer()?.toString('utf8') ?? ''
    const prefix = /name="prefix"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? 'chat-images'
    const name = prefix.includes('changelog') ? CHANGELOG_PNG : PASTED_PNG
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ publicUrl: `/api/storage/${prefix}/${name}` }),
    })
  })

  await page.route('**/api/widget/upload', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ publicUrl: `/api/storage/chat-images/${WIDGET_PNG}` }),
    })
  })

  await page.route(`**/api/storage/chat-images/${LEGACY_WIDE_PNG}*`, fulfillPng)
  await page.route(`**/api/storage/chat-images/${PASTED_PNG}*`, fulfillPng)
  await page.route(`**/api/storage/chat-images/${WIDGET_PNG}*`, fulfillPng)
  await page.route(`**/api/storage/changelog-images/${CHANGELOG_PNG}*`, fulfillPng)

  return png
}

export async function pasteImageOn(locator: Locator, png: Buffer, name = 'shot.png') {
  const handle = await locator.elementHandle()
  if (!handle) throw new Error('paste target is not attached')
  await locator.page().evaluate(
    ({ el, b64, fileName }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const file = new File([bytes], fileName, { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const ev = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clipboardData', { value: dt })
      el.dispatchEvent(ev)
    },
    { el: handle, b64: png.toString('base64'), fileName: name }
  )
}

export async function expectLandscapeContainThumb(button: Locator) {
  const img = button.locator('img')
  await img.waitFor({ state: 'visible' })
  const className = (await img.getAttribute('class')) ?? ''
  if (!className.split(/\s+/).includes('object-contain')) {
    throw new Error(`expected object-contain on thumb, got "${className}"`)
  }
  const box = await img.boundingBox()
  if (!box) throw new Error('thumb has no box')
  if (box.width <= box.height * 1.4) {
    throw new Error(
      `expected landscape thumb, got ${Math.round(box.width)}×${Math.round(box.height)}`
    )
  }
}
