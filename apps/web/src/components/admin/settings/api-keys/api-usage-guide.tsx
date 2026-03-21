import { useState, useMemo } from 'react'
import {
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import {
  BashIcon,
  JavaScriptIcon,
  PythonIcon,
  GoIcon,
  PHPIcon,
} from '@/components/admin/settings/lang-icons'
import { cn } from '@/lib/shared/utils'

// ——————————————————————————————————————————————————
// Language definitions
// ——————————————————————————————————————————————————

interface LangDef {
  id: string
  label: string
  filename: string
  lang: SyntaxLang
  code: (url: string) => string
}

const LANGUAGES: LangDef[] = [
  {
    id: 'curl',
    label: 'curl',
    filename: 'terminal',
    lang: 'bash',
    code: (url) => `# List all posts
curl ${url}/posts \\
  -H "Authorization: Bearer qb_YOUR_API_KEY"

# Create a post
curl -X POST ${url}/posts \\
  -H "Authorization: Bearer qb_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Dark mode support",
    "content": "Please add a dark mode option",
    "boardId": "board_xxx"
  }'`,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    filename: 'example.js',
    lang: 'js',
    code: (url) => `// List all posts
const response = await fetch("${url}/posts", {
  headers: {
    Authorization: "Bearer qb_YOUR_API_KEY",
  },
});
const { data: posts } = await response.json();

// Create a post
const newPost = await fetch("${url}/posts", {
  method: "POST",
  headers: {
    Authorization: "Bearer qb_YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Dark mode support",
    content: "Please add a dark mode option",
    boardId: "board_xxx",
  }),
});`,
  },
  {
    id: 'python',
    label: 'Python',
    filename: 'example.py',
    lang: 'python',
    code: (url) => `import requests

headers = {"Authorization": "Bearer qb_YOUR_API_KEY"}

# List all posts
response = requests.get(
    "${url}/posts",
    headers=headers,
)
posts = response.json()["data"]

# Create a post
response = requests.post(
    "${url}/posts",
    headers=headers,
    json={
        "title": "Dark mode support",
        "content": "Please add a dark mode option",
        "boardId": "board_xxx",
    },
)`,
  },
  {
    id: 'go',
    label: 'Go',
    filename: 'main.go',
    lang: 'go',
    code: (url) => `package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    req, _ := http.NewRequest("GET", "${url}/posts", nil)
    req.Header.Set("Authorization", "Bearer qb_YOUR_API_KEY")

    resp, _ := http.DefaultClient.Do(req)
    defer resp.Body.Close()

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    fmt.Println(result["data"])
}`,
  },
  {
    id: 'php',
    label: 'PHP',
    filename: 'example.php',
    lang: 'php',
    code: (url) => `<?php
$ch = curl_init("${url}/posts");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer qb_YOUR_API_KEY",
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = json_decode(curl_exec($ch));
curl_close($ch);

$posts = $response->data;`,
  },
]

const LANG_ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  curl: BashIcon,
  javascript: JavaScriptIcon,
  python: PythonIcon,
  go: GoIcon,
  php: PHPIcon,
}

const API_RESOURCES = [
  'posts',
  'boards',
  'comments',
  'statuses',
  'tags',
  'webhooks',
  'changelogs',
  'users',
] as const

// ——————————————————————————————————————————————————
// Component
// ——————————————————————————————————————————————————

interface ApiUsageGuideProps {
  apiBaseUrl: string
}

export function ApiUsageGuide({ apiBaseUrl }: ApiUsageGuideProps) {
  const [selectedLang, setSelectedLang] = useState('curl')
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const lang = LANGUAGES.find((l) => l.id === selectedLang) ?? LANGUAGES[0]

  const codeOutput = useMemo(() => lang.code(apiBaseUrl), [lang, apiBaseUrl])

  async function handleCopyCode() {
    await navigator.clipboard.writeText(codeOutput)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(apiBaseUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[420px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] flex-1">
        {/* ─── Left: Configuration ─── */}
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border divide-y divide-border">
          {/* Header */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Quick Start</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Make your first API request</p>
          </div>

          {/* Step 1: Base URL */}
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">Base URL</span>
            </div>
            <div className="ml-7">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="group flex items-center gap-1.5 w-full text-left"
              >
                <code className="flex-1 text-[10px] font-mono text-foreground bg-muted/30 border border-border/50 rounded px-2 py-1.5 truncate">
                  {apiBaseUrl}
                </code>
                <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
                  {copiedUrl ? (
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
              Add your API key as a Bearer token in the{' '}
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded font-mono">
                Authorization
              </code>{' '}
              header. Create a key above if you don't have one.
            </p>
          </div>

          {/* Step 3: Language */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                3
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Choose your language</span>
                <p className="text-[11px] text-muted-foreground">Try the example request</p>
              </div>
            </div>

            <div className="ml-7">
              <div className="flex flex-wrap gap-1">
                {LANGUAGES.map((l) => {
                  const Icon = LANG_ICONS[l.id]
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setSelectedLang(l.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                        selectedLang === l.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {Icon && <Icon className="h-3 w-3" />}
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Resources summary */}
          <div className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {API_RESOURCES.length} resources
              </span>
              <a
                href="/api/v1/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                API Reference
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            </div>
            <div className="flex flex-wrap gap-1">
              {API_RESOURCES.map((resource) => (
                <span
                  key={resource}
                  className="text-[10px] font-mono bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded"
                >
                  {resource}
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
                {lang.filename}
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
            <HighlightedCode code={codeOutput} lang={lang.lang} />
          </div>
        </div>
      </div>
    </div>
  )
}
