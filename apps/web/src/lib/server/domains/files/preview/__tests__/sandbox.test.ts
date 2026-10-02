// @vitest-environment node
/**
 * The preview worker: the real worker script derives every kind exactly as
 * the derivers do in-process, errors cross with what the job acts on, and the
 * host ends a worker that overruns, dies or never starts. Scripts standing in
 * for a misbehaving worker are written to a temporary directory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as mupdf from 'mupdf'
import XLSX from 'xlsx'
import { zipSync, strToU8 } from 'fflate'
import { deriveInWorker, PreviewCrashError } from '../sandbox'
import { deriveFromBytes } from '../derive'
import {
  NO_DEADLINE,
  PreviewDependencyError,
  PreviewRefusedError,
  PreviewTimeoutError,
} from '../result'
import type { ByteKind } from '../kind'
import { HEIC_64x48 } from './image-fixtures'

function pdfBytes(): Uint8Array {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  const resources = doc.addObject({ Font: { F1: font } })
  doc.insertPage(
    -1,
    doc.addPage([0, 0, 612, 792], 0, resources, 'BT /F1 18 Tf 20 700 Td (Order 5531) Tj ET')
  )
  return doc.saveToBuffer('').asUint8Array().slice()
}

function xlsxBytes(): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Name'], ['Ada'], ['Grace']]),
    'People'
  )
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}

function docxBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p></w:body></w:document>'
    ),
  })
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const soon = (ms = 20_000) => Date.now() + ms

let dir: string
const script = (name: string, source: string): URL => {
  const file = join(dir, name)
  writeFileSync(file, source)
  return pathToFileURL(file)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'preview-worker-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('deriveInWorker with the preview worker', () => {
  const cases: Array<[string, ByteKind, () => Uint8Array, string]> = [
    ['a PDF (mupdf)', 'pdf', pdfBytes, 'application/pdf'],
    ['a workbook (the sheet parser)', 'spreadsheet', xlsxBytes, XLSX_TYPE],
    [
      'a HEIC photo (the HEIC decoder, then mupdf)',
      'image',
      () => HEIC_64x48.slice(),
      'image/heic',
    ],
    ['a Word document', 'document', docxBytes, DOCX_TYPE],
    ['a text file', 'text', () => strToU8('one\ntwo\n'), 'text/plain'],
  ]

  it.each(cases)('derives %s as the deriver does in-process', async (_, kind, bytes, type) => {
    const expected = await deriveFromBytes(kind, bytes(), type, NO_DEADLINE)
    const result = await deriveInWorker({
      kind,
      bytes: bytes(),
      contentType: type,
      deadlineAt: soon(),
    })
    expect(result).toEqual(expected)
  })

  it('brings derived files back whole', async () => {
    const result = await deriveInWorker({
      kind: 'pdf',
      bytes: pdfBytes(),
      contentType: 'application/pdf',
      deadlineAt: soon(),
    })
    const thumb = result.derived![0]!.bytes
    expect(thumb).toBeInstanceOf(Uint8Array)
    expect(Array.from(thumb.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('carries a refusal across with its code', async () => {
    // A file-type box and nothing else: no property says how big the photo is.
    const ftypOnly = new Uint8Array([0, 0, 0, 16, ...strToU8('ftypheic'), 0, 0, 0, 0])
    const err = await deriveInWorker({
      kind: 'image',
      bytes: ftypOnly,
      contentType: 'image/heic',
      deadlineAt: soon(),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewRefusedError)
    expect(err).toMatchObject({ reason: 'heic-size-unknown' })
  })

  it('carries a file error across by name, never its message', async () => {
    const err = await deriveInWorker({
      kind: 'document',
      bytes: strToU8('PK\u0003\u0004 secret words'),
      contentType: DOCX_TYPE,
      deadlineAt: soon(),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('ZipFormatError')
    expect((err as Error).message).not.toContain('secret')
  })
})

describe('deriveInWorker ending a worker', () => {
  it('terminates a worker still busy at the deadline', async () => {
    const workerUrl = script(
      'spin.mjs',
      `import { parentPort } from 'node:worker_threads'
       parentPort.once('message', () => { for (;;) {} })
       parentPort.postMessage({ type: 'ready' })`
    )
    const started = Date.now()
    const err = await deriveInWorker(
      {
        kind: 'text',
        bytes: strToU8('x'),
        contentType: 'text/plain',
        deadlineAt: Date.now() + 300,
      },
      { workerUrl }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewTimeoutError)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('reports a worker that dies on the file as the file failing', async () => {
    const workerUrl = script(
      'die.mjs',
      `import { parentPort } from 'node:worker_threads'
       parentPort.once('message', () => process.exit(7))
       parentPort.postMessage({ type: 'ready' })`
    )
    const err = await deriveInWorker(
      { kind: 'text', bytes: strToU8('x'), contentType: 'text/plain', deadlineAt: soon() },
      { workerUrl }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewCrashError)
  })

  it('reports a worker that cannot start as a deployment fault', async () => {
    const workerUrl = script('broken.mjs', `import 'quackback-no-such-package'`)
    const err = await deriveInWorker(
      { kind: 'text', bytes: strToU8('x'), contentType: 'text/plain', deadlineAt: soon() },
      { workerUrl }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewDependencyError)
  })
})
