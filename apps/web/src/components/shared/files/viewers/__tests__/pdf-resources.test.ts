import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelfHostedBinaryData, pdfDocumentParams, selfHostedPdfFiles } from '../pdf-resources'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pdfDocumentParams', () => {
  it('loads from bytes with XFA, worker fetches and unbounded images off', () => {
    const data = new Uint8Array([1, 2, 3])
    const params = pdfDocumentParams(data)
    expect(params.data).toBe(data)
    expect(params.enableXfa).toBe(false)
    expect(params.useWorkerFetch).toBe(false)
    expect(params.BinaryDataFactory).toBe(SelfHostedBinaryData)
    expect(params.disableFontFace).toBe(false)
    expect(params.maxImageSize).toBe(2 ** 26)
  })

  it('names no URL, base URL or eval switch', () => {
    const params = pdfDocumentParams(new Uint8Array())
    for (const key of [
      'url',
      'docBaseUrl',
      'cMapUrl',
      'standardFontDataUrl',
      'wasmUrl',
      'iccUrl',
      'isEvalSupported',
      'password',
    ]) {
      expect(params).not.toHaveProperty(key)
    }
  })
})

describe('selfHostedPdfFiles', () => {
  it('ships the CMaps, the standard fonts and the image decoders from our own build', () => {
    const files = selfHostedPdfFiles()
    expect(Object.keys(files.cMapUrl).length).toBeGreaterThan(150)
    expect(files.cMapUrl['UniJIS-UCS2-H.bcmap']).toBeTypeOf('string')
    expect(files.standardFontDataUrl['FoxitSymbol.pfb']).toBeTypeOf('string')
    expect(files.standardFontDataUrl['LiberationSans-Regular.ttf']).toBeTypeOf('string')
    expect(files.wasmUrl['openjpeg.wasm']).toBeTypeOf('string')
    expect(files.wasmUrl['jbig2.wasm']).toBeTypeOf('string')
  })

  it('leaves out the scripting sandbox and the script fallbacks', () => {
    const { wasmUrl } = selfHostedPdfFiles()
    expect(Object.keys(wasmUrl).sort()).toEqual(['jbig2.wasm', 'openjpeg.wasm'])
  })
})

describe('SelfHostedBinaryData', () => {
  it('fetches a known file from its self-hosted URL', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([7, 8, 9])))
    vi.stubGlobal('fetch', fetchMock)
    const factory = new SelfHostedBinaryData()
    const bytes = await factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' })
    expect(Array.from(bytes)).toEqual([7, 8, 9])
    expect(fetchMock).toHaveBeenCalledWith(selfHostedPdfFiles().wasmUrl['openjpeg.wasm'])
  })

  it('refuses anything outside the shipped set without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const factory = new SelfHostedBinaryData()
    await expect(
      factory.fetch({ kind: 'cMapUrl', filename: '../../../etc/passwd' })
    ).rejects.toThrow()
    await expect(
      factory.fetch({ kind: 'wasmUrl', filename: 'quickjs-eval.wasm' })
    ).rejects.toThrow()
    await expect(
      factory.fetch({ kind: 'iccUrl', filename: 'CGATS001Compat-v2-micro.icc' })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the server does not return the file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 }))
    )
    const factory = new SelfHostedBinaryData()
    await expect(
      factory.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitSymbol.pfb' })
    ).rejects.toThrow()
  })
})
