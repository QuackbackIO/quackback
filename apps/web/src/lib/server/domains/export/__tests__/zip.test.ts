/**
 * ZipBuilder: the streaming archive writer behind the workspace export.
 * Round-trips through fflate's unzipSync to prove the bytes are a valid zip.
 */
import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { ZipBuilder } from '../zip'

describe('ZipBuilder', () => {
  it('builds a valid zip with multiple text files', () => {
    const zip = new ZipBuilder()

    const posts = zip.file('posts.csv')
    posts.write('id,title\n')
    posts.write('post_1,Hello\n')
    posts.write('post_2,"World, again"\n')
    posts.close()

    const manifest = zip.file('manifest.json')
    manifest.write(JSON.stringify({ format_version: 1 }))
    manifest.close()

    const buffer = zip.finish()
    expect(buffer.length).toBeGreaterThan(0)

    const files = unzipSync(new Uint8Array(buffer))
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'posts.csv'])
    expect(strFromU8(files['posts.csv'])).toBe('id,title\npost_1,Hello\npost_2,"World, again"\n')
    expect(strFromU8(files['manifest.json'])).toBe('{"format_version":1}')
  })

  it('supports headers-only files (empty entities)', () => {
    const zip = new ZipBuilder()
    const tags = zip.file('tags.csv')
    tags.write('id,name,color,description\n')
    tags.close()
    const files = unzipSync(new Uint8Array(zip.finish()))
    expect(strFromU8(files['tags.csv'])).toBe('id,name,color,description\n')
  })

  it('refuses a second open file and writes after close', () => {
    const zip = new ZipBuilder()
    const a = zip.file('a.csv')
    expect(() => zip.file('b.csv')).toThrow(/still open/)
    a.close()
    expect(() => a.write('nope')).toThrow(/after close/)
  })
})
