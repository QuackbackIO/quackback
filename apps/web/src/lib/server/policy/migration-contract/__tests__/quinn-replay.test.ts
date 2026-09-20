import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { assessReplaySafety } from '../replay-safety'

const directory = join(__dirname, '../../../../../../../../packages/db/drizzle')
const files = readdirSync(directory).filter(file => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) >= 285)

it('checks the complete Quinn migration span', () => {
  expect(files.length).toBeGreaterThanOrEqual(10)
})

it.each(files)('%s passes the ordinary fleet forward replay gate', file => {
  const assessment = assessReplaySafety(file.slice(0, -4), readFileSync(join(directory, file), 'utf8'))
  expect(['safe', 'errors'], JSON.stringify(assessment)).toContain(assessment.verdict)
})
