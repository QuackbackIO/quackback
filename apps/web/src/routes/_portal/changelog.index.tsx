import { createFileRoute } from '@tanstack/react-router'
import { ChangelogListPublic } from '@/components/portal/changelog'

export const Route = createFileRoute('/_portal/changelog/')({
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <div className="py-8">
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards">
        <h1 className="text-3xl font-bold mb-2">Changelog</h1>
        <p className="text-muted-foreground">
          Stay up to date with the latest product updates and shipped features.
        </p>
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
