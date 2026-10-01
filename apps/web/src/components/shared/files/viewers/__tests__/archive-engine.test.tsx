// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import ArchiveEngine from '../archive-engine'
import type { EngineToolbar, ViewerFile } from '../../types'

function renderZip(entries: Zippable | Uint8Array) {
  const bytes = entries instanceof Uint8Array ? entries : zipSync(entries, { level: 6 })
  const file: ViewerFile = {
    key: 'config.zip',
    url: '/api/storage/files/config.zip',
    name: 'config.zip',
    contentType: 'application/zip',
    size: bytes.byteLength,
    family: 'archive',
  }
  const toolbars: EngineToolbar[] = []
  const onToolbar = vi.fn((t: EngineToolbar) => {
    toolbars.push(t)
  })
  const onError = vi.fn()
  const result = render(
    <ArchiveEngine
      file={file}
      data={
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      }
      truncated={false}
      src="/api/storage/files/config.zip?proxy=1"
      onToolbar={onToolbar}
      onError={onError}
      compact={false}
    />
  )
  return { ...result, note: () => toolbars.at(-1)?.note, onError }
}

/** Each listed row as "depth:name:size". */
function rows() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => {
      const name = row.querySelector('[data-entry-name]')
      const depth = name?.getAttribute('data-depth') ?? ''
      const cells = within(row).getAllByRole('cell')
      return `${depth}:${name?.textContent ?? cells[0]!.textContent}:${cells[1]?.textContent ?? ''}`
    })
}

describe('ArchiveEngine', () => {
  it('lists the entries as a tree, folders first, with sizes', () => {
    const { note } = renderZip({
      'README.md': strToU8('hello'),
      'help-center/redirects.csv': new Uint8Array(2048),
      'help-center/themes/dark.css': strToU8('body{}'),
      'boards/bugs.json': strToU8('{}'),
    })
    expect(rows()).toEqual([
      '0:boards:',
      '1:bugs.json:2 B',
      '0:help-center:',
      '1:themes:',
      '2:dark.css:6 B',
      '1:redirects.csv:2 KB',
      '0:README.md:5 B',
    ])
    expect(note()).toBe('4 files · 2 KB unpacked')
  })

  it('flags an archive that unpacks to far more than its size', () => {
    const { note } = renderZip({ 'zeros.bin': new Uint8Array(5 * 1024 * 1024) })
    expect(note()).toBe('1 file · 5.0 MB unpacked · Unusually large when unpacked')
  })

  it('caps the listing and says how many more there are', () => {
    const entries: Zippable = {}
    for (let i = 0; i < 5010; i++) entries[`f${String(i).padStart(5, '0')}.txt`] = new Uint8Array(0)
    const { note } = renderZip(entries)
    expect(screen.getAllByRole('row')).toHaveLength(1 + 5000 + 1)
    expect(screen.getByText('and 10 more')).toBeInTheDocument()
    expect(note()).toBe('5,010 files · 0 B unpacked')
  })

  it('reports a file that is not a zip as corrupt', () => {
    const { onError } = renderZip(strToU8('not a zip at all, just text'))
    expect(onError).toHaveBeenCalledWith('corrupt')
  })

  it('treats an empty archive as empty, not broken', () => {
    const { note, onError } = renderZip({})
    expect(onError).not.toHaveBeenCalled()
    expect(note()).toBe('0 files · 0 B unpacked')
  })
})
