import { backfillIntegrationInstalls } from './install-registry'
export async function runInstallsBackfill() {
  await backfillIntegrationInstalls()
}
