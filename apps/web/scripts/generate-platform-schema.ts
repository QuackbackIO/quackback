/**
 * Writes `src/lib/shared/platform-schema.generated.json`, the machine-readable
 * description of the integration platform-credential fields and the AI
 * configuration keys.
 *
 * Run: `bun run generate:platform-schema` from `apps/web`.
 *
 * The derivation lives in
 * `src/lib/server/domains/platform-credentials/platform-schema.ts`, beside the
 * reader whose transform it inverts, and is shared with the test that guards the
 * committed artifact. This file is only the command.
 */
import { writeFileSync } from 'node:fs'
import {
  ARTIFACT_PATH,
  derivePlatformSchema,
  serializePlatformSchema,
} from '../src/lib/server/domains/platform-credentials/platform-schema'

const schema = derivePlatformSchema()
writeFileSync(ARTIFACT_PATH, serializePlatformSchema(schema))

const fieldCount = schema.providers.reduce((n, p) => n + p.fields.length, 0)
const configurable = schema.providers.filter((p) => p.configurable).length
process.stdout.write(
  `platform schema: ${schema.providers.length} providers ` +
    `(${configurable} configurable, ${fieldCount} fields), ` +
    `${schema.ai.keys.length} AI keys\n`
)
