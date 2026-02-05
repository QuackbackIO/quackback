import { createFileRoute } from '@tanstack/react-router'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ChangelogListPublic } from '@/components/portal/changelog'

export const Route = createFileRoute('/_portal/changelog/')({
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <div className="py-8">
      <PageHeader
        size="large"
        title="Changelog"
        description="Stay up to date with the latest product updates and shipped features."
        action={
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
            <a href="/changelog/feed" target="_blank" rel="noopener noreferrer">
              <RssIcon className="h-4 w-4" />
              <span className="hidden sm:inline">RSS Feed</span>
            </a>
          </Button>
        }
        animate
        className="mb-8"
      />

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <ChangelogListPublic />
      </div>
    </div>
  )
}
