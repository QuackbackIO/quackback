import { cn } from '@/lib/shared/utils/cn'
import { Button } from '@/components/ui/button'

interface BoardSettingsSaveDockProps {
  dirty: boolean
  saving: boolean
  onDiscard: () => void
  /**
   * When set, the dock shows a destructive status (the `errorMessage` instead
   * of "unsaved changes") and blocks Save. Defaults to no error.
   */
  error?: boolean
  errorMessage?: string
}

/**
 * Sticky bottom save dock shared by the board Access + Moderation sub-pages.
 * Slides in while the owning form is dirty; the Save button is `type="submit"`
 * so it relies on being rendered inside that form.
 */
export function BoardSettingsSaveDock({
  dirty,
  saving,
  onDiscard,
  error = false,
  errorMessage,
}: BoardSettingsSaveDockProps) {
  return (
    <div
      role="region"
      aria-label="Save changes"
      data-dirty={dirty || undefined}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-sm transition-transform duration-200',
        dirty ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              error ? 'bg-destructive' : 'bg-primary'
            )}
            style={
              error
                ? { boxShadow: '0 0 8px rgba(248, 113, 113, 0.6)' }
                : { boxShadow: '0 0 8px rgba(250, 204, 21, 0.6)' }
            }
          />
          {error ? errorMessage : 'You have unsaved changes.'}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button type="submit" size="sm" disabled={error || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
