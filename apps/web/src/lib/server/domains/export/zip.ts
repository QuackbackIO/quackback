/**
 * Thin streaming ZIP writer over fflate (workspace data export).
 *
 * Entities are serialized page by page, so the archive is built without
 * holding every row in memory: each file is a ZipDeflate entry fed string
 * chunks, and the archive bytes accumulate as compressed output only.
 * fflate runs synchronously in-process (no workers), so `finish()` right
 * after `zip.end()` returns the complete archive.
 */
import { Zip, ZipDeflate, strToU8 } from 'fflate'

export interface ZipFileWriter {
  /** Append text to the open file. */
  write(text: string): void
  /** Close the file. Exactly one file may be open at a time. */
  close(): void
}

export class ZipBuilder {
  private zip: Zip
  private chunks: Uint8Array[] = []
  private error: Error | null = null
  private openFile: string | null = null

  constructor() {
    this.zip = new Zip((err, chunk) => {
      if (err) this.error = err
      else this.chunks.push(chunk)
    })
  }

  /** Start a new file in the archive. Previous file must be closed first. */
  file(name: string): ZipFileWriter {
    if (this.error) throw this.error
    if (this.openFile) throw new Error(`zip file still open: ${this.openFile}`)
    this.openFile = name
    const entry = new ZipDeflate(name, { level: 6 })
    this.zip.add(entry)
    let ended = false
    return {
      write: (text: string) => {
        if (ended) throw new Error(`write after close: ${name}`)
        entry.push(strToU8(text))
      },
      close: () => {
        if (ended) return
        ended = true
        entry.push(new Uint8Array(0), true)
        this.openFile = null
      },
    }
  }

  /** Finish the archive and return the compressed bytes. */
  finish(): Buffer {
    this.zip.end()
    if (this.error) throw this.error
    return Buffer.concat(this.chunks.map((c) => Buffer.from(c)))
  }
}
