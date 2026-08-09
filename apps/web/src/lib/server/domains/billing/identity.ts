/**
 * Who this workspace is, to the billing provider.
 *
 * Two callers with opposite jobs share it, which is why it lives on its own
 * rather than inside either: `ensureCustomer()` writes the stamp when it
 * creates a customer, and `ownsSubscription()` reads it back to decide
 * whether an unrecognised subscription may be adopted. Keeping one definition
 * of "this workspace's identity" is the whole point — two would drift, and
 * the failure would be a cross-tenant adoption rather than a type error.
 */

import { requireSettings } from '../settings/settings.helpers'

/**
 * This workspace's identity, as stamped into a provider customer.
 *
 * The settings row id: exactly one row per database, stable for the life of
 * the workspace, and already the identifier every other per-workspace record
 * keys on. Deliberately not the slug (renameable) or the base URL (a domain
 * move would orphan every customer this module ever created).
 */
export async function workspaceStamp(): Promise<string> {
  const row = await requireSettings()
  return row.id
}
