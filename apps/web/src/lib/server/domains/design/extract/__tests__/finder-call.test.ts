/**
 * The finder in the product: a screenshot data URL is decoded, sent to the
 * design model through structuredChat as a PNG with the finder schema and no
 * temperature, and comes back as snapped boxes; no model or an unreadable
 * screenshot gives null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const structuredChat = vi.fn()
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: (...args: unknown[]) => structuredChat(...args),
}))
vi.mock('../../ai/design-ai', () => ({
  designAiModel: () => 'anthropic/claude-haiku-5.5',
  designUsage: () => [],
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

import { findScreenshotElements } from '../finder-call'
import { FINDER_EXAMPLES, finderPrompt } from '../finder-prompt'
import { finderSchema } from '../finder-schema'
import { BOX_KINDS } from '../kinds'
import { decodePng, encodePng } from '../png'

function screenshot(): string {
  const width = 1440
  const height = 900
  const data = new Uint8Array(width * height * 4).fill(255)
  for (let y = 400; y < 444; y++)
    for (let x = 200; x < 320; x++) data.set([0, 88, 163, 255], (y * width + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng({ width, height, data })).toString('base64')}`
}

describe('findScreenshotElements', () => {
  beforeEach(() => {
    structuredChat.mockReset()
    structuredChat.mockResolvedValue({
      ...FINDER_EXAMPLES[0]!.output,
      ...Object.fromEntries(BOX_KINDS.map((k) => [k, 'none'])),
      primary_button: '190 392 330 452',
    })
  })

  it('returns the model’s boxes snapped to the screenshot', async () => {
    const found = await findScreenshotElements(screenshot())
    expect(found?.boxes.primary_button).toEqual([190, 392, 330, 452])
    expect(found?.snapped.primary_button).toEqual([200, 400, 320, 444])
    expect(found?.output.behind_headline).toBe('plain')
  })

  it('sends the image then the prompt, with the finder schema and no temperature', async () => {
    await findScreenshotElements(screenshot())
    const input = structuredChat.mock.calls[0]![0]
    expect(input.model).toBe('anthropic/claude-haiku-5.5')
    expect(input.schema).toBe(finderSchema)
    expect(input).not.toHaveProperty('temperature')
    const [picture, text] = input.messages[0].content
    expect(picture.source.mimeType).toBe('image/png')
    expect(decodePng(new Uint8Array(Buffer.from(picture.source.value, 'base64'))).width).toBe(1440)
    expect(text).toEqual({ type: 'text', content: finderPrompt(1440, 900) })
  })

  it('gives null without a model, for a bad screenshot, or when the call fails', async () => {
    expect(await findScreenshotElements(screenshot(), null)).toBeNull()
    expect(await findScreenshotElements('data:image/gif;base64,R0lGODlh')).toBeNull()
    structuredChat.mockRejectedValueOnce(new Error('structured output did not match'))
    expect(await findScreenshotElements(screenshot())).toBeNull()
    expect(structuredChat).toHaveBeenCalledTimes(1)
  })
})
