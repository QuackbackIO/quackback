/** Run explicitly on a configured fleet process after the CP migration. */
import { runFleetPass } from '../src/lib/server/workspaces/fleet'
import { backfillIntegrationInstalls } from '../src/lib/server/integrations/install-registry'
const result = await runFleetPass('script', backfillIntegrationInstalls, { includeDormant: true })
console.log(JSON.stringify(result))
process.exitCode = result.failed || result.skipped || result.dormant ? 1 : 0
