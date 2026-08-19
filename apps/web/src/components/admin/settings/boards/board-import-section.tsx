import { Link } from '@tanstack/react-router'
import { ArrowsRightLeftIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

// boardId is unused for now: the hub's uploader doesn't yet accept a
// preselected board via URL. Kept on the props contract so the wizard can
// wire it through without touching this call site again.
interface BoardImportSectionProps {
  boardId: string
}

/**
 * Deep link into the Imports & exports hub (§I1). The board-scoped uploader
 * used to live here; imports now run through the hub's async pipeline.
 */
export function BoardImportSection(_props: BoardImportSectionProps) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 p-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">
        Import a CSV of posts into this board from the Imports &amp; exports hub.
      </p>
      <Button asChild>
        <Link to="/admin/settings/imports">
          <ArrowsRightLeftIcon className="size-4" />
          Go to Imports &amp; exports
        </Link>
      </Button>
    </div>
  )
}
