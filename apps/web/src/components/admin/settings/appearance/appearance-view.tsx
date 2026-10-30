import { useEffect, useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'
import { ClientOnly } from '@tanstack/react-router'
import { ComputerDesktopIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PortalPreview } from '@/components/admin/settings/branding/portal-preview'
import { track } from '@/lib/client/analytics'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { DESIGN_AI_SCOPES, type DesignAiScope } from '@/lib/shared/design/apply-changes'
import { cn } from '@/lib/shared/utils'
import { AskAiPanel } from './ask-ai-panel'
import { BrandPanel } from './brand-panel'
import { DesignComposer } from './design-composer'
import { DesignDraftBar } from './design-draft-bar'
import { HistoryDialog } from './history-dialog'
import { ReviewPublishDialog } from './review-publish-dialog'
import { SectionsPanel } from './sections-panel'
import { useDesignAi } from './use-design-ai'
import { useDesignDraft } from './use-design-draft'

/**
 * Appearance: the panel on the left edits the design draft, which saves as it
 * changes; the preview on the right shows the draft. Quackback AI changes the
 * same draft. Nothing reaches visitors until a person reviews and publishes it.
 */
export function AppearanceView({
  workspaceName,
  faviconUrl,
  logoUrl = null,
}: {
  workspaceName: string
  faviconUrl: string | null
  logoUrl?: string | null
}) {
  const draft = useDesignDraft()
  const { available } = useSuspenseQuery(portalDesignQueries.aiStatus()).data
  const ai = useDesignAi({ flush: draft.flush, adopt: draft.adopt })
  const [theme, setTheme] = useState<'light' | 'dark'>(
    draft.design.mode === 'dark' ? 'dark' : 'light'
  )
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [reviewing, setReviewing] = useState(false)
  const [history, setHistory] = useState(false)
  const [tab, setTab] = useState(available ? 'ask' : 'brand')
  const [scope, setScope] = useState<DesignAiScope>('site')
  // A section clicked in the preview opens its controls and scopes the composer to it.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const message = event.data as { type?: string; section?: unknown } | null
      if (message?.type !== 'quackback:preview-section' || typeof message.section !== 'string')
        return
      setTab('sections')
      if ((DESIGN_AI_SCOPES as readonly string[]).includes(message.section))
        setScope(message.section as DesignAiScope)
      const id = `design-section-${message.section}`
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
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
    // The bottom padding keeps the composer clear of the draft bar.
    <div className="grid grid-cols-1 items-start gap-6 pb-24 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(String(next))
            if (next === 'brand') setScope('brand')
          }}
        >
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="ask">Ask AI</TabsTrigger>
              <TabsTrigger value="brand">Brand</TabsTrigger>
              <TabsTrigger value="sections">Sections</TabsTrigger>
            </TabsList>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setHistory(true)}>
              History
            </Button>
          </div>
          <TabsContent value="ask" className="pt-4">
            <AskAiPanel
              available={available}
              turns={ai.turns}
              busy={ai.busy}
              update={draft.update}
              onStart={(kind, value) => void ai.start(kind, value)}
              onLook={ai.lookPicked}
              onPresets={() => {
                void track('appearance_start_chosen', { start: 'preset' })
                setTab('brand')
              }}
              onWiden={(text) => {
                setScope('site')
                void ai.ask(text, 'site')
              }}
            />
          </TabsContent>
          <TabsContent value="brand" className="pt-4">
            <BrandPanel design={draft.design} update={draft.update} logoUrl={logoUrl} />
          </TabsContent>
          <TabsContent value="sections" className="pt-4">
            <SectionsPanel design={draft.design} update={draft.update} />
          </TabsContent>
        </Tabs>
        {available && (
          <DesignComposer
            scope={scope}
            busy={ai.busy}
            onClearScope={() => setScope('site')}
            onAsk={(text) => {
              setTab('ask')
              void ai.ask(text, scope)
            }}
          />
        )}
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
        onPublish={async (message) => {
          const outcome = await draft.publish(message)
          if (outcome.ok)
            void track('appearance_published', {
              source: ai.shaped.current ? 'ai' : 'manual',
              changes: draft.changes.length,
            })
          return outcome
        }}
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
