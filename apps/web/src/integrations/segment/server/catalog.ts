import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const segmentCatalog: IntegrationCatalogEntry = {
  id: 'segment',
  name: 'Segment',
  description: 'Sync user attributes from Segment into Quackback and push segment membership back.',
  category: 'user_data',
  iconBg: 'bg-[#52BD94]',
  settingsPath: '/admin/settings/integrations/segment',
  available: true,
  configurable: false,
  docsUrl: 'https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/',
}
