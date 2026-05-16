import { useMemo, useState, useTransition } from 'react'
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
import { Button } from '@/components/ui/button'
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

  // Initialise once from the loader-warmed query and treat local state as
  // authoritative until the user explicitly clicks Save. router.invalidate
  // after a successful save refreshes the cache for the next visit, but the
  // live form fields never get re-synced from it.
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

  const isBusy = saving || isPending

  async function handleSave() {
    setSaving(true)
    try {
      await updatePortalConfigFn({
        data: { welcomeCard: { enabled, title, body } },
      })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
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
            <Switch
              id="welcome-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enable welcome card"
            />
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Share your product feedback!"
              maxLength={PORTAL_WELCOME_CARD_TITLE_MAX}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Message</Label>
            <RichTextEditor
              value={body}
              onChange={(json: JSONContent) => setBody(json as TiptapContent)}
              placeholder="Tell visitors what kind of feedback you'd love to hear…"
              minHeight="160px"
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <InlineSpinner visible={isBusy} />
            <Button onClick={handleSave} disabled={isBusy}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
