import { readdir, readFile } from 'node:fs/promises'
import { assessReplaySafety } from '../apps/web/src/lib/server/policy/migration-contract/replay-safety'
const directory = new URL('../packages/db/drizzle/', import.meta.url)
const files = (await readdir(directory)).filter(
  file => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) >= 285
).sort()
if (files.length === 0) throw new Error('No Quinn migrations found')
let failed = false
for (const file of files) {
  const tag = file.slice(0, -4)
  const { verdict } = assessReplaySafety(tag, await readFile(new URL(file, directory), 'utf8'))
  process.stdout.write(`${tag}: ${verdict}\n`)
  failed ||= verdict === 'mutates'
}
if (failed) process.exitCode = 1
