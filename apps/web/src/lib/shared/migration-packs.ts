/**
 * Guided migration packs — productized entry points beyond raw CSV/CLI.
 * Vendors are described by pattern only in UI copy that lives outside source
 * (marketing). In-app we use generic labels: Feedback portal, Support suite,
 * Help center.
 */
export const MIGRATION_PACKS = [
  {
    id: 'feedback_portal',
    title: 'Feedback portal',
    description: 'Import boards, posts, votes, and comments from a feedback portal CSV export.',
    entity: 'posts' as const,
    href: '#import-csv',
  },
  {
    id: 'support_suite',
    title: 'Support suite',
    description:
      'Import help articles and prepare conversation history for a support-suite migration.',
    entity: 'help_articles' as const,
    href: '#import-csv',
  },
  {
    id: 'help_center',
    title: 'Help center',
    description: 'Import categories and articles from a help-center CSV export.',
    entity: 'help_articles' as const,
    href: '#import-csv',
  },
] as const

export type MigrationPackId = (typeof MIGRATION_PACKS)[number]['id']
