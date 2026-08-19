/**
 * Catalog entry for the _template provider (IF WO-12).
 *
 * The catalog is the provider's card in the integrations gallery: name,
 * one-line description, brand color, and where its settings live. `available`
 * gates whether it shows at all; `configurable` distinguishes "coming soon"
 * from a connectable provider. Copy this file, rename `template` → your id, and
 * fill in real copy.
 */
import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const templateCatalog: IntegrationCatalogEntry = {
  id: 'template',
  name: 'Acme Tracker',
  description: 'A worked example: copy this folder to add a new integration.',
  category: 'issue_tracking',
  iconBg: 'bg-[#6366f1]',
  // The single dynamic route matches this path to the registry entry (IF WO-6).
  settingsPath: '/admin/settings/integrations/template',
  // The template is a fixture, never a live provider — keep it unavailable so it
  // can't be connected. A real provider sets `available: true`.
  available: false,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations',
}
