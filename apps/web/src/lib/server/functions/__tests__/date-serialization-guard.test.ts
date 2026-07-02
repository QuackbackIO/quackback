import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = [functionsDir, join(functionsDir, '..', 'integrations')]

function listServerFunctionFiles(dir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue

    const path = join(dir, entry)
    const stats = statSync(path)

    if (stats.isDirectory()) {
      files.push(...listServerFunctionFiles(path))
      continue
    }

    if (entry.endsWith('.ts')) {
      const source = readFileSync(path, 'utf8')
      if (source.includes('createServerFn')) {
        files.push(path)
      }
    }
  }

  return files
}

describe('server function date serialization', () => {
  it('uses shared Date|string serializers at server-function boundaries', () => {
    const offenders: string[] = []

    for (const file of sourceRoots.flatMap(listServerFunctionFiles)) {
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, index) => {
        if (line.includes('.toISOString()')) {
          offenders.push(`${relative(functionsDir, file)}:${index + 1}: ${line.trim()}`)
        }
      })
    }

    expect(
      offenders,
      [
        'Use toIsoString/toIsoStringOrNull in server functions.',
        'Database drivers and aggregate queries can return dates as ISO strings.',
        ...offenders,
      ].join('\n')
    ).toEqual([])
  })
})
