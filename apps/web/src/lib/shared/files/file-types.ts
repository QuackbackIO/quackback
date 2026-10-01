/**
 * The one registry of file types that conversations accept, preview and serve.
 *
 * Client and server both read it: the client to pick a badge, a card and a
 * viewer from a file's name and declared type, the server to name the type it
 * sniffed from the bytes (`lib/server/content/file-sniff.ts`). The extension is
 * a display hint only on the client; the server never trusts it for anything
 * but the blocked-type list, which refuses on the name as well as the bytes so
 * a renamed executable is still refused.
 */

export type FileFamily =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'csv'
  | 'text'
  | 'code'
  | 'archive'
  | 'other'

export const FILE_FAMILIES: readonly FileFamily[] = [
  'image',
  'video',
  'audio',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'csv',
  'text',
  'code',
  'archive',
  'other',
]

/** Per-file cap for every attachment except video. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
/** Video keeps the cap feedback recordings already use. */
export const MAX_VIDEO_ATTACHMENT_BYTES = 100 * 1024 * 1024

export function maxBytesForFamily(family: FileFamily): number {
  return family === 'video' ? MAX_VIDEO_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES
}

interface TypeEntry {
  family: FileFamily
  /** Canonical MIME type stored and served for this extension. */
  mime: string
}

/**
 * Extension -> family and canonical type. Lower-case, no dot. A type the
 * server sniffs from the bytes always wins over this table.
 */
const BY_EXTENSION: Record<string, TypeEntry> = {
  // images
  png: { family: 'image', mime: 'image/png' },
  jpg: { family: 'image', mime: 'image/jpeg' },
  jpeg: { family: 'image', mime: 'image/jpeg' },
  gif: { family: 'image', mime: 'image/gif' },
  webp: { family: 'image', mime: 'image/webp' },
  avif: { family: 'image', mime: 'image/avif' },
  heic: { family: 'image', mime: 'image/heic' },
  heif: { family: 'image', mime: 'image/heif' },
  svg: { family: 'image', mime: 'image/svg+xml' },
  ico: { family: 'image', mime: 'image/x-icon' },
  bmp: { family: 'image', mime: 'image/bmp' },
  // video
  mp4: { family: 'video', mime: 'video/mp4' },
  m4v: { family: 'video', mime: 'video/x-m4v' },
  mov: { family: 'video', mime: 'video/quicktime' },
  webm: { family: 'video', mime: 'video/webm' },
  // audio
  mp3: { family: 'audio', mime: 'audio/mpeg' },
  m4a: { family: 'audio', mime: 'audio/mp4' },
  wav: { family: 'audio', mime: 'audio/wav' },
  ogg: { family: 'audio', mime: 'audio/ogg' },
  oga: { family: 'audio', mime: 'audio/ogg' },
  opus: { family: 'audio', mime: 'audio/ogg' },
  flac: { family: 'audio', mime: 'audio/flac' },
  // paged documents
  pdf: { family: 'pdf', mime: 'application/pdf' },
  docx: {
    family: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  docm: { family: 'document', mime: 'application/vnd.ms-word.document.macroEnabled.12' },
  doc: { family: 'document', mime: 'application/msword' },
  rtf: { family: 'document', mime: 'application/rtf' },
  odt: { family: 'document', mime: 'application/vnd.oasis.opendocument.text' },
  pages: { family: 'document', mime: 'application/vnd.apple.pages' },
  // spreadsheets
  xlsx: {
    family: 'spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  xlsm: { family: 'spreadsheet', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
  xlsb: { family: 'spreadsheet', mime: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12' },
  xls: { family: 'spreadsheet', mime: 'application/vnd.ms-excel' },
  ods: { family: 'spreadsheet', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  numbers: { family: 'spreadsheet', mime: 'application/vnd.apple.numbers' },
  // presentations
  pptx: {
    family: 'presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  pptm: {
    family: 'presentation',
    mime: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  },
  ppt: { family: 'presentation', mime: 'application/vnd.ms-powerpoint' },
  odp: { family: 'presentation', mime: 'application/vnd.oasis.opendocument.presentation' },
  key: { family: 'presentation', mime: 'application/vnd.apple.keynote' },
  // delimited
  csv: { family: 'csv', mime: 'text/csv' },
  tsv: { family: 'csv', mime: 'text/tab-separated-values' },
  // plain text
  txt: { family: 'text', mime: 'text/plain' },
  log: { family: 'text', mime: 'text/plain' },
  md: { family: 'text', mime: 'text/markdown' },
  markdown: { family: 'text', mime: 'text/markdown' },
  // code and structured data
  json: { family: 'code', mime: 'application/json' },
  ndjson: { family: 'code', mime: 'application/x-ndjson' },
  har: { family: 'code', mime: 'application/json' },
  xml: { family: 'code', mime: 'application/xml' },
  yaml: { family: 'code', mime: 'application/yaml' },
  yml: { family: 'code', mime: 'application/yaml' },
  toml: { family: 'code', mime: 'application/toml' },
  ini: { family: 'code', mime: 'text/plain' },
  env: { family: 'code', mime: 'text/plain' },
  conf: { family: 'code', mime: 'text/plain' },
  html: { family: 'code', mime: 'text/html' },
  htm: { family: 'code', mime: 'text/html' },
  css: { family: 'code', mime: 'text/css' },
  js: { family: 'code', mime: 'text/javascript' },
  mjs: { family: 'code', mime: 'text/javascript' },
  cjs: { family: 'code', mime: 'text/javascript' },
  ts: { family: 'code', mime: 'text/plain' },
  tsx: { family: 'code', mime: 'text/plain' },
  jsx: { family: 'code', mime: 'text/plain' },
  py: { family: 'code', mime: 'text/x-python' },
  rb: { family: 'code', mime: 'text/plain' },
  go: { family: 'code', mime: 'text/plain' },
  rs: { family: 'code', mime: 'text/plain' },
  java: { family: 'code', mime: 'text/plain' },
  kt: { family: 'code', mime: 'text/plain' },
  swift: { family: 'code', mime: 'text/plain' },
  c: { family: 'code', mime: 'text/plain' },
  h: { family: 'code', mime: 'text/plain' },
  cpp: { family: 'code', mime: 'text/plain' },
  cs: { family: 'code', mime: 'text/plain' },
  php: { family: 'code', mime: 'text/plain' },
  sql: { family: 'code', mime: 'application/sql' },
  sh: { family: 'code', mime: 'text/plain' },
  bash: { family: 'code', mime: 'text/plain' },
  ps1: { family: 'code', mime: 'text/plain' },
  bat: { family: 'code', mime: 'text/plain' },
  cmd: { family: 'code', mime: 'text/plain' },
  vbs: { family: 'code', mime: 'text/plain' },
  // archives
  zip: { family: 'archive', mime: 'application/zip' },
  gz: { family: 'archive', mime: 'application/gzip' },
  tgz: { family: 'archive', mime: 'application/gzip' },
  tar: { family: 'archive', mime: 'application/x-tar' },
  '7z': { family: 'archive', mime: 'application/x-7z-compressed' },
  rar: { family: 'archive', mime: 'application/vnd.rar' },
}

/**
 * Executables and scripts. Unverified senders (anonymous widget visitors and
 * inbound email) cannot send these; the server refuses on this list and on
 * the executable signatures it sniffs, so renaming a file does not help.
 */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'msi',
  'msp',
  'com',
  'scr',
  'pif',
  'cpl',
  'dll',
  'sys',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'mjs',
  'cjs',
  'wsf',
  'wsh',
  'hta',
  'lnk',
  'reg',
  'jar',
  'apk',
  'app',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'sh',
  'bash',
  'command',
  'run',
  'bin',
  'elf',
  'appimage',
  'iso',
])

export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isBlockedExtension(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(fileExtension(name))
}

/** The registry's entry for a name's extension, if it has one. */
export function typeForExtension(name: string): TypeEntry | null {
  return BY_EXTENSION[fileExtension(name)] ?? null
}

/** Family from a MIME type alone, for types that say enough on their own. */
function familyForMime(contentType: string): FileFamily | null {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (!type) return null
  if (type === 'application/pdf') return 'pdf'
  if (type === 'text/csv' || type === 'text/tab-separated-values') return 'csv'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  for (const entry of Object.values(BY_EXTENSION)) {
    if (entry.mime === type) return entry.family
  }
  if (type.startsWith('text/')) return 'text'
  return null
}

/**
 * Best family for display. The stored type was sniffed for files that went
 * through the pipeline, so it wins; the extension covers legacy rows whose
 * type was declared by a sender, and `application/octet-stream`.
 */
export function familyFor(name: string, contentType: string): FileFamily {
  const fromMime = familyForMime(contentType)
  if (fromMime && contentType !== 'application/octet-stream') {
    // A generic text type says little; a specific extension says more.
    if (fromMime === 'text') {
      const fromExt = typeForExtension(name)?.family
      if (fromExt === 'csv' || fromExt === 'code') return fromExt
    }
    return fromMime
  }
  return typeForExtension(name)?.family ?? 'other'
}

/** Short badge text: the extension when it is short and known, else the family. */
export function badgeLabel(name: string, family: FileFamily): string {
  const ext = fileExtension(name)
  if (ext && ext.length <= 4 && (BY_EXTENSION[ext] || BLOCKED_EXTENSIONS.has(ext))) {
    return ext.toUpperCase()
  }
  return FAMILY_BADGE[family]
}

const FAMILY_BADGE: Record<FileFamily, string> = {
  image: 'IMG',
  video: 'VID',
  audio: 'AUD',
  pdf: 'PDF',
  document: 'DOC',
  spreadsheet: 'XLS',
  presentation: 'PPT',
  csv: 'CSV',
  text: 'TXT',
  code: '{ }',
  archive: 'ZIP',
  other: 'FILE',
}

/** What a person calls the type, for a card's meta line. */
export const FAMILY_NAME: Record<FileFamily, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  csv: 'Spreadsheet',
  text: 'Text',
  code: 'Code',
  archive: 'Archive',
  other: 'File',
}

/**
 * Families the viewer can render in the browser. Presentations and legacy
 * binary office formats (.doc, .ppt) need a server-side converter and fall
 * back to the download card; `.xls` and `.ods` are readable by the sheet
 * engine, so spreadsheets are previewable whatever their container.
 */
export function isPreviewable(name: string, family: FileFamily): boolean {
  switch (family) {
    case 'image':
    case 'video':
    case 'audio':
    case 'pdf':
    case 'spreadsheet':
    case 'csv':
    case 'text':
    case 'code':
      return !NOT_PREVIEWABLE_EXTENSIONS.has(fileExtension(name))
    case 'document':
      return fileExtension(name) === 'docx' || fileExtension(name) === 'docm'
    case 'archive':
      return fileExtension(name) === 'zip'
    default:
      return false
  }
}

/** Members of previewable families that the browser engines cannot read. */
const NOT_PREVIEWABLE_EXTENSIONS = new Set(['numbers', 'xlsb'])

/** Human file size: "184 KB", "18.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
