import { Fragment, useState } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import {
  ArrowUturnLeftIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { draftWords } from '@/lib/shared/design/builder-chrome'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { Selection } from '@/lib/shared/design/outline'
import { cn } from '@/lib/shared/utils'

/** What the menu's first lines say about the draft. */
function notLive(count: number, published: boolean): string {
  const changes = count === 1 ? '1 change' : `${count} changes`
  return published
    ? `${changes} since you last published. Visitors see them when you publish.`
    : `${changes}. Visitors see them when you first publish.`
}

/**
 * The draft's state: how many changes are not live yet, or whether it is
 * saving. Its menu sees every change or discards the draft (after asking),
 * and holds versions, a preview link to share and find.
 */
export function DraftStatus({
  count,
  saving,
  failed,
  blocked,
  published,
  onSeeAll,
  onDiscard,
  onVersions,
  onShare,
  onFind,
  checks = [],
  onShowCheck = () => {},
  onFixCheck = () => {},
}: {
  count: number
  saving: boolean
  failed: boolean
  blocked: boolean
  /** Whether the portal has been published before. */
  published: boolean
  onSeeAll: () => void
  onDiscard: () => void
  onVersions: () => void
  onShare: () => void
  onFind: () => void
  /** Things to check before publishing, each of which leads to the part that fixes it. */
  checks?: readonly DesignCheck[]
  onShowCheck?: (part: Selection) => void
  /** Makes a check's one-step fix. */
  onFixCheck?: (check: DesignCheck) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const { text, tone } = draftWords({ count, saving, failed, blocked })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title={text}
            className="max-w-full min-w-0 gap-2 border-border font-normal data-popup-open:border-foreground"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                tone === 'draft' && 'bg-amber-600',
                tone === 'warning' && 'bg-destructive',
                tone === 'quiet' && 'bg-muted-foreground/50'
              )}
            />
            <span className="min-w-0 truncate">{text}</span>
            <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {count > 0 && (
            <div className="space-y-0.5 px-2 pt-1.5 pb-2">
              <p className="text-[13px] font-semibold">Not live yet</p>
              <p className="text-xs text-muted-foreground">{notLive(count, published)}</p>
            </div>
          )}
          <DropdownMenuItem disabled={count === 0} onClick={onSeeAll}>
            <ListBulletIcon aria-hidden="true" />
            See every change
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={count === 0}
            onClick={() => setConfirming(true)}
            className="text-destructive focus:text-destructive"
          >
            <ArrowUturnLeftIcon aria-hidden="true" />
            Discard draft
          </DropdownMenuItem>
          {checks.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {checks.length === 1 ? '1 thing to check' : `${checks.length} things to check`}
              </DropdownMenuLabel>
              {checks.map((check) => (
                <Fragment key={check.id}>
                  <DropdownMenuItem onClick={() => onShowCheck(check.part)}>
                    <ExclamationTriangleIcon aria-hidden="true" />
                    <span className="max-w-64 truncate">{check.text}</span>
                  </DropdownMenuItem>
                  {check.fix && (
                    <DropdownMenuItem className="ps-8" onClick={() => onFixCheck(check)}>
                      {check.fix.label}
                    </DropdownMenuItem>
                  )}
                </Fragment>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onVersions}>
            <ClockIcon aria-hidden="true" />
            Versions
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShare}>
            <LinkIcon aria-hidden="true" />
            Share a preview link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFind}>
            <MagnifyingGlassIcon aria-hidden="true" />
            Find a setting
            <DropdownMenuShortcut className="tracking-normal">Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Every change goes and the builder shows what is live now. Undo brings it back while
              the builder is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the draft</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onDiscard}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
