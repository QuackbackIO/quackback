/**
 * Single-folder conformance gate (IF WO-11). Every provider lives in exactly
 * one folder `src/integrations/<id>/{server,ui}`; the folder name IS the id
 * (with the hyphen→underscore caveat for azure-devops, whose id is a DB value
 * and webhook-URL segment that can't change). This suite is the payoff: adding
 * a provider means creating its folder and one registry line — nothing else —
 * and a stray or unregistered folder, or a cross-provider import, is a CI
 * failure rather than latent rot.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getIntegration, listIntegrationTypes } from '../index'

const INTEGRATIONS_ROOT = path.resolve(__dirname, '../../../../integrations')

/** Folder name → integration id (only azure-devops diverges). */
function folderToId(folder: string): string {
  return folder.replace(/-/g, '_')
}

function providerFolders(): string[] {
  return fs
    .readdirSync(INTEGRATIONS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== '__tests__')
    .map((e) => e.name)
    .sort()
}

describe('single-folder conformance (WO-11)', () => {
  it('every provider folder is a registered integration', () => {
    const unregistered = providerFolders().filter((f) => !getIntegration(folderToId(f)))
    expect(unregistered).toEqual([])
  })

  it('every registered integration has a folder', () => {
    const folders = new Set(providerFolders().map(folderToId))
    const missing = listIntegrationTypes().filter((id) => !folders.has(id))
    expect(missing).toEqual([])
  })

  it('each provider folder has a server/ entry point', () => {
    for (const folder of providerFolders()) {
      const serverIndex = path.join(INTEGRATIONS_ROOT, folder, 'server', 'index.ts')
      expect(fs.existsSync(serverIndex), `${folder}/server/index.ts`).toBe(true)
    }
  })

  it('no provider imports another provider (folder purity)', () => {
    const folders = providerFolders()
    const violations: string[] = []
    for (const folder of folders) {
      const dir = path.join(INTEGRATIONS_ROOT, folder)
      for (const file of walk(dir)) {
        const content = fs.readFileSync(file, 'utf8')
        for (const other of folders) {
          if (other === folder) continue
          // A provider may not import from another provider's folder.
          if (content.includes(`@/integrations/${other}/`)) {
            violations.push(
              `${path.relative(INTEGRATIONS_ROOT, file)} imports @/integrations/${other}/`
            )
          }
        }
      }
    }
    expect(violations).toEqual([])
  })
})

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) yield full
  }
}
