import { createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo } from 'react'
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { updateWidgetConfigFn, regenerateWidgetSecretFn } from '@/lib/server/functions/settings'

export const Route = createFileRoute('/admin/settings/widget')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      queryClient.ensureQueryData(adminQueries.boards()),
    ])

    return {}
  },
  component: WidgetSettingsPage,
})

function SavingIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <ArrowPathIcon className="h-4 w-4 animate-spin" />
      <span>Saving...</span>
    </div>
  )
}

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const widgetSecretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const { baseUrl } = useRouteContext({ from: '__root__' })

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Feedback Widget"
        description="Embed a feedback widget directly in your product to collect feedback from users"
      />

      <WidgetToggle initialEnabled={widgetConfigQuery.data.enabled} />
      <WidgetGeneralSettings config={widgetConfigQuery.data} boards={boardsQuery.data} />
      <WidgetIdentifySettings config={widgetConfigQuery.data} secret={widgetSecretQuery.data} />
      <WidgetEmbedCode baseUrl={baseUrl ?? ''} />
    </div>
  )
}

function WidgetToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)

  async function handleToggle(checked: boolean) {
    setEnabled(checked)
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: { enabled: checked } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard title="Widget" description="Enable or disable the embeddable feedback widget">
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="widget-toggle" className="text-sm font-medium cursor-pointer">
              Enable Feedback Widget
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, you can embed a feedback widget on any website using a script tag
            </p>
          </div>
          <Switch
            id="widget-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving || isPending}
            aria-label="Feedback Widget"
          />
        </div>
        <SavingIndicator visible={saving || isPending} />
      </div>
    </SettingsCard>
  )
}

function WidgetGeneralSettings({
  config,
  boards,
}: {
  config: { defaultBoard?: string; position?: string; buttonText?: string }
  boards: { id: string; name: string; slug: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [position, setPosition] = useState(config.position ?? 'bottom-right')
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [buttonText, setButtonText] = useState(config.buttonText ?? 'Feedback')

  async function save(updates: Record<string, unknown>) {
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: updates })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  const isBusy = saving || isPending

  return (
    <SettingsCard
      title="Appearance"
      description="Customize the widget trigger button and default behavior"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="widget-position" className="text-sm font-medium">
            Button Position
          </Label>
          <Select
            value={position}
            onValueChange={(val: 'bottom-right' | 'bottom-left') => {
              setPosition(val)
              save({ position: val })
            }}
            disabled={isBusy}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom-right">Bottom Right</SelectItem>
              <SelectItem value="bottom-left">Bottom Left</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="widget-board" className="text-sm font-medium">
            Default Board
          </Label>
          <p className="text-xs text-muted-foreground">
            Which board new posts from the widget are submitted to
          </p>
          <Select
            value={defaultBoard}
            onValueChange={(val) => {
              setDefaultBoard(val)
              save({ defaultBoard: val || undefined })
            }}
            disabled={isBusy}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="All Boards" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Boards</SelectItem>
              {boards.map((board) => (
                <SelectItem key={board.id} value={board.slug}>
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="widget-button-text" className="text-sm font-medium">
            Button Text
          </Label>
          <div className="flex items-center gap-2 max-w-xs">
            <Input
              id="widget-button-text"
              value={buttonText}
              onChange={(e) => setButtonText(e.target.value)}
              onBlur={() => {
                if (buttonText !== (config.buttonText ?? 'Feedback')) {
                  save({ buttonText: buttonText || 'Feedback' })
                }
              }}
              maxLength={30}
              disabled={isBusy}
              placeholder="Feedback"
            />
          </div>
          <p className="text-xs text-muted-foreground">Max 30 characters</p>
        </div>

        <SavingIndicator visible={isBusy} />
      </div>
    </SettingsCard>
  )
}

function WidgetIdentifySettings({
  config,
  secret,
}: {
  config: { identifyVerification?: boolean }
  secret: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [verificationEnabled, setVerificationEnabled] = useState(
    config.identifyVerification ?? false
  )
  const [currentSecret, setCurrentSecret] = useState(secret)
  const [secretVisible, setSecretVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  async function handleToggle(checked: boolean) {
    setVerificationEnabled(checked)
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: { identifyVerification: checked } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  async function handleCopySecret() {
    if (!currentSecret) return
    await navigator.clipboard.writeText(currentSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      const newSecret = await regenerateWidgetSecretFn()
      setCurrentSecret(newSecret)
      startTransition(() => router.invalidate())
    } finally {
      setRegenerating(false)
    }
  }

  const maskedSecret = currentSecret
    ? currentSecret.slice(0, 8) + '\u2022'.repeat(Math.max(0, currentSecret.length - 8))
    : null

  return (
    <SettingsCard
      title="User Identification"
      description="Securely identify users from your app to skip widget login"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="verify-toggle" className="text-sm font-medium cursor-pointer">
              Require HMAC Verification
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, identify calls must include an HMAC-SHA256 hash to prevent spoofing
            </p>
          </div>
          <Switch
            id="verify-toggle"
            checked={verificationEnabled}
            onCheckedChange={handleToggle}
            disabled={saving || isPending}
            aria-label="Require HMAC Verification"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Widget Secret</Label>
          <p className="text-xs text-muted-foreground">
            Use this secret server-side to generate HMAC hashes for user identification
          </p>
          {currentSecret ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs font-mono break-all">
                {secretVisible ? currentSecret : maskedSecret}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSecretVisible(!secretVisible)}
                className="shrink-0"
              >
                {secretVisible ? (
                  <EyeSlashIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleCopySecret} className="shrink-0">
                {copied ? (
                  <CheckIcon className="h-4 w-4 text-green-500" />
                ) : (
                  <ClipboardDocumentIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No secret generated yet. Click regenerate to create one.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? (
              <>
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Regenerating...
              </>
            ) : (
              'Regenerate Secret'
            )}
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Server-side Example</Label>
          <p className="text-xs text-muted-foreground">
            Generate the HMAC hash on your backend, then pass it to the widget
          </p>
          <pre className="rounded-md border border-border/50 bg-muted/30 p-4 text-xs font-mono overflow-x-auto whitespace-pre">
            {`// Node.js
const crypto = require('crypto');
const hash = crypto
  .createHmac('sha256', WIDGET_SECRET)
  .update(user.id)
  .digest('hex');

Quackback("identify", {
  id: user.id,
  email: user.email,
  name: user.name,
  hash: hash,
});`}
          </pre>
        </div>

        <SavingIndicator visible={saving || isPending} />
      </div>
    </SettingsCard>
  )
}

function WidgetEmbedCode({ baseUrl }: { baseUrl: string }) {
  const [copied, setCopied] = useState(false)

  const snippet = useMemo(
    () =>
      `<!-- Quackback Widget -->
<script>
!(function(w, d) {
  var id = "quackback-sdk";
  function load() {
    if (d.getElementById(id)) return;
    var s = d.createElement("script");
    s.id = id; s.async = true;
    s.src = "${baseUrl}/api/widget/sdk.js";
    d.getElementsByTagName("script")[0].parentNode.insertBefore(s, d.getElementsByTagName("script")[0]);
  }
  if (typeof w.Quackback !== "function") {
    w.Quackback = function() { (w.Quackback.q = w.Quackback.q || []).push(arguments); };
  }
  if (d.readyState === "complete" || d.readyState === "interactive") load();
  else d.addEventListener("DOMContentLoaded", load);
})(window, document);

Quackback("initialize_feedback_widget", {
  theme: "auto",
});
</script>`,
    [baseUrl]
  )

  async function handleCopy() {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SettingsCard
      title="Embed Code"
      description="Add this snippet to your website to show the feedback widget"
    >
      <div className="space-y-3">
        <pre className="rounded-md border border-border/50 bg-muted/30 p-4 text-xs font-mono overflow-x-auto whitespace-pre">
          {snippet}
        </pre>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5 mr-1.5 text-green-500" />
              Copied!
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="h-3.5 w-3.5 mr-1.5" />
              Copy Snippet
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Paste this snippet before the closing <code className="text-xs">&lt;/body&gt;</code> tag
          on any page where you want the widget to appear.
        </p>
      </div>
    </SettingsCard>
  )
}
