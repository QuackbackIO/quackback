import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { MegaphoneIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
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

function InlineSpinner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
}

function getInitialWelcomeCard(config: PortalConfig): PortalWelcomeCardData {
  return {
    ...DEFAULT_PORTAL_CONFIG.welcomeCard!,
    ...config.welcomeCard,
  }
}

function PortalSettingsPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = portalConfigQuery.data as PortalConfig
  const initial = useMemo(() => getInitialWelcomeCard(config), [config])

  const [enabled, setEnabled] = useState(initial.enabled)
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState<TiptapContent>(initial.body)
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })

  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const bodyTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
      if (bodyTimeoutRef.current) clearTimeout(bodyTimeoutRef.current)
    }
  }, [])

  const isBusy = saving || isPending

  async function saveField(welcomeCard: Partial<PortalWelcomeCardData>) {
    setSaving(true)
    try {
      await updatePortalConfigFn({ data: { welcomeCard } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  function handleEnabledToggle(checked: boolean) {
    setEnabled(checked)
    saveField({ enabled: checked })
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
    titleTimeoutRef.current = setTimeout(() => {
      saveField({ title: value })
    }, DEBOUNCE_MS)
  }

  function handleBodyChange(json: JSONContent) {
    const next = json as TiptapContent
    setBody(next)
    if (bodyTimeoutRef.current) clearTimeout(bodyTimeoutRef.current)
    bodyTimeoutRef.current = setTimeout(() => {
      saveField({ body: next })
    }, DEBOUNCE_MS)
  }

  const previewCard: PortalWelcomeCardData = { enabled: true, title, body }

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
              disabled={!enabled || isBusy}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Message</Label>
            <RichTextEditor
              value={body}
              onChange={(json) => handleBodyChange(json)}
              placeholder="Tell visitors what kind of feedback you'd love to hear…"
              minHeight="160px"
              disabled={!enabled || isBusy}
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
              <PortalWelcomeCard welcomeCard={previewCard} />
              {!title.trim() && !previewCard.body?.content?.length && (
                <p className="text-xs text-muted-foreground italic">
                  Add a title or message to see the welcome card preview
                </p>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
