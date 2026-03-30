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
        <BackLink to="/admin/settings">Configurações</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Widget de feedback"
        description="Incorpore um widget de feedback diretamente no seu produto para coletar feedback dos usuários"
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
        <BrandingPreviewPanel label="Pré-visualização">
          <WidgetPreview position={position} tabs={previewTabs} />
        </BrandingPreviewPanel>
      </BrandingLayout>

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
    <SettingsCard title="Widget" description="Ative ou desative o widget de feedback incorporável">
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="widget-toggle" className="text-sm font-medium cursor-pointer">
              Ativar widget de feedback
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quando ativado, você pode incorporar um widget de feedback em qualquer site usando uma
              tag de script
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={saving || isPending} />
            <Switch
              id="widget-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={saving || isPending}
              aria-label="Widget de feedback"
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
  const [saving, setSaving] = useState(false)
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [widgetTabs, setWidgetTabs] = useState({
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
  })

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
    <>
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Aparência</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Personalize o botão do widget e o comportamento padrão
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="widget-position" className="text-xs text-muted-foreground">
            Posição do botão
          </Label>
          <Select
            value={position}
            onValueChange={(val: 'bottom-right' | 'bottom-left') => {
              onPositionChange(val)
              save({ position: val })
            }}
            disabled={isBusy}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom-right">Inferior direita</SelectItem>
              <SelectItem value="bottom-left">Inferior esquerda</SelectItem>
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
            <Switch
              id="tab-feedback"
              checked={widgetTabs.feedback}
              onCheckedChange={(checked) => {
                if (!checked && !widgetTabs.changelog) return
                const next = { ...widgetTabs, feedback: checked }
                setWidgetTabs(next)
                onTabsChange(next)
                save({ tabs: next })
              }}
              disabled={isBusy || (widgetTabs.feedback && !widgetTabs.changelog)}
              aria-label="Feedback tab"
            />
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
            <Switch
              id="tab-changelog"
              checked={widgetTabs.changelog}
              onCheckedChange={(checked) => {
                if (!checked && !widgetTabs.feedback) return
                const next = { ...widgetTabs, changelog: checked }
                setWidgetTabs(next)
                onTabsChange(next)
                save({ tabs: next })
              }}
              disabled={isBusy || (widgetTabs.changelog && !widgetTabs.feedback)}
              aria-label="Changelog tab"
            />
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Default Board</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Para qual board os novos posts enviados pelo widget irão
          </p>
        </div>

        <Select
          value={defaultBoard || '__all__'}
          onValueChange={(val) => {
            const resolved = val === '__all__' ? '' : val
            setDefaultBoard(resolved)
            save({ defaultBoard: resolved || undefined })
          }}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Todos os boards" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os boards</SelectItem>
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

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({}, { status: 401 });
  }

  const hash = crypto
    .createHmac("sha256", process.env.FEATUREPOOL_WIDGET_SECRET!)
    .update(session.user.id)
    .digest("hex");

  return NextResponse.json({ hash });
}`,
  },
  {
    id: 'express',
    label: 'Express',
    filename: 'widget.js',
    lang: 'js',
    code: `import crypto from "crypto";

app.post("/api/widget-hash", (req, res) => {
  // req.user set by your auth middleware
  const hash = crypto
    .createHmac("sha256", process.env.FEATUREPOOL_WIDGET_SECRET)
    .update(req.user.id)
    .digest("hex");

  res.json({ hash });
});`,
  },
  {
    id: 'django',
    label: 'Django',
    filename: 'views.py',
    lang: 'python',
    code: `import hmac, hashlib
from django.conf import settings
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required

@login_required
def widget_hash(request):
    digest = hmac.new(
        settings.FEATUREPOOL_WIDGET_SECRET.encode(),
        str(request.user.id).encode(),
        hashlib.sha256,
    ).hexdigest()
    return JsonResponse({"hash": digest})`,
  },
  {
    id: 'rails',
    label: 'Rails',
    filename: 'widget_controller.rb',
    lang: 'ruby',
    code: `class Api::WidgetController < ApplicationController
  before_action :authenticate_user!

  def identify_hash
    digest = OpenSSL::HMAC.hexdigest(
      "sha256",
      ENV["FEATUREPOOL_WIDGET_SECRET"],
      current_user.id.to_s,
    )
    render json: { hash: digest }
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
    public function identifyHash(Request $request)
    {
        $hash = hash_hmac(
            "sha256",
            $request->user()->id,
            config("services.featurepool.widget_secret"),
        );
        return response()->json(["hash" => $hash]);
    }
}`,
  },
]

const CLIENT_CODE_SIMPLE = `import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export function WidgetIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      Featurepool("identify", {
        id: user.id,
        email: user.email,
        name: user.name,
      });
    } else {
      Featurepool("identify", { anonymous: true });
    }
  }, [user]);

  return null;
}`

const CLIENT_CODE_WITH_HMAC = `import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export function WidgetIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetch("/api/widget-hash", { method: "POST" })
        .then((res) => res.json())
        .then(({ hash }) => {
          Featurepool("identify", {
            id: user.id,
            email: user.email,
            name: user.name,
            hash,
          });
        });
    } else {
      Featurepool("identify", { anonymous: true });
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
  (function(w,d){if(w.Featurepool)return;w.Featurepool=function(){
  (w.Featurepool.q=w.Featurepool.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.src="${baseUrl}/api/widget/sdk.js";
  d.head.appendChild(s)})(window,document);

  Featurepool("init");
</script>`,
    [baseUrl]
  )

  // Build dynamic tabs based on options
  const tabs = useMemo<CodeTab[]>(() => {
    const t: CodeTab[] = [
      { id: 'snippet', label: 'snippet.html', lang: 'js', code: installSnippet },
    ]
    if (hmacEnabled) {
      const ex = SERVER_EXAMPLES.find((e) => e.id === framework)
      if (ex) {
        t.push({ id: 'server', label: ex.filename, lang: ex.lang, code: ex.code })
      }
    }
    t.push({
      id: 'client',
      label: 'identify.tsx',
      lang: 'js',
      code: hmacEnabled ? CLIENT_CODE_WITH_HMAC : CLIENT_CODE_SIMPLE,
    })
    return t
  }, [installSnippet, hmacEnabled, framework])

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
            <h3 className="text-sm font-semibold text-foreground">Instalação</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure e adicione o widget ao seu site
            </p>
          </div>

          {/* Step 1 */}
          <div className="p-5 space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">Adicionar o script</span>
            </div>
            <p className="text-[11px] text-muted-foreground ml-7">
              Cole antes da tag de fechamento <code className="text-[11px]">&lt;/body&gt;</code>
            </p>
          </div>

          {/* Step 2 */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                2
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Identificar usuários</span>
                <p className="text-[11px] text-muted-foreground">Necessário para exibir o widget</p>
              </div>
            </div>

            <div className="ml-7 space-y-3">
              {/* HMAC toggle */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-foreground">Verificação HMAC</span>
                  <p className="text-[11px] text-muted-foreground">
                    Evita falsificação de identidade
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InlineSpinner visible={isBusy} />
                  <Switch
                    checked={hmacEnabled}
                    onCheckedChange={handleHmacToggle}
                    disabled={isBusy}
                    aria-label="Exigir verificação HMAC"
                  />
                </div>
              </div>

              {hmacEnabled && (
                <div className="space-y-2.5">
                  {/* Framework */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Framework de backend
                    </Label>
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
                    <Label className="text-[11px] text-muted-foreground">Segredo do widget</Label>
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
                        Clique em regenerar para criar um segredo
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
                          Regenerando...
                        </>
                      ) : (
                        'Regenerar'
                      )}
                    </Button>
                  </div>

                  {/* Security note */}
                  <p className="flex items-start gap-1.5 text-[10px] text-yellow-600 dark:text-yellow-500">
                    <ExclamationTriangleIcon className="h-3 w-3 shrink-0 mt-px" />
                    Mantenha este segredo apenas no servidor
                  </p>
                </div>
              )}
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
                  <span className="text-green-400">Copiado</span>
                </>
              ) : (
                <>
                  <ClipboardDocumentIcon className="h-3 w-3" />
                  <span>Copiar</span>
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
