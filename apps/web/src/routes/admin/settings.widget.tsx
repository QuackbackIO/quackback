import { createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo, useEffect } from 'react'
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  BrandingLayout,
  BrandingControlsPanel,
  BrandingPreviewPanel,
} from '@/components/admin/settings/branding/branding-layout'
import { WidgetPreview } from '@/components/admin/settings/widget/widget-preview'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

function WidgetContentSettings({ config }: { config: { imageUploadsInWidget?: boolean } }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [imageUploads, setImageUploads] = useState(config.imageUploadsInWidget ?? true)
  const [, startTransition] = useTransition()

  async function handleImageUploadsToggle(checked: boolean) {
    setImageUploads(checked)
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: { imageUploadsInWidget: checked } })
      startTransition(() => router.invalidate())
    } catch {
      setImageUploads(!checked)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Content"
      description="Control what rich content types users can include in their feedback submissions."
    >
      <div className="flex items-center justify-between py-2">
        <div className="pr-4">
          <Label htmlFor="image-uploads-in-widget" className="text-sm font-medium cursor-pointer">
            Image Uploads
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Allow signed-in users to attach images when submitting feedback through the widget.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InlineSpinner visible={saving} />
          <Switch
            id="image-uploads-in-widget"
            checked={imageUploads}
            onCheckedChange={handleImageUploadsToggle}
            disabled={saving}
          />
        </div>
      </div>
    </SettingsCard>
  )
}

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

function InlineSpinner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
}

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const widgetSecretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const { baseUrl } = useRouteContext({ from: '__root__' })

  const config = widgetConfigQuery.data

  // Lift appearance state so the preview can react to changes
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    (config.position as 'bottom-right' | 'bottom-left') ?? 'bottom-right'
  )
  const [previewTabs, setPreviewTabs] = useState({
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
  })

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

      <WidgetToggle initialEnabled={config.enabled} />

      {/* Appearance + Preview: two-column layout */}
      <BrandingLayout>
        <BrandingControlsPanel>
          <WidgetAppearanceControls
            config={config}
            boards={boardsQuery.data}
            position={position}
            onPositionChange={setPosition}
            onTabsChange={setPreviewTabs}
          />
        </BrandingControlsPanel>
        <BrandingPreviewPanel label="Preview">
          <WidgetPreview position={position} tabs={previewTabs} />
        </BrandingPreviewPanel>
      </BrandingLayout>

      <WidgetContentSettings config={config} />

      <WidgetInstallation config={config} secret={widgetSecretQuery.data} baseUrl={baseUrl ?? ''} />
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
          <div className="flex items-center gap-2">
            <InlineSpinner visible={saving || isPending} />
            <Switch
              id="widget-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={saving || isPending}
              aria-label="Feedback Widget"
            />
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

function WidgetAppearanceControls({
  config,
  boards,
  position,
  onPositionChange,
  onTabsChange,
}: {
  config: {
    defaultBoard?: string
    position?: string
    tabs?: { feedback?: boolean; changelog?: boolean }
  }
  boards: { id: string; name: string; slug: string }[]
  position: 'bottom-right' | 'bottom-left'
  onPositionChange: (val: 'bottom-right' | 'bottom-left') => void
  onTabsChange: (tabs: { feedback: boolean; changelog: boolean }) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [savingField, setSavingField] = useState<string | null>(null)
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [widgetTabs, setWidgetTabs] = useState({
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
  })

  async function save(field: string, updates: Record<string, unknown>) {
    setSavingField(field)
    try {
      await updateWidgetConfigFn({ data: updates })
      startTransition(() => router.invalidate())
    } finally {
      setSavingField(null)
    }
  }

  const isBusy = savingField !== null || isPending

  return (
    <>
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Appearance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize the widget trigger button and default behavior
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="widget-position" className="text-xs text-muted-foreground">
            Button Position
          </Label>
          <Select
            value={position}
            onValueChange={(val: 'bottom-right' | 'bottom-left') => {
              onPositionChange(val)
              save('position', { position: val })
            }}
            disabled={isBusy}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom-right">Bottom Right</SelectItem>
              <SelectItem value="bottom-left">Bottom Left</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Tabs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which sections to show in the widget. The tab bar is hidden when only one is
            enabled.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label htmlFor="tab-feedback" className="text-xs font-medium cursor-pointer">
                Feedback
              </Label>
              <p className="text-[11px] text-muted-foreground">Search, vote, and submit ideas</p>
            </div>
            <div className="flex items-center gap-2">
              <InlineSpinner visible={savingField === 'tab-feedback'} />
              <Switch
                id="tab-feedback"
                checked={widgetTabs.feedback}
                onCheckedChange={(checked) => {
                  if (!checked && !widgetTabs.changelog) return
                  const next = { ...widgetTabs, feedback: checked }
                  setWidgetTabs(next)
                  onTabsChange(next)
                  save('tab-feedback', { tabs: next })
                }}
                disabled={isBusy || (widgetTabs.feedback && !widgetTabs.changelog)}
                aria-label="Feedback tab"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label htmlFor="tab-changelog" className="text-xs font-medium cursor-pointer">
                Changelog
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Show product updates and shipped features
              </p>
            </div>
            <div className="flex items-center gap-2">
              <InlineSpinner visible={savingField === 'tab-changelog'} />
              <Switch
                id="tab-changelog"
                checked={widgetTabs.changelog}
                onCheckedChange={(checked) => {
                  if (!checked && !widgetTabs.feedback) return
                  const next = { ...widgetTabs, changelog: checked }
                  setWidgetTabs(next)
                  onTabsChange(next)
                  save('tab-changelog', { tabs: next })
                }}
                disabled={isBusy || (widgetTabs.changelog && !widgetTabs.feedback)}
                aria-label="Changelog tab"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Default Board</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which board new posts from the widget are submitted to
          </p>
        </div>

        <Select
          value={defaultBoard || '__all__'}
          onValueChange={(val) => {
            const resolved = val === '__all__' ? '' : val
            setDefaultBoard(resolved)
            save('defaultBoard', { defaultBoard: resolved || undefined })
          }}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All Boards" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Boards</SelectItem>
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.slug}>
                {board.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

// ==============================================
// Installation Guide — Interactive Code Panel
// ==============================================

const SERVER_EXAMPLES: {
  id: string
  label: string
  filename: string
  lang: SyntaxLang
  code: string
}[] = [
  {
    id: 'nextjs',
    label: 'Next.js',
    filename: 'route.ts',
    lang: 'js',
    code: `import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function signWidgetToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.QUACKBACK_WIDGET_SECRET!)
    .update(\`\${header}.\${body}\`)
    .digest("base64url");
  return \`\${header}.\${body}.\${signature}\`;
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({}, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const ssoToken = signWidgetToken({
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    // Custom attributes (must be configured in Settings > User Attributes)
    // plan: session.user.plan,
    // mrr: session.user.mrr,
    exp: now + 300,
  });

  return NextResponse.json({ ssoToken });
}`,
  },
  {
    id: 'express',
    label: 'Express',
    filename: 'widget.js',
    lang: 'js',
    code: `import crypto from "crypto";

function signWidgetToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.QUACKBACK_WIDGET_SECRET)
    .update(\`\${header}.\${body}\`)
    .digest("base64url");
  return \`\${header}.\${body}.\${signature}\`;
}

app.post("/api/widget-sso", (req, res) => {
  // req.user set by your auth middleware
  const now = Math.floor(Date.now() / 1000);
  const ssoToken = signWidgetToken({
    sub: req.user.id,
    email: req.user.email,
    name: req.user.name,
    // Custom attributes (must be configured in Settings > User Attributes)
    // plan: req.user.plan,
    exp: now + 300,
  });

  res.json({ ssoToken });
});`,
  },
  {
    id: 'django',
    label: 'Django',
    filename: 'views.py',
    lang: 'python',
    code: `import base64, hashlib, hmac, json, time
from django.conf import settings
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def sign_widget_token(payload):
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64url(json.dumps(payload).encode())
    sig = hmac.new(
        settings.QUACKBACK_WIDGET_SECRET.encode(),
        f"{header}.{body}".encode(),
        hashlib.sha256,
    ).digest()
    return f"{header}.{body}.{b64url(sig)}"

@login_required
def widget_sso(request):
    now = int(time.time())
    token = sign_widget_token({
        "sub": str(request.user.id),
        "email": request.user.email,
        "name": request.user.get_full_name() or request.user.username,
        # Custom attributes (must be configured in Settings > User Attributes)
        # "plan": request.user.plan,
        "exp": now + 300,
    })
    return JsonResponse({"ssoToken": token})`,
  },
  {
    id: 'rails',
    label: 'Rails',
    filename: 'widget_controller.rb',
    lang: 'ruby',
    code: `require "base64"
require "json"
require "openssl"

class Api::WidgetController < ApplicationController
  before_action :authenticate_user!

  def identify_sso
    now = Time.now.to_i
    payload = {
      sub: current_user.id.to_s,
      email: current_user.email,
      name: current_user.name,
      exp: now + 300,
    }

    render json: { ssoToken: sign_widget_token(payload) }
  end

  private

  def sign_widget_token(payload)
    header = Base64.urlsafe_encode64({ alg: "HS256", typ: "JWT" }.to_json, padding: false)
    body = Base64.urlsafe_encode64(payload.to_json, padding: false)
    sig = OpenSSL::HMAC.digest("sha256", ENV["QUACKBACK_WIDGET_SECRET"], "#{header}.#{body}")
    "#{header}.#{body}.#{Base64.urlsafe_encode64(sig, padding: false)}"
  end
end`,
  },
  {
    id: 'laravel',
    label: 'Laravel',
    filename: 'WidgetController.php',
    lang: 'php',
    code: `use Illuminate\\Http\\Request;

class WidgetController extends Controller
{
    public function identifySso(Request $request)
    {
        $now = time();
        $payload = [
            "sub" => (string) $request->user()->id,
            "email" => $request->user()->email,
            "name" => $request->user()->name,
            "exp" => $now + 300,
        ];

        return response()->json(["ssoToken" => $this->signWidgetToken($payload)]);
    }

    private function signWidgetToken(array $payload): string
    {
        $header = rtrim(strtr(base64_encode(json_encode(["alg" => "HS256", "typ" => "JWT"])), "+/", "-_"), "=");
        $body = rtrim(strtr(base64_encode(json_encode($payload)), "+/", "-_"), "=");
        $signature = hash_hmac(
            "sha256",
            $header . "." . $body,
            config("services.quackback.widget_secret"),
            true,
        );

        return $header . "." . $body . "." . rtrim(strtr(base64_encode($signature), "+/", "-_"), "=");
    }
}`,
  },
]

const CLIENT_CODE = `import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export function WidgetIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetch("/api/widget-sso", { method: "POST" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch widget token");
          return res.json();
        })
        .then(({ ssoToken }) => {
          Quackback("identify", { ssoToken });
        })
        .catch(() => {
          Quackback("identify", null);
        });
    } else {
      Quackback("identify", { anonymous: true });
    }
  }, [user]);

  return null;
}`

interface CodeTab {
  id: string
  label: string
  lang: SyntaxLang
  code: string
}

function WidgetInstallation({
  config,
  secret,
  baseUrl,
}: {
  config: { identifyVerification?: boolean }
  secret: string | null
  baseUrl: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  // Guide UI state
  const [framework, setFramework] = useState('nextjs')
  const [activeTab, setActiveTab] = useState('snippet')

  // Persisted state
  const [hmacEnabled, setHmacEnabled] = useState(config.identifyVerification ?? false)
  const [currentSecret, setCurrentSecret] = useState(secret)
  const [secretVisible, setSecretVisible] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const installSnippet = useMemo(
    () =>
      `<script>
  (function(w,d){if(w.Quackback)return;w.Quackback=function(){
  (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.src="${baseUrl}/api/widget/sdk.js";
  d.head.appendChild(s)})(window,document);

  Quackback("init");
</script>`,
    [baseUrl]
  )

  // Build dynamic tabs based on options
  const tabs = useMemo<CodeTab[]>(() => {
    const t: CodeTab[] = [
      { id: 'snippet', label: 'snippet.html', lang: 'js', code: installSnippet },
    ]
    const ex = SERVER_EXAMPLES.find((e) => e.id === framework)
    if (ex) {
      t.push({ id: 'server', label: ex.filename, lang: ex.lang, code: ex.code })
    }
    t.push({
      id: 'client',
      label: 'identify.tsx',
      lang: 'js',
      code: CLIENT_CODE,
    })
    return t
  }, [installSnippet, framework])

  // Reset active tab if it's no longer available
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab('snippet')
    }
  }, [tabs, activeTab])

  const activeTabData = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  async function handleHmacToggle(checked: boolean) {
    setHmacEnabled(checked)
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
    setCopiedSecret(true)
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  async function handleCopyCode() {
    await navigator.clipboard.writeText(activeTabData.code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
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

  const isBusy = saving || isPending

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[480px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] flex-1">
        {/* ─── Left: Configuration ─── */}
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border divide-y divide-border">
          {/* Header */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Installation</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure and add the widget to your site
            </p>
          </div>

          {/* Step 1 */}
          <div className="p-5 space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">Add the script</span>
            </div>
            <p className="text-[11px] text-muted-foreground ml-7">
              Paste before the closing <code className="text-[11px]">&lt;/body&gt;</code> tag
            </p>
          </div>

          {/* Step 2 */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                2
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Identify users</span>
                <p className="text-[11px] text-muted-foreground">
                  Generate a signed <code className="text-[11px]">ssoToken</code> on your backend
                </p>
              </div>
            </div>

            <div className="ml-7 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-foreground">
                    Verified identity only
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Disable inline email capture and require your app to sign each user
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InlineSpinner visible={isBusy} />
                  <Switch
                    checked={hmacEnabled}
                    onCheckedChange={handleHmacToggle}
                    disabled={isBusy}
                    aria-label="Require verified widget identity"
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                {/* Framework */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Backend framework</Label>
                  <Select value={framework} onValueChange={setFramework}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVER_EXAMPLES.map((ex) => (
                        <SelectItem key={ex.id} value={ex.id}>
                          {ex.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Secret */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Widget secret</Label>
                  {currentSecret ? (
                    <div className="flex items-center gap-1">
                      <code className="flex-1 text-[10px] font-mono text-foreground bg-muted/30 border border-border/50 rounded px-2 py-1 truncate">
                        {secretVisible ? currentSecret : maskedSecret}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => setSecretVisible(!secretVisible)}
                      >
                        {secretVisible ? (
                          <EyeSlashIcon className="h-3 w-3" />
                        ) : (
                          <EyeIcon className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={handleCopySecret}
                      >
                        {copiedSecret ? (
                          <CheckIcon className="h-3 w-3 text-green-500" />
                        ) : (
                          <ClipboardDocumentIcon className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground italic">
                      Click regenerate to create a secret
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                  >
                    {regenerating ? (
                      <>
                        <ArrowPathIcon className="h-3 w-3 animate-spin mr-1" />
                        Regenerating...
                      </>
                    ) : (
                      'Regenerate'
                    )}
                  </Button>
                </div>

                {/* Security note */}
                <p className="flex items-start gap-1.5 text-[10px] text-yellow-600 dark:text-yellow-500">
                  <ExclamationTriangleIcon className="h-3 w-3 shrink-0 mt-px" />
                  Keep this secret server-side only
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right: Dynamic Code Panel ─── */}
        <div className="flex flex-col">
          {/* File tabs */}
          <div
            className="flex items-center justify-between shrink-0 px-1"
            style={{ backgroundColor: '#252526' }}
          >
            <div className="flex items-center">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-3 py-2 text-[11px] font-mono transition-colors border-b-2',
                    activeTab === tab.id
                      ? 'text-white/90 border-primary'
                      : 'text-white/40 border-transparent hover:text-white/60'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex items-center gap-1 px-2.5 py-1.5 mr-1 rounded text-[11px] text-white/40 hover:text-white/70 transition-colors"
            >
              {copiedCode ? (
                <>
                  <CheckIcon className="h-3 w-3 text-green-400" />
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <ClipboardDocumentIcon className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Code display */}
          <div className="flex-1 overflow-auto">
            <HighlightedCode code={activeTabData.code} lang={activeTabData.lang} />
          </div>
        </div>
      </div>
    </div>
  )
}
