import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const functionsDir = join(process.cwd(), 'apps/web/src/lib/server/functions')
const sensitiveInputNames = [
  'apiKey',
  'email',
  'invite',
  'ott',
  'password',
  'reset',
  'secret',
  'token',
]
const allowedSensitiveGetInputs = new Set<string>()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        if (entry === '__tests__') return []
        return sourceFiles(path)
      }
      return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
    })
    .sort()
}

function getServerFunctionBlocks(source: string): string[] {
  return source
    .split(/(?=export const \w+\s*=\s*createServerFn\(\{ method: 'GET' \}\))/)
    .filter((block) => /export const \w+\s*=\s*createServerFn\(\{ method: 'GET' \}\)/.test(block))
}

describe('server function transport', () => {
  it('keeps contact search on POST so private search input is not serialized into URLs', () => {
    const source = readFileSync(join(functionsDir, 'contacts.ts'), 'utf8')

    expect(source).toContain("export const searchContactsFn = createServerFn({ method: 'POST' })")
  })

  it('does not add sensitive input names to GET server functions without an explicit exception', () => {
    const violations = sourceFiles(functionsDir).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return getServerFunctionBlocks(source).flatMap((block) => {
        const functionName = block.match(/export const (\w+)\s*=/)?.[1] ?? 'unknown'
        const definition = block.split(/\.handler\s*\(/)[0] ?? block
        const found = sensitiveInputNames.filter((name) =>
          new RegExp(`\\b${name}\\s*:`).test(definition)
        )
        const key = `${relative(process.cwd(), file)}:${functionName}`
        return found
          .filter(() => !allowedSensitiveGetInputs.has(key))
          .map((name) => `${key} includes ${name}`)
      })
    })

    expect(violations).toEqual([])
  })
})
