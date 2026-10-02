/**
 * The workbook a sheet parser is handed: a new zip holding only the parts the
 * preview reads, inflated through the budgeted reader and stored uncompressed.
 *
 * The sheet parser has its own zip reader, which finds the index another way
 * and inflates entries by their local headers. Given the original archive it
 * could read entries the budget never saw. Given this one it reads exactly
 * the bytes the budget has already bounded, and nothing is left to inflate.
 *
 * An OOXML workbook keeps its workbook part, the workbook's relationships,
 * the first sheet, shared strings and styles, with a content types part
 * written here that names only those (the parser reads every part the
 * original one lists). An OpenDocument sheet keeps its manifest, styles and
 * content.
 */
import { zipSync } from 'fflate'
import { openZip, ZipFormatError, type ZipReader } from '@/lib/shared/files/zip-budget'
import { decodeXmlEntities } from '@/lib/server/content/docx-text'

const KB = 1024
const MB = 1024 * KB

/** Content types, relationships, manifests. */
const SMALL_PART_BYTES = MB
const WORKBOOK_BYTES = 16 * MB
const STYLES_BYTES = 16 * MB
/** A sheet, the shared strings, or an OpenDocument sheet's content (every sheet). */
const DATA_PART_BYTES = 64 * MB

const CONTENT_TYPES = '[Content_Types].xml'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'

const SPREADSHEETML = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
const WORKBOOK_TYPES = new Set([
  `${SPREADSHEETML}.sheet.main+xml`,
  `${SPREADSHEETML}.template.main+xml`,
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.ms-excel.template.macroEnabled.main+xml',
])
const SHARED_STRINGS_TYPE = `${SPREADSHEETML}.sharedStrings+xml`
const STYLES_TYPE = `${SPREADSHEETML}.styles+xml`
const WORKSHEET_TYPE = `${SPREADSHEETML}.worksheet+xml`

const ODS_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'

const decoder = new TextDecoder()

type Attributes = Record<string, string>

/** The attributes of each `<name …>` tag (any namespace prefix), in document order. */
function* tags(xml: string, name: string): Generator<Attributes> {
  const tag = new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])([^>]*)>`, 'g')
  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    const attributes: Attributes = {}
    const attribute = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    for (let a = attribute.exec(match[1]!); a; a = attribute.exec(match[1]!)) {
      attributes[a[1]!] = decodeXmlEntities(a[2] ?? a[3] ?? '')
    }
    yield attributes
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** An entry's bytes, refused (not cut short) past `maxBytes`: a cut part does not parse. */
function part(zip: ZipReader, name: string, maxBytes: number): Uint8Array | null {
  return zip.read(name, { maxBytes })
}

/**
 * Where the parser looks for a sheet a workbook relationship targets, in its
 * order: under `xl/`, as written, then beside the relationships part.
 */
function sheetCandidates(target: string, relsName: string): string[] {
  return [
    `xl/${target.replace(/[/]?xl\//, '')}`,
    target,
    relsName.replace(/_rels\/[\s\S]*$/, '') + target,
  ]
}

function ooxmlParts(zip: ZipReader): Record<string, Uint8Array> {
  const contentTypes = part(zip, CONTENT_TYPES, SMALL_PART_BYTES)
  if (!contentTypes) throw new ZipFormatError('Not a workbook')
  const overrides = [...tags(decoder.decode(contentTypes), 'Override')]
    .filter((o) => o.PartName && o.ContentType)
    .map((o) => ({ name: o.PartName!.replace(/^\//, ''), type: o.ContentType! }))
  const typeOf = new Map(overrides.map((o) => [o.name, o.type]))

  const listed = overrides.find((o) => WORKBOOK_TYPES.has(o.type))
  const workbookName = listed?.name ?? 'xl/workbook.xml'
  const workbook = part(zip, workbookName, WORKBOOK_BYTES)
  if (!workbook) throw new ZipFormatError('Not a workbook')
  const parts: Record<string, Uint8Array> = { [workbookName]: workbook }
  const types: Array<{ name: string; type: string }> = [
    { name: workbookName, type: listed?.type ?? `${SPREADSHEETML}.sheet.main+xml` },
  ]

  const slash = workbookName.lastIndexOf('/')
  let relsName = `${workbookName.slice(0, slash + 1)}_rels/${workbookName.slice(slash + 1)}.rels`
  if (!zip.entries.some((e) => e.name === relsName)) relsName = 'xl/_rels/workbook.xml.rels'
  const rels = part(zip, relsName, SMALL_PART_BYTES)
  if (rels) parts[relsName] = rels

  // The first sheet the workbook lists, through its relationship id.
  let sheetName: string | undefined
  const first = tags(decoder.decode(workbook), 'sheet').next().value
  const relId = first && Object.entries(first).find(([k]) => /^(?:[\w.-]+:)?id$/.test(k))?.[1]
  if (rels && relId) {
    const target = [...tags(decoder.decode(rels), 'Relationship')].find(
      (r) => r.Id === relId && r.TargetMode !== 'External'
    )?.Target
    sheetName =
      target && sheetCandidates(target, relsName).find((n) => zip.entries.some((e) => e.name === n))
  } else {
    sheetName = 'xl/worksheets/sheet1.xml'
  }
  const sheet = sheetName ? part(zip, sheetName, DATA_PART_BYTES) : null
  if (sheetName && sheet) {
    parts[sheetName] = sheet
    types.push({ name: sheetName, type: typeOf.get(sheetName) ?? WORKSHEET_TYPE })
  }

  for (const [type, maxBytes] of [
    [SHARED_STRINGS_TYPE, DATA_PART_BYTES],
    [STYLES_TYPE, STYLES_BYTES],
  ] as const) {
    const name = overrides.find((o) => o.type === type)?.name
    const bytes = name && part(zip, name, maxBytes)
    if (name && bytes) {
      parts[name] = bytes
      types.push({ name, type })
    }
  }

  const listing = types
    .map(
      (t) =>
        `<Override PartName="/${escapeAttribute(t.name)}" ContentType="${escapeAttribute(t.type)}"/>`
    )
    .join('')
  parts[CONTENT_TYPES] = new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="${CONTENT_TYPES_NS}">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `${listing}</Types>`
  )
  return parts
}

function odsParts(zip: ZipReader): Record<string, Uint8Array> {
  const content = part(zip, 'content.xml', DATA_PART_BYTES)
  if (!content) throw new ZipFormatError('Not a spreadsheet')
  const parts: Record<string, Uint8Array> = { 'content.xml': content }
  const manifest = part(zip, 'META-INF/manifest.xml', SMALL_PART_BYTES)
  if (manifest) parts['META-INF/manifest.xml'] = manifest
  const styles = part(zip, 'styles.xml', STYLES_BYTES)
  if (styles) parts['styles.xml'] = styles
  return parts
}

/** The workbook's parts the preview reads, as a new zip with nothing to inflate. */
export function rebuildWorkbookZip(bytes: Uint8Array, contentType: string): Uint8Array {
  const zip = openZip(bytes)
  const parts = contentType === ODS_TYPE ? odsParts(zip) : ooxmlParts(zip)
  return zipSync(parts, { level: 0 })
}
