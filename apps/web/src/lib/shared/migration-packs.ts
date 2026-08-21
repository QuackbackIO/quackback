/**
 * Guided migration packs — productized entry points beyond raw CSV/CLI.
 * Vendors are described by pattern only in UI copy that lives outside source
 * (marketing). In-app we use generic labels: Feedback portal, Support suite,
 * Help center.
 */
const IMPORT_CSV_HREF = '#import-csv'

export const MIGRATION_PACKS = [
  {
    id: 'feedback_portal',
    title: 'Feedback portal',
    description: 'Import boards, posts, votes, and comments from a feedback portal CSV export.',
    href: IMPORT_CSV_HREF,
  },
  {
    id: 'support_suite',
    title: 'Support suite',
    description:
      'Import help articles and prepare conversation history for a support-suite migration.',
    href: IMPORT_CSV_HREF,
  },
  {
    id: 'help_center',
    title: 'Help center',
    description: 'Import categories and articles from a help-center CSV export.',
    href: IMPORT_CSV_HREF,
  },
] as const
