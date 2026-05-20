import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfigFile } from '../loader'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'config-file-'))
  path = join(dir, 'config.yaml')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadConfigFile', () => {
  it('returns null when the file does not exist', async () => {
    const result = await loadConfigFile(path)
    expect(result.kind).toBe('absent')
  })

  it('parses a valid YAML config', async () => {
    writeFileSync(
      path,
      `apiVersion: quackback.io/v1
kind: QuackbackConfig
spec:
  workspace:
    name: Acme
    slug: acme
  tierLimits:
    maxBoards: 5
`
    )
    const result = await loadConfigFile(path)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.config.spec.workspace?.name).toBe('Acme')
      expect(result.config.spec.tierLimits?.maxBoards).toBe(5)
    }
  })

  it('returns a parse error for invalid YAML', async () => {
    writeFileSync(path, 'not: : valid: yaml: ::')
    const result = await loadConfigFile(path)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.error).toMatch(/yaml/i)
  })

  it('returns a schema error for valid YAML that fails validation', async () => {
    writeFileSync(
      path,
      `apiVersion: quackback.io/v1
kind: QuackbackConfig
spec:
  workspace:
    useCase: bogus
`
    )
    const result = await loadConfigFile(path)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.error).toMatch(/useCase/)
  })

  it('returns ok for an empty spec', async () => {
    writeFileSync(path, `apiVersion: quackback.io/v1\nkind: QuackbackConfig\nspec: {}\n`)
    const result = await loadConfigFile(path)
    expect(result.kind).toBe('ok')
  })
})
