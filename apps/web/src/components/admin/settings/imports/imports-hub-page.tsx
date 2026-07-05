import { Link } from '@tanstack/react-router'
import { DocumentTextIcon, ShieldCheckIcon, CircleStackIcon } from '@heroicons/react/24/outline'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { Button } from '@/components/ui/button'
import { ArrowsRightLeftIcon } from '@heroicons/react/24/solid'
import { ImportWizard } from './import-wizard'
import { ImportHistoryList } from './import-history-list'

export function ImportsHubPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ArrowsRightLeftIcon}
        title="Imports & exports"
        description="Move feedback data in from a CSV or another tool, and out as CSV or JSON."
      />

      <SettingsCard
        title="Imports"
        description="Upload a CSV of posts, or pull from a tool you already use."
      >
        <ImportWizard />
        <div className="mt-6 border-t border-border/50 pt-4 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Migrating from another tool</p>
          <p className="text-xs text-muted-foreground">
            Migrating from UserVoice or Canny? Export your data from that tool, then upload the
            file above the same way as a CSV.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Exports" description="Download your data as CSV or JSON.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="outline" asChild className="justify-start">
            <a href="/api/export">
              <DocumentTextIcon className="size-4" />
              Export posts (CSV)
            </a>
          </Button>
          <Button variant="outline" asChild className="justify-start">
            <Link to="/admin/settings/security/authentication" search={{ tab: 'audit-log' }}>
              <ShieldCheckIcon className="size-4" />
              Export audit log (CSV)
            </Link>
          </Button>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <CircleStackIcon className="size-4 shrink-0 mt-0.5" />
          <p>
            Need a full database backup instead? Use the <code>backup</code> CLI command that ships
            with your Quackback install — it produces an encrypted, restorable archive covering
            everything, not just what CSV/JSON can express.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Import history" description="Recent import runs and their results.">
        <ImportHistoryList />
      </SettingsCard>
    </div>
  )
}
