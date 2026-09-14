/**
 * Operator Labs configuration.
 *
 * Visibility stays off the ordinary Labs form. This script uses the normal
 * Labs service and settings-cache invalidation path.
 *
 *   bun run apps/web/scripts/labs-experiment.ts visible refined-visual-theme true
 *   bun run apps/web/scripts/labs-experiment.ts visible refined-visual-theme false
 *   bun run apps/web/scripts/labs-experiment.ts enabled refined-visual-theme true
 *   bun run apps/web/scripts/labs-experiment.ts enabled refined-visual-theme false
 *
 * Pooled fleets (optional hostname):
 *
 *   bun run apps/web/scripts/labs-experiment.ts --hostname app.example.com visible refined-visual-theme true
 *
 * Prints `{ experimentId, visible, enabled }` only. No secrets.
 */
import { acquireScopeForHost } from '@/lib/server/workspaces/resolver'
import { runWithWorkspaceScope } from '@/lib/server/workspaces/workspace-context'
import {
  getExperimentStateForWorkspace,
  setOperatorExperimentColumn,
} from '@/lib/server/domains/settings/settings.labs'
import { isRegisteredExperimentId } from '@/lib/shared/labs'

const OPERATOR_ACTOR = {
  type: 'service' as const,
  email: 'operator:cli',
}

function usage(): never {
  console.error(
    'usage: labs-experiment.ts [--hostname <host>] <visible|enabled> <experiment-id> <true|false>'
  )
  process.exit(2)
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  usage()
}

const raw = process.argv.slice(2)
let hostname: string | undefined
const args: string[] = []
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === '--hostname') {
    hostname = raw[i + 1]
    if (!hostname) usage()
    i += 1
    continue
  }
  args.push(raw[i]!)
}

const [column, experimentId, valueRaw] = args
if ((column !== 'visible' && column !== 'enabled') || !experimentId || valueRaw === undefined) {
  usage()
}

if (!isRegisteredExperimentId(experimentId)) {
  console.error(`unknown experiment: ${experimentId}`)
  process.exit(2)
}

const value = parseBoolean(valueRaw)

async function run(): Promise<{ experimentId: string; visible: boolean; enabled: boolean }> {
  await setOperatorExperimentColumn({
    experimentId,
    column,
    value,
    actor: OPERATOR_ACTOR,
  })
  const confirmed = await getExperimentStateForWorkspace(experimentId)
  return { experimentId, visible: confirmed.visible, enabled: confirmed.enabled }
}

async function main(): Promise<void> {
  const result = hostname
    ? await (async () => {
        const acquired = await acquireScopeForHost(hostname, 'script')
        if (acquired.kind !== 'ok') {
          throw new Error(`${hostname} did not resolve: ${acquired.kind}`)
        }
        return runWithWorkspaceScope(acquired.scope, run)
      })()
    : await run()

  console.log(JSON.stringify(result))
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
