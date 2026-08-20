#!/usr/bin/env bun
/**
 * Adversarial two-workspace isolation probe suite — entry point.
 *
 * Usage: bun apps/web/workspace-probe/cli.ts --alpha <url> --bravo <url> [options]
 *        (see --help, or workspace-probe/README.md)
 *
 * Output contract:
 *   stdout — the JSON report, and nothing else, unless --json-out is given
 *   stderr — the human summary and progress logging
 *   exit   — 0 all passed · 1 a probe could not execute · 2 a cross-workspace observation
 *
 * The two streams are separate so `... | jq` works without stripping anything,
 * and so a leak is still legible when the JSON is piped away.
 */

import { writeFileSync } from 'node:fs'
import { createLogger } from '@quackback/logger'
import { ConfigError, parseConfig, usage, wantsHelp } from './config'
import { renderHumanSummary } from './report'
import { exitCodeFor, runSuite } from './runner'
import { createTripwire } from './tripwire'
import { createWorkspaceHttp } from './http'
import { teardownFixture } from './fixtures'
import type { ProbeLogger, WorkspaceHandle, WorkspaceSlot } from './types'

const out = (text: string) => process.stdout.write(`${text}\n`)
const err = (text: string) => process.stderr.write(`${text}\n`)

if (wantsHelp(process.argv.slice(2))) {
  err(usage())
  process.exit(0)
}

let config
try {
  config = parseConfig(process.argv.slice(2), process.env)
} catch (e) {
  if (e instanceof ConfigError) {
    err(`error: ${e.message}\n`)
    err(usage())
    process.exit(1)
  }
  throw e
}

const pino = createLogger({ base: { service_name: 'quackback-workspace-probe' } })
const log: ProbeLogger = {
  debug: (obj, msg) => pino.debug(obj, msg),
  info: (obj, msg) => pino.info(obj, msg),
  warn: (obj, msg) => pino.warn(obj, msg),
  error: (obj, msg) => pino.error(obj, msg),
}

if (config.teardown) {
  const tripwire = createTripwire(
    { slot: 'alpha', canary: '', ids: {} },
    { slot: 'bravo', canary: '', ids: {} }
  )
  const { provisionFixture } = await import('./fixtures')
  for (const slot of ['alpha', 'bravo'] as WorkspaceSlot[]) {
    const baseUrl = slot === 'alpha' ? config.alphaUrl : config.bravoUrl
    const handle: WorkspaceHandle = {
      slot,
      baseUrl,
      markers: { slot, canary: '', ids: {} },
      http: createWorkspaceHttp({
        slot,
        baseUrl,
        tripwire,
        defaultTimeoutMs: config.requestTimeoutMs,
      }),
    }
    try {
      handle.fixture = await provisionFixture(handle, config)
      const result = await teardownFixture(handle, config)
      err(`[${slot}] removed: ${result.removed.join(', ') || 'nothing'}`)
      if (result.failed.length > 0) err(`[${slot}] failed: ${result.failed.join(', ')}`)
    } catch (e) {
      err(`[${slot}] teardown failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
  }
  process.exit(0)
}

const output = await runSuite(config, log)
const json = JSON.stringify(output.report, null, 2)

if (config.jsonOut) {
  writeFileSync(config.jsonOut, `${json}\n`, 'utf8')
  err(`JSON report written to ${config.jsonOut}`)
} else {
  out(json)
}

err(renderHumanSummary(output))
process.exit(exitCodeFor(output.report))
