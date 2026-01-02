#!/usr/bin/env bun
/**
 * Prepare Edition Script
 *
 * This script prepares the codebase for building a specific edition by:
 * 1. Reading the edition configuration
 * 2. Renaming excluded routes with '-' prefix (TanStack Router ignores these)
 *
 * Environment variables:
 *   EDITION: 'self-hosted' (default) | 'cloud'
 *   INCLUDE_EE: 'true' | 'false' (default)
 *
 * Usage:
 *   bun scripts/prepare-edition.ts
 *   EDITION=cloud bun scripts/prepare-edition.ts
 */

import { readFileSync, renameSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ROUTES_DIR = join(ROOT, 'apps/web/src/routes')
const CONFIG_PATH = join(ROUTES_DIR, '.edition-config.json')

type Edition = 'self-hosted' | 'cloud'

interface RouteConfig {
  editions: Edition[]
  description?: string
}

interface EditionConfig {
  routes: Record<string, RouteConfig>
}

function main() {
  const edition = (process.env.EDITION || 'self-hosted') as Edition
  const includeEE = process.env.INCLUDE_EE === 'true'

  console.log(`\n=== Prepare Edition ===`)
  console.log(`Edition: ${edition}`)
  console.log(`Include EE: ${includeEE}`)
  console.log('')

  // Read config
  if (!existsSync(CONFIG_PATH)) {
    console.log('No .edition-config.json found, skipping route exclusion')
    return
  }

  const config: EditionConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  let excludedCount = 0
  let restoredCount = 0

  // Process each route in config
  for (const [routePath, routeConfig] of Object.entries(config.routes)) {
    const fullPath = join(ROUTES_DIR, routePath)
    const dir = dirname(fullPath)
    const file = basename(fullPath)
    const excludedPath = join(dir, `-${file}`)

    const shouldInclude = routeConfig.editions.includes(edition)
    const normalExists = existsSync(fullPath)
    const excludedExists = existsSync(excludedPath)

    if (shouldInclude) {
      // Route should be included
      if (excludedExists && !normalExists) {
        // Restore from excluded state
        renameSync(excludedPath, fullPath)
        console.log(`  Restored: ${routePath}`)
        restoredCount++
      } else if (normalExists) {
        console.log(`  Included: ${routePath}`)
      }
    } else {
      // Route should be excluded
      if (normalExists && !excludedExists) {
        // Exclude by renaming with '-' prefix
        renameSync(fullPath, excludedPath)
        console.log(`  Excluded: ${routePath}`)
        excludedCount++
      } else if (excludedExists) {
        console.log(`  Already excluded: ${routePath}`)
      }
    }
  }

  console.log('')
  console.log(`Excluded: ${excludedCount} route(s)`)
  console.log(`Restored: ${restoredCount} route(s)`)
  console.log('')
}

main()
