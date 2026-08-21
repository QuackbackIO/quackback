import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { ArrowsRightLeftIcon } from '@heroicons/react/24/solid'
import { ImportCsv } from './import-csv'
import { ImportHistoryList } from './import-history-list'
import { ExportWorkspaceAction } from './export-workspace-action'
import { ExportHistoryList } from './export-history-list'
import { MIGRATION_PACKS } from '@/lib/shared/migration-packs'
import { Badge } from '@/components/ui/badge'

export function ImportsHubPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ArrowsRightLeftIcon}
        title="Imports & exports"
        description="Move feedback data in from a CSV or another tool, and out as a full workspace export."
      />

      <SettingsCard
        title="Migration packs"
        description="Start from a guided pack for the kind of product you are leaving. Each pack points at the CSV shape Quackback accepts today."
      >
        <div className="divide-y divide-border/60">
          {MIGRATION_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">{pack.title}</h3>
                  <Badge size="sm" variant="secondary" shape="pill">
                    CSV
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{pack.description}</p>
                <a
                  href={pack.href}
                  className="mt-1 inline-block text-xs font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Use the CSV import below
                </a>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      <div id="import-csv">
        <SettingsCard
          title="Imports"
          description="Upload a CSV of posts using the template — new boards, statuses, and tags are created as part of the import."
        >
          <ImportCsv />
          <div className="mt-6 border-t border-border/50 pt-4 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Moving from another tool</p>
            <p className="text-xs text-muted-foreground">
              Export your data from the old tool, map it onto the template columns (only title and
              content are required), and upload it above. Keep the source_id column filled to re-run
              an import later without duplicating posts.
            </p>
          </div>
        </SettingsCard>
      </div>

      <SettingsCard
        title="Export workspace data"
        description="Everything in your workspace as one ZIP: posts, comments, votes, boards, people, companies, conversations, and changelog — plus a manifest. CSV for tabular data, JSONL for conversations. Download links expire after 7 days."
      >
        <ExportWorkspaceAction />
        <div className="mt-6 border-t border-border/50 pt-4">
          <ExportHistoryList />
        </div>
        <div className="mt-4 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Looking for a filtered slice instead? Users and companies CSVs live in the People
            directory, posts CSV in board settings, and the audit log CSV in Security settings.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Import history" description="Recent import runs and their results.">
        <ImportHistoryList />
      </SettingsCard>
    </div>
  )
}
