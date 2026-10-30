import { useMemo, useState } from 'react'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'
import { ClientOnly } from '@tanstack/react-router'
import { ComputerDesktopIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PortalPreview } from '@/components/admin/settings/branding/portal-preview'
import { cn } from '@/lib/shared/utils'
import { BrandPanel } from './brand-panel'
import { DesignDraftBar } from './design-draft-bar'
import { HistoryDialog } from './history-dialog'
import { ReviewPublishDialog } from './review-publish-dialog'
import { SectionsPanel } from './sections-panel'
import { useDesignDraft } from './use-design-draft'

/**
 * Appearance: the panel on the left edits the design draft, which saves as it
 * changes; the preview on the right shows the draft. Nothing reaches visitors
 * until a person reviews and publishes it.
 */
export function AppearanceView({
  workspaceName,
  faviconUrl,
}: {
  workspaceName: string
  faviconUrl: string | null
}) {
  const draft = useDesignDraft()
  const [theme, setTheme] = useState<'light' | 'dark'>(
    draft.design.mode === 'dark' ? 'dark' : 'light'
  )
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [reviewing, setReviewing] = useState(false)
  const [history, setHistory] = useState(false)
  // The welcome message reaches the preview on the structural channel, which
  // the feedback page already reads; an empty body hides it.
  const { show, body } = draft.design.pages.feedback.welcome
  const structural = useMemo(
    () => ({
      welcomeCard: {
        body: (show && !isEmptyTiptapDoc(body as TiptapContent)
          ? body
          : { type: 'doc', content: [] }) as TiptapContent,
      },
    }),
    [show, body]
  )

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Tabs defaultValue="brand">
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="brand">Brand</TabsTrigger>
              <TabsTrigger value="sections">Sections</TabsTrigger>
            </TabsList>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setHistory(true)}>
              History
            </Button>
          </div>
          <TabsContent value="brand" className="pt-4">
            <BrandPanel design={draft.design} update={draft.update} />
          </TabsContent>
          <TabsContent value="sections" className="pt-4">
            <SectionsPanel design={draft.design} update={draft.update} />
          </TabsContent>
        </Tabs>
        {draft.refusal && (
          <p role="alert" className="text-[13px] text-destructive">
            {draft.refusal}
          </p>
        )}
      </div>

      <div className="min-w-0 self-start xl:sticky xl:top-6">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="text-sm font-medium">Preview</span>
          <div className="ms-auto flex items-center gap-1.5">
            {(['light', 'dark'] as const).map((mode) => (
              <Button
                key={mode}
                variant="outline"
                size="sm"
                aria-pressed={theme === mode}
                disabled={draft.design.mode !== 'auto' && draft.design.mode !== mode}
                className={cn(theme === mode && 'bg-muted')}
                onClick={() => setTheme(mode)}
              >
                {mode === 'light' ? 'Light' : 'Dark'}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              aria-label={viewport === 'desktop' ? 'Show on a phone' : 'Show on a desktop'}
              onClick={() => setViewport(viewport === 'desktop' ? 'mobile' : 'desktop')}
            >
              {viewport === 'desktop' ? (
                <DevicePhoneMobileIcon className="size-4" />
              ) : (
                <ComputerDesktopIcon className="size-4" />
              )}
            </Button>
          </div>
        </div>
        <ClientOnly>
          <PortalPreview
            theme={draft.design.mode === 'auto' ? theme : draft.design.mode}
            refreshKey={String(draft.published?.number ?? 0)}
            draftCss=""
            cssDirty={false}
            draft={structural}
            draftDirty
            design={draft.preview}
            scaleToDesktop
            sort={draft.design.pages.feedback.defaultSort}
            viewport={viewport}
            workspaceName={workspaceName}
            faviconUrl={faviconUrl}
          />
        </ClientOnly>
      </div>

      <DesignDraftBar
        count={draft.changes.length}
        saving={draft.saving}
        onDiscard={() => void draft.discard()}
        onReview={() => setReviewing(true)}
      />
      <ReviewPublishDialog
        open={reviewing}
        onOpenChange={setReviewing}
        changes={draft.changes}
        report={draft.report}
        onPublish={draft.publish}
      />
      <HistoryDialog
        open={history}
        onOpenChange={setHistory}
        currentNumber={draft.published?.number ?? null}
        onRestore={draft.restore}
      />
    </div>
  )
}
