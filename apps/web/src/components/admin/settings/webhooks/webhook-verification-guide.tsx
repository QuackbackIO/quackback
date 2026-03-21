import { useState, useMemo } from 'react'
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import {
  NodeJsIcon,
  PythonIcon,
  RubyIcon,
  GoIcon,
  PHPIcon,
} from '@/components/admin/settings/lang-icons'
import { cn } from '@/lib/shared/utils'

// ——————————————————————————————————————————————————
// Framework definitions
// ——————————————————————————————————————————————————

interface FrameworkDef {
  id: string
  label: string
  filename: string
  lang: SyntaxLang
  code: string
}

const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'node',
    label: 'Node.js',
    filename: 'verify.js',
    lang: 'js',
    code: `import crypto from "node:crypto";

function verifyWebhook(req, secret) {
  const signature = req.headers["x-quackback-signature"];
  const timestamp = req.headers["x-quackback-timestamp"];
  const body = req.rawBody;

  // Reject if older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (Math.abs(age) > 300) throw new Error("Timestamp too old");

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${body}\`)
    .digest("hex");

  const actual = signature.replace("sha256=", "");
  if (!crypto.timingSafeEqual(
    Buffer.from(expected), Buffer.from(actual)
  )) {
    throw new Error("Invalid signature");
  }

  return JSON.parse(body);
}`,
  },
  {
    id: 'python',
    label: 'Python',
    filename: 'verify.py',
    lang: 'python',
    code: `import hmac
import hashlib
import time
import json

def verify_webhook(request, secret):
    signature = request.headers["X-Quackback-Signature"]
    timestamp = request.headers["X-Quackback-Timestamp"]
    body = request.body.decode("utf-8")

    # Reject if older than 5 minutes
    age = abs(int(time.time()) - int(timestamp))
    if age > 300:
        raise ValueError("Timestamp too old")

    # Verify HMAC-SHA256 signature
    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    actual = signature.replace("sha256=", "")

    if not hmac.compare_digest(expected, actual):
        raise ValueError("Invalid signature")

    return json.loads(body)`,
  },
  {
    id: 'ruby',
    label: 'Ruby',
    filename: 'verify.rb',
    lang: 'ruby',
    code: `require "openssl"
require "json"

def verify_webhook(request, secret)
  signature = request.env["HTTP_X_QUACKBACK_SIGNATURE"]
  timestamp = request.env["HTTP_X_QUACKBACK_TIMESTAMP"]
  body = request.body.read

  # Reject if older than 5 minutes
  age = (Time.now.to_i - timestamp.to_i).abs
  raise "Timestamp too old" if age > 300

  # Verify HMAC-SHA256 signature
  expected = OpenSSL::HMAC.hexdigest(
    "SHA256", secret, "#{timestamp}.#{body}"
  )
  actual = signature.sub("sha256=", "")

  raise "Invalid signature" unless
    Rack::Utils.secure_compare(expected, actual)

  JSON.parse(body)
end`,
  },
  {
    id: 'go',
    label: 'Go',
    filename: 'verify.go',
    lang: 'go',
    code: `package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "math"
    "strconv"
    "strings"
    "time"
)

func verifyWebhook(sig, ts, body, secret string) error {
    // Reject if older than 5 minutes
    t, _ := strconv.ParseInt(ts, 10, 64)
    age := math.Abs(float64(time.Now().Unix() - t))
    if age > 300 {
        return fmt.Errorf("timestamp too old")
    }

    // Verify HMAC-SHA256 signature
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(fmt.Sprintf("%s.%s", ts, body)))
    expected := hex.EncodeToString(mac.Sum(nil))
    actual := strings.TrimPrefix(sig, "sha256=")

    if !hmac.Equal([]byte(expected), []byte(actual)) {
        return fmt.Errorf("invalid signature")
    }
    return nil
}`,
  },
  {
    id: 'php',
    label: 'PHP',
    filename: 'verify.php',
    lang: 'php',
    code: `<?php
function verifyWebhook($request, $secret) {
    $signature = $request->header("X-Quackback-Signature");
    $timestamp = $request->header("X-Quackback-Timestamp");
    $body = $request->getContent();

    // Reject if older than 5 minutes
    $age = abs(time() - intval($timestamp));
    if ($age > 300) {
        throw new Exception("Timestamp too old");
    }

    // Verify HMAC-SHA256 signature
    $expected = hash_hmac(
        "sha256", "{$timestamp}.{$body}", $secret
    );
    $actual = str_replace("sha256=", "", $signature);

    if (!hash_equals($expected, $actual)) {
        throw new Exception("Invalid signature");
    }

    return json_decode($body, true);
}`,
  },
]

const FRAMEWORK_ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  node: NodeJsIcon,
  python: PythonIcon,
  ruby: RubyIcon,
  go: GoIcon,
  php: PHPIcon,
}

const WEBHOOK_EVENTS = [
  { id: 'post.created', label: 'New Post' },
  { id: 'post.status_changed', label: 'Status Changed' },
  { id: 'comment.created', label: 'New Comment' },
  { id: 'changelog.published', label: 'Changelog Published' },
] as const

const WEBHOOK_HEADERS = [
  { name: 'X-Quackback-Signature', desc: 'HMAC-SHA256 signature' },
  { name: 'X-Quackback-Timestamp', desc: 'Unix epoch seconds' },
  { name: 'X-Quackback-Event', desc: 'Event type' },
] as const

// ——————————————————————————————————————————————————
// Component
// ——————————————————————————————————————————————————

export function WebhookVerificationGuide() {
  const [selectedFramework, setSelectedFramework] = useState('node')
  const [copiedCode, setCopiedCode] = useState(false)

  const framework = FRAMEWORKS.find((f) => f.id === selectedFramework) ?? FRAMEWORKS[0]

  const codeOutput = useMemo(() => framework.code, [framework])

  async function handleCopyCode() {
    await navigator.clipboard.writeText(codeOutput)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[420px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] flex-1">
        {/* ─── Left: Configuration ─── */}
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border divide-y divide-border">
          {/* Header */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Signature Verification</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verify webhook deliveries are authentic
            </p>
          </div>

          {/* Step 1: How it works */}
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">How it works</span>
            </div>
            <div className="ml-7 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Each delivery includes an HMAC-SHA256 signature computed from your signing secret.
                Verify the signature and check the timestamp to prevent replay attacks.
              </p>
              <div className="space-y-1">
                {WEBHOOK_HEADERS.map((header) => (
                  <div key={header.name} className="flex items-baseline gap-2">
                    <code className="text-[10px] font-mono text-foreground bg-muted/30 border border-border/50 rounded px-1.5 py-0.5 shrink-0">
                      {header.name}
                    </code>
                    <span className="text-[10px] text-muted-foreground">{header.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2: Events */}
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                2
              </span>
              <span className="text-xs font-medium text-foreground">Events</span>
            </div>
            <div className="ml-7 flex flex-wrap gap-1">
              {WEBHOOK_EVENTS.map((event) => (
                <span
                  key={event.id}
                  className="text-[10px] font-mono bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded"
                  title={event.id}
                >
                  {event.label}
                </span>
              ))}
            </div>
          </div>

          {/* Step 3: Framework */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                3
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Choose your framework</span>
                <p className="text-[11px] text-muted-foreground">Copy the verification function</p>
              </div>
            </div>

            <div className="ml-7">
              <div className="flex flex-wrap gap-1">
                {FRAMEWORKS.map((f) => {
                  const Icon = FRAMEWORK_ICONS[f.id]
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFramework(f.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                        selectedFramework === f.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {Icon && <Icon className="h-3 w-3" />}
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Payload format note */}
          <div className="p-5 space-y-1.5">
            <span className="text-xs font-medium text-foreground">Payload format</span>
            <p className="text-[11px] text-muted-foreground">
              Deliveries are JSON with{' '}
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded font-mono">id</code>,{' '}
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded font-mono">type</code>,{' '}
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded font-mono">
                createdAt
              </code>
              , and{' '}
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded font-mono">data</code>{' '}
              fields. Your endpoint must respond with a 2xx status within 5 seconds.
            </p>
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
                {framework.filename}
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
            <HighlightedCode code={codeOutput} lang={framework.lang} />
          </div>
        </div>
      </div>
    </div>
  )
}
