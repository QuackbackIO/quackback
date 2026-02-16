import type { IntegrationCatalogEntry } from '../types'

export const stripeCatalog: IntegrationCatalogEntry = {
  id: 'stripe',
  name: 'Stripe',
  description: 'Enrich feedback with customer revenue and subscription data.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Revenue enrichment',
      description:
        'See MRR, plan tier, and billing status alongside feedback to prioritize high-value customers',
    },
    {
      label: 'Customer lookup',
      description: 'Automatically match feedback authors to Stripe customers by email address',
    },
    {
      label: 'Subscription context',
      description:
        'View subscription status, plan name, and lifetime value for each feedback author',
    },
  ],
  iconBg: 'bg-[#635BFF]',
  settingsPath: '/admin/settings/integrations/stripe',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/stripe',
}
