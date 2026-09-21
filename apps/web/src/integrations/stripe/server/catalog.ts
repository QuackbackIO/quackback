import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const stripeCatalog: IntegrationCatalogEntry = {
  id: 'stripe',
  name: 'Stripe',
  description: 'Find customers by email and open their billing profile.',
  category: 'support_crm',
  iconBg: 'bg-[#635BFF]',
  settingsPath: '/admin/settings/integrations/stripe',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/stripe',
}
