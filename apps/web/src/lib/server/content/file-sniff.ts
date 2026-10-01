/**
 * Decide what a file is from its bytes.
 *
 * Everything that stores a file runs it through here first, and the result
 * is the type the file is stored and served as. The sender's declared type and
 * the file's name are never trusted for that: the name only picks between
 * formats whose bytes look alike (a legacy OLE2 .doc and .xls, or a text file
 * that might be CSV, JSON or a log), and only within the family the bytes
 * already established.
 *
 * Office formats are zip packages, so the sniffer reads the zip's index (the
 * names of its entries) without inflating anything: a zip bomb costs nothing
 * here.
 */
import { unzipSync } from 'fflate'
import {
  fileExtension,
  isBlockedExtension,
  typeForExtension,
  type FileFamily,
} from '@/lib/shared/files/file-types'
import { sniffImageMime } from './magic-bytes'

export interface SniffedFile {
  /** Canonical MIME type to store and serve the file as. */
  contentType: string
  family: FileFamily
  /** Native executable or script, refused from unverified senders whatever its name. */
  executable: boolean
  /** An Office file that carries a VBA project. */
  macro: boolean
}

const TEXT_WINDOW = 8192

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
])
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B '])

const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
} as const

const OPEN_DOCUMENT: Record<string, FileFamily> = {
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < Math.min(end, buf.length); i++) s += String.fromCharCode(buf[i]!)
  return s
}

function startsWith(buf: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (buf.length < offset + pattern.length) return false
  for (let i = 0; i < pattern.length; i++) if (buf[offset + i] !== pattern[i]) return false
  return true
}

function result(
  contentType: string,
  family: FileFamily,
  extra: Partial<Pick<SniffedFile, 'executable' | 'macro'>> = {}
): SniffedFile {
  return { contentType, family, executable: false, macro: false, ...extra }
}

/**
 * Entry names from a zip's central directory, without inflating any entry.
 * Null when the bytes are not a readable zip.
 */
function zipEntryNames(buf: Uint8Array): string[] | null {
  const names: string[] = []
  try {
    unzipSync(buf, {
      filter(file) {
        if (names.length < 10_000) names.push(file.name)
        return false
      },
    })
  } catch {
    return null
  }
  return names
}

/**
 * The OpenDocument `mimetype` entry: by the spec the first entry, stored
 * uncompressed, so its text sits right after the first local file header.
 */
function openDocumentMimetype(buf: Uint8Array): string | null {
  if (ascii(buf, 30, 38) !== 'mimetype') return null
  const nameLen = buf[26]! | (buf[27]! << 8)
  const extraLen = buf[28]! | (buf[29]! << 8)
  const size = buf[18]! | (buf[19]! << 8)
  const start = 30 + nameLen + extraLen
  if (size === 0 || size > 100) return null
  return ascii(buf, start, start + size)
}

function sniffZip(buf: Uint8Array, name: string): SniffedFile {
  const odf = openDocumentMimetype(buf)
  if (odf && OPEN_DOCUMENT[odf]) return result(odf, OPEN_DOCUMENT[odf]!)

  const names = zipEntryNames(buf)
  if (!names) return result('application/zip', 'archive')
  const has = (n: string) => names.includes(n)
  const macro = names.some((n) => /^(word|xl|ppt)\/vbaProject\.bin$/.test(n))

  if (has('word/document.xml')) {
    return result(macro ? OOXML.docm : OOXML.docx, 'document', { macro })
  }
  if (has('xl/workbook.bin')) return result(OOXML.xlsb, 'spreadsheet', { macro })
  if (has('xl/workbook.xml')) {
    return result(macro ? OOXML.xlsm : OOXML.xlsx, 'spreadsheet', { macro })
  }
  if (has('ppt/presentation.xml')) {
    return result(macro ? OOXML.pptm : OOXML.pptx, 'presentation', { macro })
  }
  if (has('META-INF/MANIFEST.MF') && names.some((n) => n.endsWith('.class'))) {
    return result('application/java-archive', 'other', { executable: true })
  }
  if (has('AndroidManifest.xml') && names.some((n) => n.endsWith('.dex'))) {
    return result('application/vnd.android.package-archive', 'other', { executable: true })
  }
  // iWork packages: the extension names which app made it.
  if (names.some((n) => n.startsWith('Index/') && n.endsWith('.iwa'))) {
    const entry = typeForExtension(name)
    if (entry && ['document', 'spreadsheet', 'presentation'].includes(entry.family)) {
      return result(entry.mime, entry.family)
    }
  }
  return result('application/zip', 'archive')
}

/** Legacy binary Office (and MSI, Outlook .msg) share the OLE2 container. */
function sniffOle2(name: string): SniffedFile {
  const ext = fileExtension(name)
  if (ext === 'msi' || ext === 'msp') {
    return result('application/x-msi', 'other', { executable: true })
  }
  if (ext === 'doc') return result('application/msword', 'document')
  if (ext === 'xls') return result('application/vnd.ms-excel', 'spreadsheet')
  if (ext === 'ppt') return result('application/vnd.ms-powerpoint', 'presentation')
  if (ext === 'msg') return result('application/vnd.ms-outlook', 'other')
  return result('application/x-ole-storage', 'other')
}

/** Valid UTF-8 with no NUL in the first 8 KB, or null when the bytes are binary. */
function decodeTextWindow(buf: Uint8Array): string | null {
  const window = buf.subarray(0, TEXT_WINDOW)
  if (window.includes(0)) return null
  // A window that ends inside a multi-byte character is still text: retry
  // with the trailing partial sequence (at most 3 bytes) dropped.
  const trims = window.length === TEXT_WINDOW && buf.length > TEXT_WINDOW ? 4 : 1
  for (let trim = 0; trim < trims; trim++) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        window.subarray(0, window.length - trim)
      )
    } catch {
      // try a shorter window
    }
  }
  return null
}

function sniffText(text: string, name: string): SniffedFile {
  const executable = text.startsWith('#!')
  const trimmed = text.trimStart()
  const entry = typeForExtension(name)

  if (entry?.mime === 'image/svg+xml') {
    return /<svg[\s>]/i.test(text)
      ? result('image/svg+xml', 'image', { executable })
      : result('text/plain', 'text', { executable })
  }
  if (entry && (entry.family === 'csv' || entry.family === 'text' || entry.family === 'code')) {
    return result(entry.mime, entry.family, { executable })
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return result('application/json', 'code', { executable })
  }
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    if (/<svg[\s>]/i.test(trimmed.slice(0, 2048)) && !/<html[\s>]/i.test(trimmed.slice(0, 2048))) {
      return result('image/svg+xml', 'image', { executable })
    }
    if (/^<(!doctype html|html)[\s>]/i.test(trimmed)) {
      return result('text/html', 'code', { executable })
    }
    if (trimmed.startsWith('<?xml')) return result('application/xml', 'code', { executable })
  }
  return result('text/plain', executable ? 'code' : 'text', { executable })
}

export function sniffFile(input: Uint8Array, name: string): SniffedFile {
  const buf = input
  const nodeBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)

  // Executables first: a signature here outranks any other reading.
  if (startsWith(buf, 0, [0x4d, 0x5a])) {
    return result('application/x-msdownload', 'other', { executable: true })
  }
  if (startsWith(buf, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    return result('application/x-executable', 'other', { executable: true })
  }
  for (const magic of [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
    // Java class files and universal Mach-O binaries share this one.
    [0xca, 0xfe, 0xba, 0xbe],
  ]) {
    if (startsWith(buf, 0, magic)) {
      return result('application/x-mach-binary', 'other', { executable: true })
    }
  }

  const image = sniffImageMime(nodeBuf)
  if (image) return result(image, 'image')

  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12)
    if (HEIC_BRANDS.has(brand)) return result('image/heic', 'image')
    if (AUDIO_BRANDS.has(brand)) return result('audio/mp4', 'audio')
    if (brand === 'qt  ') return result('video/quicktime', 'video')
    return result('video/mp4', 'video')
  }
  if (startsWith(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return result('video/webm', 'video')

  if (ascii(buf, 0, 3) === 'ID3') return result('audio/mpeg', 'audio')
  if (buf[0] === 0xff && buf.length > 1 && (buf[1]! & 0xe0) === 0xe0) {
    // MPEG audio frame sync; ADTS AAC is the 0xFFF0 sub-pattern.
    return (buf[1]! & 0xf6) === 0xf0 ? result('audio/aac', 'audio') : result('audio/mpeg', 'audio')
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE')
    return result('audio/wav', 'audio')
  if (ascii(buf, 0, 4) === 'OggS') return result('audio/ogg', 'audio')
  if (ascii(buf, 0, 4) === 'fLaC') return result('audio/flac', 'audio')
  if (ascii(buf, 0, 2) === 'BM' && buf.length >= 26) return result('image/bmp', 'image')
  if (ascii(buf, 0, 4) === 'II*\0' || ascii(buf, 0, 4) === 'MM\0*') {
    return result('image/tiff', 'image')
  }

  // PDF allows bytes before the header; readers look in the first kilobyte.
  if (ascii(buf, 0, 1024).includes('%PDF-')) return result('application/pdf', 'pdf')
  if (ascii(buf, 0, 5) === '{\\rtf') return result('application/rtf', 'document')

  if (
    startsWith(buf, 0, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, 0, [0x50, 0x4b, 0x05, 0x06])
  ) {
    return sniffZip(buf, name)
  }
  if (startsWith(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return sniffOle2(name)
  if (startsWith(buf, 0, [0x1f, 0x8b])) return result('application/gzip', 'archive')
  if (startsWith(buf, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return result('application/x-7z-compressed', 'archive')
  }
  if (ascii(buf, 0, 6) === 'Rar!\x1a\x07') return result('application/vnd.rar', 'archive')
  if (ascii(buf, 257, 262) === 'ustar') return result('application/x-tar', 'archive')

  const text = decodeTextWindow(buf)
  if (text !== null) return sniffText(text, name)

  return result('application/octet-stream', 'other')
}

/**
 * Whether an unverified sender (an anonymous widget visitor, an inbound email)
 * may send this file. Executables and scripts are refused on their bytes and
 * on their name, so a renamed executable is refused and so is a script that
 * is only text.
 */
export function isRefusedFromUnverifiedSender(sniffed: SniffedFile, name: string): boolean {
  return sniffed.executable || isBlockedExtension(name)
}
