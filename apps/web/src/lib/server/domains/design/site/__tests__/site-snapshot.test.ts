import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordingFetcher, snapshotFetcher } from '../site-snapshot'
import type { FetchedBody, SiteFetcher } from '../types'

const enc = (s: string) => new TextEncoder().encode(s)
const limits = { maxBytes: 1_000, timeoutMs: 1_000 }

const responses: Record<string, FetchedBody> = {
  'https://acme.test/': {
    status: 200,
    url: 'https://www.acme.test/',
    contentType: 'text/html; charset=utf-8',
    body: enc('<html><title>Acme Parcel</title></html>'),
  },
  'https://acme.test/main.css': {
    status: 200,
    url: 'https://acme.test/main.css',
    contentType: 'text/css',
    body: enc('body{}'),
  },
  'https://acme.test/logo.png': {
    status: 200,
    url: 'https://acme.test/logo.png',
    contentType: 'image/png',
    body: new Uint8Array([0x89, 0x50, 1, 2]),
  },
}
const live: SiteFetcher = async (url) => responses[url] ?? null

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'site-snapshot-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('site snapshots', () => {
  it('records every request, including misses, and replays them from disk', async () => {
    const recorder = recordingFetcher(live, dir)
    await Promise.all([
      recorder('https://acme.test/', 'page', limits),
      recorder('https://acme.test/main.css', 'css', limits),
      recorder('https://acme.test/logo.png', 'image', limits),
      recorder('https://acme.test/missing.png', 'image', limits),
    ])
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest['https://acme.test/']).toMatchObject({
      status: 200,
      url: 'https://www.acme.test/',
      contentType: 'text/html; charset=utf-8',
      file: expect.stringMatching(/^files\/\d+\.html$/),
    })
    expect(manifest['https://acme.test/main.css'].file).toMatch(/\.css$/)
    expect(manifest['https://acme.test/logo.png'].file).toMatch(/\.png$/)
    expect(manifest['https://acme.test/missing.png']).toEqual({ missing: true })
    expect(await readdir(join(dir, 'files'))).toHaveLength(3)

    const replay = snapshotFetcher(dir)
    for (const [url, res] of Object.entries(responses)) {
      expect(await replay(url, 'page', limits)).toEqual({ ...res, body: new Uint8Array(res.body) })
    }
    expect(await replay('https://acme.test/missing.png', 'image', limits)).toBeNull()
    expect(await replay('https://acme.test/never-seen', 'image', limits)).toBeNull()
  })

  it('cuts a replayed body at maxBytes', async () => {
    await recordingFetcher(live, dir)('https://acme.test/', 'page', limits)
    const res = await snapshotFetcher(dir)('https://acme.test/', 'page', {
      maxBytes: 6,
      timeoutMs: 1,
    })
    expect(new TextDecoder().decode(res!.body)).toBe('<html>')
  })

  it('throws for a URL it has no record of when strict', async () => {
    await recordingFetcher(live, dir)('https://acme.test/', 'page', limits)
    const strict = snapshotFetcher(dir, { strict: true })
    await expect(strict('https://acme.test/other.css', 'css', limits)).rejects.toThrow(
      'https://acme.test/other.css'
    )
    expect(await strict('https://acme.test/', 'page', limits)).not.toBeNull()
  })

  it('adds to an existing record without overwriting its files', async () => {
    await recordingFetcher(live, dir)('https://acme.test/', 'page', limits)
    await recordingFetcher(live, dir)('https://acme.test/main.css', 'css', limits)
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest)).toHaveLength(2)
    expect(manifest['https://acme.test/'].file).not.toBe(
      manifest['https://acme.test/main.css'].file
    )
    expect(await snapshotFetcher(dir)('https://acme.test/', 'page', limits)).not.toBeNull()
  })

  it('replays with an empty directory as all misses', async () => {
    expect(
      await snapshotFetcher(join(dir, 'nothing'))('https://acme.test/', 'page', limits)
    ).toBeNull()
  })
})
