import { createFileRoute } from '@tanstack/react-router'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { ChangelogListPublic } from '@/components/portal/changelog'

export const Route = createFileRoute('/_portal/changelog/')({
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <div className="py-8">
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Changelog</h1>
            <p className="text-muted-foreground">
              Stay up to date with the latest product updates and shipped features.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
            <a href="/changelog/feed" target="_blank" rel="noopener noreferrer">
              <RssIcon className="h-4 w-4" />
              <span className="hidden sm:inline">RSS Feed</span>
            </a>
          </Button>
        </div>
      </div>

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <ChangelogListPublic />
      </div>
    </div>
  )
}
