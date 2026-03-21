import { useState, useMemo, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import { cn } from '@/lib/shared/utils'

// ——————————————————————————————————————————————————
// Client icons (Simple Icons, 24x24 viewBox)
// ——————————————————————————————————————————————————

interface IconProps {
  className?: string
}

function ClaudeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="m4.714 15.956 4.717-2.648.08-.23-.08-.128h-.23l-.79-.049-2.695-.073-2.338-.097-2.264-.121-.571-.122-.534-.704.054-.352.48-.322.686.061 1.518.103 2.277.158 1.651.097 2.447.255h.389l.054-.158-.133-.097-.104-.097-2.374-1.603-2.55-1.688-1.336-.971-.722-.492-.365-.461-.157-1.008.655-.722.88.06.225.061.893.686 1.906 1.475 2.49 1.834.364.303.146-.103.018-.073-.164-.273-1.354-2.447-1.445-2.49-.643-1.031-.17-.62c-.061-.254-.104-.467-.104-.728L6.287.133 6.7 0l.996.134.419.364.619 1.415 1.002 2.228 1.554 3.03.455.898.243.832.091.255h.158v-.146l.128-1.706.236-2.095.231-2.695.079-.76.376-.91.747-.492.583.28.48.685-.067.444-.286 1.852-.558 2.902-.365 1.943h.213l.243-.243.983-1.305 1.652-2.065.728-.819.85-.905.547-.431h1.032l.76 1.13-.34 1.165-1.063 1.348-.88 1.141-1.263 1.7-.79 1.36.073.11.189-.019 2.853-.607 1.542-.279 1.84-.316.832.389.09.394-.327.808-1.967.486-2.308.461-3.436.814-.043.03.049.061 1.548.146.662.036h1.621l3.018.225.789.522.474.637-.08.486-1.214.619-1.64-.389-3.824-.91-1.312-.328h-.182v.109l1.093 1.07 2.003 1.809 2.508 2.331.127.577-.322.455-.34-.048-2.204-1.658-.85-.746-1.925-1.621h-.127v.17l.443.65 2.344 3.521.121 1.08-.17.353-.607.212-.668-.121-1.372-1.925-1.53-2.204-1.141-1.943-.14.08-.674 7.255-.316.37-.728.28-.607-.462-.322-.747.322-1.475.389-1.925.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.433 1.967-2.18 2.945-1.724 1.846-.413.164-.716-.37.067-.662.4-.589 2.386-3.036 1.44-1.882.928-1.087-.006-.158h-.055l-6.338 4.117-1.13.145-.485-.455.06-.747.231-.243 1.906-1.311Z" />
    </svg>
  )
}

function CursorIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  )
}

function VSCodeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

function WindsurfIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.55 5.067c-1.204-.002-2.18.973-2.18 2.177v4.867c0 .972-.804 1.76-1.76 1.76-.568 0-1.135-.286-1.472-.766l-4.971-7.1c-.413-.59-1.084-.941-1.81-.941-1.134 0-2.154.963-2.154 2.153v4.896c0 .972-.797 1.759-1.76 1.759-.57 0-1.136-.286-1.472-.766L.408 5.16C.282 4.98 0 5.069 0 5.288v4.245c0 .215.066.423.188.6l5.475 7.818c.323.462.8.805 1.351.93 1.377.313 2.645-.747 2.645-2.098v-4.893c0-.972.787-1.76 1.76-1.76h.002c.57 0 1.136.287 1.472.766l4.972 7.1c.414.59 1.05.94 1.81.94 1.158 0 2.151-.964 2.151-2.153v-4.895c0-.972.788-1.76 1.76-1.76h.194a.22.22 0 0 0 .22-.22V5.287a.22.22 0 0 0-.22-.22Z" />
    </svg>
  )
}

const CLIENT_ICONS: Record<string, (props: IconProps) => React.ReactElement> = {
  'claude-code': ClaudeIcon,
  cursor: CursorIcon,
  vscode: VSCodeIcon,
  windsurf: WindsurfIcon,
  'claude-desktop': ClaudeIcon,
}

interface McpSetupGuideProps {
  endpointUrl: string
}

// ——————————————————————————————————————————————————
// Config generators
// ——————————————————————————————————————————————————

function claudeCodeOAuthConfig(url: string) {
  return JSON.stringify({ mcpServers: { quackback: { type: 'http', url } } }, null, 2)
}

function claudeCodeApiKeyConfig(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          type: 'http',
          url,
          headers: { Authorization: 'Bearer ${QUACKBACK_API_KEY}' },
        },
      },
    },
    null,
    2
  )
}

function cursorConfig(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          url,
          headers: { Authorization: 'Bearer ${env:QUACKBACK_API_KEY}' },
        },
      },
    },
    null,
    2
  )
}

function vscodeConfig(url: string) {
  return JSON.stringify(
    {
      inputs: [
        {
          type: 'promptString',
          id: 'quackback-api-key',
          description: 'Quackback API Key (qb_...)',
          password: true,
        },
      ],
      servers: {
        quackback: {
          type: 'http',
          url,
          headers: { Authorization: 'Bearer ${input:quackback-api-key}' },
        },
      },
    },
    null,
    2
  )
}

function windsurfConfig(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          serverUrl: url,
          headers: { Authorization: 'Bearer ${env:QUACKBACK_API_KEY}' },
        },
      },
    },
    null,
    2
  )
}

function claudeDesktopOAuthConfig(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: { command: 'npx', args: ['mcp-remote@latest', '--http', url] },
      },
    },
    null,
    2
  )
}

function claudeDesktopApiKeyConfig(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          command: 'npx',
          args: [
            'mcp-remote@latest',
            '--http',
            url,
            '--header',
            'Authorization: Bearer qb_YOUR_API_KEY',
          ],
        },
      },
    },
    null,
    2
  )
}

// ——————————————————————————————————————————————————
// Client definitions
// ——————————————————————————————————————————————————

interface ClientDef {
  id: string
  label: string
  filename: string
  lang: SyntaxLang
  note: string
  variants?: { id: string; label: string; code: (url: string) => string }[]
  code?: (url: string) => string
}

const CLIENTS: ClientDef[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    filename: '.mcp.json',
    lang: 'js',
    note: 'Add to your project root.',
    variants: [
      { id: 'oauth', label: 'OAuth (recommended)', code: claudeCodeOAuthConfig },
      { id: 'api-key', label: 'API Key', code: claudeCodeApiKeyConfig },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    filename: '.cursor/mcp.json',
    lang: 'js',
    note: 'Set QUACKBACK_API_KEY in your environment. OAuth is not supported.',
    code: cursorConfig,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    filename: '.vscode/mcp.json',
    lang: 'js',
    note: 'VS Code prompts for the API key on first use. Uses "servers" not "mcpServers". OAuth is not supported.',
    code: vscodeConfig,
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    filename: '~/.codeium/windsurf/mcp_config.json',
    lang: 'js',
    note: 'Set QUACKBACK_API_KEY in your environment. Uses "serverUrl" not "url". OAuth is not supported.',
    code: windsurfConfig,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    filename: 'claude_desktop_config.json',
    lang: 'js',
    note: 'Requires mcp-remote bridge (Node.js must be installed).',
    variants: [
      { id: 'oauth', label: 'OAuth (recommended)', code: claudeDesktopOAuthConfig },
      { id: 'api-key', label: 'API Key', code: claudeDesktopApiKeyConfig },
    ],
  },
]

const MCP_TOOLS = [
  'search',
  'get_details',
  'triage_post',
  'vote_post',
  'proxy_vote',
  'add_comment',
  'update_comment',
  'delete_comment',
  'react_to_comment',
  'create_post',
  'delete_post',
  'restore_post',
  'merge_post',
  'unmerge_post',
  'manage_roadmap_post',
  'create_changelog',
  'update_changelog',
  'delete_changelog',
  'list_suggestions',
  'accept_suggestion',
  'dismiss_suggestion',
  'restore_suggestion',
  'get_post_activity',
] as const

// ——————————————————————————————————————————————————
// Component
// ——————————————————————————————————————————————————

export function McpSetupGuide({ endpointUrl }: McpSetupGuideProps) {
  const [selectedClient, setSelectedClient] = useState('claude-code')
  const [selectedVariant, setSelectedVariant] = useState('oauth')
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)

  const client = CLIENTS.find((c) => c.id === selectedClient) ?? CLIENTS[0]

  // Build the code output
  const codeOutput = useMemo(() => {
    if (client.variants) {
      const variant = client.variants.find((v) => v.id === selectedVariant) ?? client.variants[0]
      return variant.code(endpointUrl)
    }
    return client.code!(endpointUrl)
  }, [client, selectedVariant, endpointUrl])

  // Reset variant when switching to a client without variants
  useEffect(() => {
    if (client.variants) {
      const hasVariant = client.variants.some((v) => v.id === selectedVariant)
      if (!hasVariant) setSelectedVariant(client.variants[0].id)
    }
  }, [client, selectedVariant])

  async function handleCopyCode() {
    await navigator.clipboard.writeText(codeOutput)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  async function handleCopyEndpoint() {
    await navigator.clipboard.writeText(endpointUrl)
    setCopiedEndpoint(true)
    setTimeout(() => setCopiedEndpoint(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[480px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] flex-1">
        {/* ─── Left: Configuration ─── */}
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border divide-y divide-border">
          {/* Header */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Setup Guide</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect an AI tool to your MCP server
            </p>
          </div>

          {/* Step 1: Endpoint */}
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">Endpoint</span>
            </div>
            <div className="ml-7">
              <button
                type="button"
                onClick={handleCopyEndpoint}
                className="group flex items-center gap-1.5 w-full text-left"
              >
                <code className="flex-1 text-[10px] font-mono text-foreground bg-muted/30 border border-border/50 rounded px-2 py-1.5 truncate">
                  {endpointUrl}
                </code>
                <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
                  {copiedEndpoint ? (
                    <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Step 2: Auth */}
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                2
              </span>
              <span className="text-xs font-medium text-foreground">Authentication</span>
            </div>
            <p className="text-[11px] text-muted-foreground ml-7">
              Use an{' '}
              <Link to="/admin/settings/api-keys" className="text-primary hover:underline">
                API key
              </Link>{' '}
              or OAuth (browser login). Claude Code and Claude Desktop support both.
            </p>
          </div>

          {/* Step 3: Client */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                3
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Choose your client</span>
                <p className="text-[11px] text-muted-foreground">Add the config to your project</p>
              </div>
            </div>

            <div className="ml-7 space-y-3">
              {/* Client selector */}
              <div className="flex flex-wrap gap-1">
                {CLIENTS.map((c) => {
                  const Icon = CLIENT_ICONS[c.id]
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedClient(c.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                        selectedClient === c.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {Icon && <Icon className="h-3 w-3" />}
                      {c.label}
                    </button>
                  )
                })}
              </div>

              {/* Variant selector (OAuth / API Key) */}
              {client.variants && (
                <div className="flex gap-1">
                  {client.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariant(v.id)}
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                        selectedVariant === v.id
                          ? 'bg-foreground/10 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Client note */}
              <p className="text-[11px] text-muted-foreground">{client.note}</p>
            </div>
          </div>

          {/* Tools summary */}
          <div className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {MCP_TOOLS.length} tools available
              </span>
              <a
                href="https://www.quackback.io/docs/mcp/reference"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                Reference
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            </div>
            <div className="flex flex-wrap gap-1">
              {MCP_TOOLS.map((tool) => (
                <span
                  key={tool}
                  className="text-[10px] font-mono bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Right: Code Panel ─── */}
        <div className="flex flex-col">
          {/* File tab header */}
          <div
            className="flex items-center justify-between shrink-0 px-1"
            style={{ backgroundColor: '#252526' }}
          >
            <div className="flex items-center">
              <span className="px-3 py-2 text-[11px] font-mono text-white/90 border-b-2 border-primary">
                {client.filename}
              </span>
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

          {/* Syntax-highlighted code */}
          <div className="flex-1 overflow-auto">
            <HighlightedCode code={codeOutput} lang="js" />
          </div>
        </div>
      </div>
    </div>
  )
}
