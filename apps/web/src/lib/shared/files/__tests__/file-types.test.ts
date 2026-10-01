import { describe, it, expect } from 'vitest'
import {
  badgeLabel,
  familyFor,
  fileExtension,
  formatBytes,
  isBlockedExtension,
  isPreviewable,
  maxBytesForFamily,
  MAX_ATTACHMENT_BYTES,
  MAX_VIDEO_ATTACHMENT_BYTES,
} from '../file-types'

describe('fileExtension', () => {
  it('reads the last extension, lower-cased', () => {
    expect(fileExtension('Report.Final.PDF')).toBe('pdf')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
  })
  it('treats a leading dot as a name, not an extension', () => {
    expect(fileExtension('.env')).toBe('')
    expect(fileExtension('noext')).toBe('')
  })
  it('ignores directory segments', () => {
    expect(fileExtension('dir.v2/readme')).toBe('')
  })
})

describe('familyFor', () => {
  it('trusts a specific stored type over the name', () => {
    expect(familyFor('photo.txt', 'image/png')).toBe('image')
    expect(familyFor('x.bin', 'application/pdf')).toBe('pdf')
  })
  it('falls back to the extension for octet-stream and missing types', () => {
    expect(familyFor('plan.docx', 'application/octet-stream')).toBe('document')
    expect(familyFor('data.xlsx', '')).toBe('spreadsheet')
    expect(familyFor('mystery', 'application/octet-stream')).toBe('other')
  })
  it('lets a csv or code extension refine a generic text type', () => {
    expect(familyFor('rows.csv', 'text/plain')).toBe('csv')
    expect(familyFor('config.yaml', 'text/plain')).toBe('code')
    expect(familyFor('notes.txt', 'text/plain')).toBe('text')
  })
  it('maps office MIME types without an extension', () => {
    expect(
      familyFor('upload', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    ).toBe('spreadsheet')
  })
})

describe('isBlockedExtension', () => {
  it('blocks executables and scripts whatever the case', () => {
    for (const name of ['setup.EXE', 'run.sh', 'a.ps1', 'app.js', 'tool.jar', 'x.msi', 'y.bat']) {
      expect(isBlockedExtension(name)).toBe(true)
    }
  })
  it('allows documents, data and media', () => {
    for (const name of ['a.pdf', 'b.docx', 'c.json', 'd.py', 'e.zip', 'f.png', 'README']) {
      expect(isBlockedExtension(name)).toBe(false)
    }
  })
})

describe('isPreviewable', () => {
  it('previews what the browser engines can read', () => {
    expect(isPreviewable('a.pdf', 'pdf')).toBe(true)
    expect(isPreviewable('a.docx', 'document')).toBe(true)
    expect(isPreviewable('a.xls', 'spreadsheet')).toBe(true)
    expect(isPreviewable('a.zip', 'archive')).toBe(true)
    expect(isPreviewable('a.log', 'text')).toBe(true)
  })
  it('falls back to download for formats that need a converter', () => {
    expect(isPreviewable('a.doc', 'document')).toBe(false)
    expect(isPreviewable('a.pptx', 'presentation')).toBe(false)
    expect(isPreviewable('a.7z', 'archive')).toBe(false)
    expect(isPreviewable('a.numbers', 'spreadsheet')).toBe(false)
    expect(isPreviewable('a.bin', 'other')).toBe(false)
  })
})

describe('badgeLabel', () => {
  it('uses a short known extension', () => {
    expect(badgeLabel('a.pdf', 'pdf')).toBe('PDF')
    expect(badgeLabel('a.xlsx', 'spreadsheet')).toBe('XLSX')
    expect(badgeLabel('setup.exe', 'other')).toBe('EXE')
  })
  it('uses the family for long or unknown extensions', () => {
    expect(badgeLabel('notes.markdown', 'text')).toBe('TXT')
    expect(badgeLabel('thing.weird', 'other')).toBe('FILE')
  })
})

describe('size caps', () => {
  it('caps video at 100 MB and everything else at 25 MB', () => {
    expect(maxBytesForFamily('video')).toBe(MAX_VIDEO_ATTACHMENT_BYTES)
    expect(MAX_VIDEO_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024)
    expect(maxBytesForFamily('pdf')).toBe(MAX_ATTACHMENT_BYTES)
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024)
  })
})

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(184 * 1024)).toBe('184 KB')
    expect(formatBytes(18.4 * 1024 * 1024)).toBe('18.4 MB')
  })
  it('returns empty for nonsense', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})
