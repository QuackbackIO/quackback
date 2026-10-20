// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSDK } from '../src/core/sdk'

const origin = 'https://feedback.example.test'
const source = { postMessage: vi.fn() } as unknown as Window

vi.mock('../src/core/panel', () => ({
  createPanel: () => ({
    iframe: document.createElement('iframe'),
    show() {},
    hide() {},
    destroy() {},
    setPlacement() {},
    setExpanded() {},
  }),
}))

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(source)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  )
  // Build the panel (and its bridge) during init, so a ready message is heard.
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn((cb: () => void) => {
      cb()
      return 1
    })
  )
  vi.stubGlobal('cancelIdleCallback', vi.fn())
  vi.mocked(source.postMessage).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fromIframe(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { origin, source, data }))
}

const sent = (type: string) =>
  vi
    .mocked(source.postMessage)
    .mock.calls.filter(([message]) => (message as { type: string }).type === type)
    .map(([message]) => (message as { data: Record<string, unknown> }).data)

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('Quackback.attach', () => {
  it('refuses before init', async () => {
    const sdk = createSDK()
    await expect(sdk.dispatch('attach', png(), { name: 'a.png' })).rejects.toThrow(
      'ATTACHMENT_UNAVAILABLE'
    )
  })

  it('refuses a non-Blob, an empty Blob and a bad name without contacting the iframe', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fromIframe({ type: 'quackback:ready' })
    for (const [file, options] of [
      ['bytes', { name: 'a.png' }],
      [new Blob([]), { name: 'a.png' }],
      [png(), { name: 'dir/a.png' }],
      [png(), {}],
    ] as const) {
      await expect(sdk.dispatch('attach', file, options)).rejects.toThrow('ATTACHMENT_INVALID')
    }
    expect(sent('quackback:attach')).toHaveLength(0)
    sdk.dispatch('destroy')
  })

  it('queues until ready, opens the chat view first, and posts the identical Blob', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    const file = png()
    const result = sdk.dispatch('attach', file, { name: 'shot.png' }) as Promise<unknown>
    expect(sent('quackback:attach')).toHaveLength(0)
    fromIframe({ type: 'quackback:ready' })
    const calls = vi
      .mocked(source.postMessage)
      .mock.calls.map(([m]) => (m as { type: string }).type)
    expect(calls.indexOf('quackback:open')).toBeLessThan(calls.indexOf('quackback:attach'))
    expect(sent('quackback:open').at(-1)).toEqual({ view: 'chat' })
    const [message] = sent('quackback:attach')
    expect(message.file).toBe(file)
    expect(message.name).toBe('shot.png')
    fromIframe({
      type: 'quackback:attach-result',
      requestId: message.requestId,
      ok: true,
      name: 'shot.png',
      size: 3,
    })
    await expect(result).resolves.toEqual({ name: 'shot.png', size: 3 })
    sdk.dispatch('destroy')
  })

  it('takes the name from a File', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fromIframe({ type: 'quackback:ready' })
    const pending = sdk.dispatch(
      'attach',
      new File([new Uint8Array([1])], 'from-file.png', { type: 'image/png' })
    )
    ;(pending as Promise<unknown>).catch(() => {})
    expect(sent('quackback:attach')[0].name).toBe('from-file.png')
    sdk.dispatch('destroy')
  })

  it('rejects with the closed code the iframe reports, and maps anything else to unavailable', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fromIframe({ type: 'quackback:ready' })
    const tooLarge = sdk.dispatch('attach', png(), { name: 'a.png' }) as Promise<unknown>
    const odd = sdk.dispatch('attach', png(), { name: 'b.png' }) as Promise<unknown>
    const [first, second] = sent('quackback:attach')
    fromIframe({
      type: 'quackback:attach-result',
      requestId: first.requestId,
      ok: false,
      error: 'ATTACHMENT_TOO_LARGE',
    })
    fromIframe({
      type: 'quackback:attach-result',
      requestId: second.requestId,
      ok: false,
      error: 'SOMETHING_ELSE',
    })
    await expect(tooLarge).rejects.toThrow('ATTACHMENT_TOO_LARGE')
    await expect(odd).rejects.toThrow('ATTACHMENT_UNAVAILABLE')
    sdk.dispatch('destroy')
  })

  it('ignores a result for an unknown request', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fromIframe({ type: 'quackback:ready' })
    const pending = sdk.dispatch('attach', png(), { name: 'a.png' }) as Promise<unknown>
    fromIframe({
      type: 'quackback:attach-result',
      requestId: 'someone-else',
      ok: true,
      name: 'x',
      size: 1,
    })
    const [message] = sent('quackback:attach')
    fromIframe({
      type: 'quackback:attach-result',
      requestId: message.requestId,
      ok: true,
      name: 'a.png',
      size: 3,
    })
    await expect(pending).resolves.toEqual({ name: 'a.png', size: 3 })
    sdk.dispatch('destroy')
  })

  it('times out when the instance never answers (an instance without the command)', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fromIframe({ type: 'quackback:ready' })
    const timers = vi.spyOn(window, 'setTimeout')
    const pending = sdk.dispatch('attach', png(), { name: 'a.png' }) as Promise<unknown>
    const deadline = timers.mock.calls.find(([, delay]) => delay === 15_000)
    expect(deadline).toBeDefined()
    ;(deadline![0] as () => void)()
    await expect(pending).rejects.toThrow('ATTACHMENT_UNAVAILABLE')
    sdk.dispatch('destroy')
  })

  it('rejects everything still waiting on destroy', async () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    const queued = sdk.dispatch('attach', png(), { name: 'a.png' }) as Promise<unknown>
    sdk.dispatch('destroy')
    await expect(queued).rejects.toThrow('ATTACHMENT_UNAVAILABLE')
  })
})
