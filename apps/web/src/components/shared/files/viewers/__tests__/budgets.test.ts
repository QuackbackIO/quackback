import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync, type Zippable } from 'fflate'
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  checkZipBudget,
  withTimeout,
  BudgetTimeoutError,
} from '../budgets'

function zipOf(files: Zippable): Uint8Array {
  return zipSync(files, { level: 1 })
}

/** Rewrites every central directory entry's declared uncompressed size. */
function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer)
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true)
  }
  return out
}

describe('checkZipBudget', () => {
  it('passes a small package and reports what its index declares', () => {
    const zip = zipOf({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document>hello</w:document>'),
    })
    const result = checkZipBudget(zip)
    expect(result).toEqual({ ok: true, entries: 2, uncompressedBytes: 38 })
  })

  it('refuses more entries than the budget allows', () => {
    const files: Zippable = {}
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f/${i}.xml`] = strToU8('x')
    expect(checkZipBudget(zipOf(files))).toEqual({ ok: false, failure: 'too_large' })
  })

  it('passes exactly the entry budget', () => {
    const files: Zippable = {}
    for (let i = 0; i < MAX_ZIP_ENTRIES; i++) files[`f/${i}.xml`] = strToU8('x')
    expect(checkZipBudget(zipOf(files))).toMatchObject({ ok: true, entries: MAX_ZIP_ENTRIES })
  })

  it('refuses a package that unpacks past the size budget, without inflating it', () => {
    // Sixteen 10 MB entries of zeros: about 160 MB declared, a few hundred KB packed.
    const chunk = new Uint8Array(10 * 1024 * 1024)
    const files: Zippable = {}
    for (let i = 0; i < 16; i++) files[`xl/worksheets/sheet${i}.xml`] = chunk
    const zip = zipOf(files)
    expect(zip.length).toBeLessThan(1024 * 1024)
    expect(16 * chunk.length).toBeGreaterThan(MAX_ZIP_UNCOMPRESSED_BYTES)
    expect(checkZipBudget(zip)).toEqual({ ok: false, failure: 'too_large' })
  })

  it('honours a smaller budget passed by the caller', () => {
    const zip = zipOf({ 'a.xml': new Uint8Array(4096) })
    expect(checkZipBudget(zip, { maxUncompressedBytes: 4095 })).toEqual({
      ok: false,
      failure: 'too_large',
    })
    expect(checkZipBudget(zip, { maxUncompressedBytes: 4096 })).toMatchObject({ ok: true })
  })

  it('refuses an entry claiming a ratio no deflate stream can reach', () => {
    const zip = zipOf({ 'word/document.xml': strToU8('<w:document>tiny</w:document>') })
    const lying = withDeclaredSize(zip, 50 * 1024 * 1024)
    expect(checkZipBudget(lying)).toEqual({ ok: false, failure: 'too_large' })
  })

  it('reports bytes that are not a zip as corrupt', () => {
    expect(checkZipBudget(strToU8('just some text, not a package'))).toEqual({
      ok: false,
      failure: 'corrupt',
    })
    expect(checkZipBudget(new Uint8Array(0))).toEqual({ ok: false, failure: 'corrupt' })
  })
})

describe('withTimeout', () => {
  it('resolves with the work when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })

  it('rejects with a timeout error when the work outlives the budget', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<number>(() => {})
      const pending = withTimeout(never, 15_000)
      const settled = expect(pending).rejects.toBeInstanceOf(BudgetTimeoutError)
      await vi.advanceTimersByTimeAsync(15_000)
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the work’s own failure through', async () => {
    const boom = new Error('bad file')
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom)
  })
})
