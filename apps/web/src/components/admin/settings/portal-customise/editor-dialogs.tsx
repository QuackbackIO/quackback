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
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { UpgradeModal } from '@/components/admin/upgrade'
import type { BrandAsset } from '@/lib/shared/theme/brand-import'
import { cn } from '@/lib/shared/utils'
import type { ImportedBrand } from './portal-draft'
import { conflictPartNames, type AssetCheck, type PortalEditor } from './use-portal-editor'

/**
 * The editor's four questions: leaving with unpublished changes, imported
 * brand assets to confirm before they go live, someone else's change to the
 * same settings, and a plan that lacks the Advanced CSS rules (any other plan
 * refusal opens the usual upgrade dialog).
 */
export function PortalEditorDialogs({
  editor,
  onPublishAssets,
}: {
  editor: PortalEditor
  /** Publish with `keep` confirmed and `drop` taken back out of the draft. */
  onPublishAssets: (keep: BrandAsset[], drop: BrandAsset[]) => void
}) {
  const { blocker, conflict, planRefusal, assetCheck } = editor
  const count = editor.changes.length
  return (
    <>
      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without publishing?</AlertDialogTitle>
            <AlertDialogDescription>
              {count === 1 ? '1 change will be lost.' : `${count} changes will be lost.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => blocker.status === 'blocked' && blocker.proceed()}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={assetCheck !== null}
        onOpenChange={(open) => {
          if (!open) editor.dismissAssetCheck()
        }}
      >
        {/* Mounted per check, so what was left out last time starts kept again. */}
        {assetCheck ? (
          <BrandAssetsContent
            key={assetCheck.assets.join(' ')}
            check={assetCheck}
            onPublish={onPublishAssets}
          />
        ) : null}
      </AlertDialog>

      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) editor.dismissConflict()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Someone else changed these settings</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>They published a change while you were editing:</p>
                <ul className="list-disc ps-5 text-foreground">
                  {conflictPartNames(conflict?.parts ?? []).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={editor.loadTheirs}>Load theirs</AlertDialogCancel>
            <AlertDialogAction onClick={() => void editor.keepMine()}>Keep mine</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={planRefusal?.customCss === true}
        onOpenChange={(open) => {
          if (!open) editor.dismissPlanRefusal()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Your own CSS rules need the Business plan</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Custom CSS is a Business feature. Upgrade to Business to enable it.</p>
                <p>
                  Everything else can go live now. Your rules stay in Advanced CSS, marked not live.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" asChild>
              <Link
                to="/admin/settings/billing"
                search={{ checkout: undefined, billing_error: undefined }}
              >
                See Business plan
              </Link>
            </Button>
            <AlertDialogAction onClick={() => void editor.publishRest()}>
              Publish the rest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {planRefusal && !planRefusal.customCss ? (
        <UpgradeModal
          open
          onOpenChange={(open) => {
            if (!open) editor.dismissPlanRefusal()
          }}
          description={planRefusal.description}
        />
      ) : null}
    </>
  )
}

/** What the confirmation calls each brand asset. */
function assetName(asset: BrandAsset, brand: ImportedBrand): string {
  switch (asset) {
    case 'logo':
      return 'Logo'
    case 'icon':
      return 'Icon'
    case 'font':
      return brand.siteFont ? `${brand.siteFont.family}, text font` : 'Text font'
    case 'headingFont':
      return brand.siteHeadingFont
        ? `${brand.siteHeadingFont.family}, headings font`
        : 'Headings font'
  }
}

/** The asset's picture: the logo or icon as found, or a letter pair for a font. */
function AssetThumb({ asset, brand }: { asset: BrandAsset; brand: ImportedBrand }) {
  const url = asset === 'logo' ? brand.logo?.url : asset === 'icon' ? brand.icon?.url : undefined
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md bg-muted/60"
    >
      {url ? (
        <img
          src={url}
          alt=""
          className={cn('object-contain', asset === 'logo' ? 'max-h-6 max-w-12' : 'size-6 rounded')}
        />
      ) : (
        <span className="text-sm font-medium text-foreground">Aa</span>
      )}
    </span>
  )
}

/**
 * The question before imported brand assets go live: are they the brand's
 * own, or licensed to it? Each can be left out, which takes it back to what
 * the draft had before the import. Nothing is ticked for the person: the
 * confirm button is the confirmation.
 */
function BrandAssetsContent({
  check,
  onPublish,
}: {
  check: AssetCheck
  onPublish: (keep: BrandAsset[], drop: BrandAsset[]) => void
}) {
  const [left, setLeft] = useState<BrandAsset[]>([])
  const keep = check.assets.filter((asset) => !left.includes(asset))
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Can you use these?</AlertDialogTitle>
        <AlertDialogDescription>
          They came from {check.brand.host}. Publish only what your brand owns or has a licence for.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {check.assets.map((asset) => {
          const out = left.includes(asset)
          const name = assetName(asset, check.brand)
          return (
            <li key={asset} className="flex items-center gap-3 px-3 py-2">
              <span className={cn('contents', out && '[&>*]:opacity-40')}>
                <AssetThumb asset={asset} brand={check.brand} />
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm',
                  out ? 'text-muted-foreground line-through' : 'text-foreground'
                )}
              >
                {name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                aria-label={out ? `Put back ${name}` : `Leave out ${name}`}
                onClick={() =>
                  setLeft((all) => (out ? all.filter((a) => a !== asset) : [...all, asset]))
                }
              >
                {out ? 'Put back' : 'Leave out'}
              </Button>
            </li>
          )
        })}
      </ul>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => onPublish(keep, left)}>
          {keep.length === 0 ? 'Publish without them' : 'Confirm and publish'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
