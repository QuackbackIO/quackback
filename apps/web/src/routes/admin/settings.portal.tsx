import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { MegaphoneIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { PortalWelcomeCard } from '@/components/public/feedback/portal-welcome-card'
import { settingsQueries } from '@/lib/client/queries/settings'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { DEFAULT_PORTAL_CONFIG, PORTAL_WELCOME_CARD_TITLE_MAX } from '@/lib/shared/types/settings'
import type {
  PortalConfig,
  PortalWelcomeCard as PortalWelcomeCardData,
} from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'

const DEBOUNCE_MS = 800

export const Route = createFileRoute('/admin/settings/portal')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: PortalSettingsPage,
})

function PortalSettingsPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = portalConfigQuery.data as PortalConfig

  // Same pattern as settings.help-center.tsx / settings.portal-widget.tsx:
  // initialize local state once from the loader-warmed query, then treat
  // local state as the source of truth post-mount. router.invalidate after
  // each save refreshes the cache for the next visit, but we never re-sync
  // the live form fields from it — that would race the server-side
  // sanitizer's normalisation back into the editor and reopen a save loop.
  const [enabled, setEnabled] = useState(config.welcomeCard?.enabled ?? false)
  const [title, setTitle] = useState(
    config.welcomeCard?.title ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.title
  )
  const [body, setBody] = useState<TiptapContent>(
    config.welcomeCard?.body ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.body
  )
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  function clearPendingTimer() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  useEffect(() => clearPendingTimer, [])

  const isBusy = saving || isPending

  async function saveSnapshot(card: PortalWelcomeCardData) {
    setSaving(true)
    try {
      await updatePortalConfigFn({ data: { welcomeCard: card } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  function scheduleSave(card: PortalWelcomeCardData) {
    clearPendingTimer()
    saveTimerRef.current = setTimeout(() => {
      saveSnapshot(card)
    }, DEBOUNCE_MS)
  }

  function handleEnabledToggle(checked: boolean) {
    clearPendingTimer()
    setEnabled(checked)
    // Toggling is immediate so admins see the public-portal state flip
    // without waiting on a debounce.
    saveSnapshot({ enabled: checked, title, body })
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    scheduleSave({ enabled, title: value, body })
  }

  function handleBodyChange(json: JSONContent) {
    const next = json as TiptapContent
    setBody(next)
    scheduleSave({ enabled, title, body: next })
  }

  const previewCard = useMemo<PortalWelcomeCardData>(
    () => ({ enabled: true, title, body }),
    [title, body]
  )
  const isPreviewEmpty = !title.trim() && isEmptyTiptapDoc(body)

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={MegaphoneIcon}
        title="Portal"
        description="Customize how the public portal greets visitors"
      />

      <SettingsCard
        title="Welcome card"
        description="Show a customizable message above the post list on your portal home"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
            <div>
              <Label htmlFor="welcome-enabled" className="text-sm font-medium cursor-pointer">
                Enable welcome card
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shown at the top of the portal home page above the post list
              </p>
            </div>
            <div className="flex items-center gap-2">
              <InlineSpinner visible={isBusy} />
              <Switch
                id="welcome-enabled"
                checked={enabled}
                onCheckedChange={handleEnabledToggle}
                disabled={isBusy}
                aria-label="Enable welcome card"
              />
            </div>
          </div>

          {/* Title and message stay editable when the card is disabled so
              admins can draft the next announcement without it going live
              the moment they flip the switch on. */}
          <div className="space-y-1.5">
            <Label htmlFor="welcome-title" className="text-sm font-medium">
              Title
            </Label>
            <Input
              id="welcome-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Share your product feedback!"
              maxLength={PORTAL_WELCOME_CARD_TITLE_MAX}
              disabled={isBusy}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Message</Label>
            <RichTextEditor
              value={body}
              onChange={(json) => handleBodyChange(json)}
              placeholder="Tell visitors what kind of feedback you'd love to hear…"
              minHeight="160px"
              disabled={isBusy}
              features={{
                headings: true,
                images: true,
                codeBlocks: true,
                taskLists: true,
                blockquotes: true,
                tables: true,
                dividers: true,
                bubbleMenu: true,
                slashMenu: true,
                embeds: true,
              }}
              onImageUpload={uploadImage}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <div className="rounded-lg border border-dashed border-border/60 bg-background/50 p-4">
              {isPreviewEmpty ? (
                <p className="text-xs text-muted-foreground italic">
                  Add a title or message to see the welcome card preview
                </p>
              ) : (
                <PortalWelcomeCard welcomeCard={previewCard} />
              )}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
