/**
 * A small OpenAI-compatible server for the support e2e suite. The app reaches
 * it through OPENAI_BASE_URL; tests script it through its control API.
 *
 * Endpoints the app calls:
 *   POST /v1/chat/completions   plain, streaming (SSE), structured output, tool calls
 *   POST /v1/embeddings         deterministic unit vectors of the requested size
 *   GET  /v1/models
 *
 * Control API (tests, via e2e/support/fake-ai-client.ts):
 *   POST   /__fake/rules              add a rule (see FakeAiRule)
 *   DELETE /__fake/rules?marker=...   drop the rules for one marker
 *   GET    /__fake/requests?contains=...&endpoint=chat|embeddings
 *   GET    /__fake/health
 *
 * A rule is keyed on a MARKER: any text the test put in the prompt (a unique
 * subject or message body). The app builds the prompt, so the marker is the one
 * thing a test controls end to end, and parallel tests never see each other's
 * rules. The newest matching rule wins. With no match the server answers a
 * fixed reply ("{}" for a JSON response format).
 *
 * Built-in markers, for failure paths without a rule:
 *   [[fake-ai:fail]]   HTTP 500
 *   [[fake-ai:stall]]  answer after 120 s (longer than any app timeout)
 *
 * Note: the OpenAI SDK retries 408/409/429/5xx twice, so a 500 is seen three
 * times. A rule with `status: 400` fails once.
 *
 * Run: bun e2e/support/stand-ins/fake-ai.ts   (port from support.env)
 */
import { supportEnv } from '../env'

export interface FakeAiRule {
  /** Text that must appear in the request (any message, any role, or embedding input). */
  marker: string
  /** Assistant text to answer with. */
  reply?: string
  /** Assistant text = JSON.stringify(json), for structured-output callers. */
  json?: unknown
  /** Tool calls to answer with (finish_reason "tool_calls"). */
  toolCalls?: Array<{ name: string; arguments: unknown }>
  /** Fail with this HTTP status instead of answering. */
  status?: number
  /** Error message for a failure. */
  error?: string
  /** Wait this long before answering (stall). */
  delayMs?: number
  /** Use the rule at most this many times, then fall through. */
  times?: number
}

export interface RecordedAiRequest {
  seq: number
  at: string
  endpoint: 'chat' | 'embeddings'
  model: string | null
  stream: boolean
  /** Every message's text (or every embedding input), newline-joined. */
  text: string
  /** The marker of the rule that answered, or null. */
  matched: string | null
  status: number
  /** The raw request body, for detailed assertions. */
  body: unknown
}

const FAIL_MARKER = '[[fake-ai:fail]]'
const STALL_MARKER = '[[fake-ai:stall]]'
const STALL_MS = 120_000
const MAX_RECORDED = 2_000
const DEFAULT_REPLY = 'This is the fake AI reply.'
const DEFAULT_DIMENSIONS = 1536

interface StoredRule extends FakeAiRule {
  uses: number
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('\n')
  }
  return ''
}

function chatText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages
    .map((m) => textOfContent((m as { content?: unknown } | null)?.content))
    .filter(Boolean)
    .join('\n')
}

function embeddingInputs(body: Record<string, unknown>): string[] {
  const input = body.input
  if (typeof input === 'string') return [input]
  if (Array.isArray(input)) return input.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
  return []
}

/** A deterministic unit vector for a text (FNV-1a seed, xorshift stream). */
export function fakeEmbedding(text: string, dimensions: number): number[] {
  let seed = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i)
    seed = Math.imul(seed, 0x01000193) >>> 0
  }
  if (seed === 0) seed = 1
  const out: number[] = []
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    const v = seed / 0xffffffff - 0.5
    out.push(v)
    norm += v * v
  }
  const scale = 1 / Math.sqrt(norm)
  return out.map((v) => v * scale)
}

function wantsJson(body: Record<string, unknown>): boolean {
  const format = body.response_format as { type?: string } | undefined
  return format?.type === 'json_schema' || format?.type === 'json_object'
}

export function createFakeAi() {
  const rules: StoredRule[] = []
  const requests: RecordedAiRequest[] = []
  let seq = 0

  function findRule(text: string): StoredRule | null {
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i]
      if (!text.includes(rule.marker)) continue
      if (rule.times !== undefined && rule.uses >= rule.times) continue
      return rule
    }
    return null
  }

  function record(entry: Omit<RecordedAiRequest, 'seq' | 'at'>) {
    requests.push({ seq: ++seq, at: new Date().toISOString(), ...entry })
    if (requests.length > MAX_RECORDED) requests.splice(0, requests.length - MAX_RECORDED)
  }

  function failure(status: number, message: string): Response {
    return Response.json(
      { error: { message, type: 'fake_ai_error', code: String(status) } },
      { status }
    )
  }

  function chatCompletion(model: string, content: string | null, rule: FakeAiRule | null) {
    const toolCalls = rule?.toolCalls?.map((call, index) => ({
      id: `call_fake_${seq}_${index}`,
      type: 'function' as const,
      function: {
        name: call.name,
        arguments:
          typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
      },
    }))
    return {
      id: `chatcmpl-fake-${seq}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: toolCalls?.length ? null : content,
            ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }
  }

  function streamCompletion(model: string, completion: ReturnType<typeof chatCompletion>) {
    const id = completion.id
    const created = completion.created
    const choice = completion.choices[0]
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    const parts: string[] = [chunk({ role: 'assistant', content: '' }, null)]
    const content = choice.message.content ?? ''
    for (let i = 0; i < content.length; i += 24)
      parts.push(chunk({ content: content.slice(i, i + 24) }, null))
    const calls = (choice.message as { tool_calls?: Array<Record<string, unknown>> }).tool_calls
    calls?.forEach((call, index) => parts.push(chunk({ tool_calls: [{ index, ...call }] }, null)))
    parts.push(chunk({}, choice.finish_reason))
    parts.push(
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: completion.usage })}\n\n`
    )
    parts.push('data: [DONE]\n\n')
    return new Response(parts.join(''), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }

  async function handleChat(body: Record<string, unknown>): Promise<Response> {
    const text = chatText(body)
    const model = typeof body.model === 'string' ? body.model : 'fake-chat'
    const stream = body.stream === true
    const rule = findRule(text)
    if (rule) rule.uses++
    const base = {
      endpoint: 'chat' as const,
      model,
      stream,
      text,
      body,
      matched: rule?.marker ?? null,
    }

    const delayMs = text.includes(STALL_MARKER) ? STALL_MS : (rule?.delayMs ?? 0)
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))

    const status = text.includes(FAIL_MARKER) ? 500 : rule?.status
    if (status) {
      record({ ...base, status })
      return failure(status, rule?.error ?? 'Fake AI failure')
    }

    const content =
      rule?.reply ??
      (rule && 'json' in rule ? JSON.stringify(rule.json) : wantsJson(body) ? '{}' : DEFAULT_REPLY)
    record({ ...base, status: 200 })
    const completion = chatCompletion(model, content, rule)
    return stream ? streamCompletion(model, completion) : Response.json(completion)
  }

  async function handleEmbeddings(body: Record<string, unknown>): Promise<Response> {
    const inputs = embeddingInputs(body)
    const text = inputs.join('\n')
    const model = typeof body.model === 'string' ? body.model : 'fake-embedding'
    const rule = findRule(text)
    if (rule) rule.uses++
    const base = {
      endpoint: 'embeddings' as const,
      model,
      stream: false,
      text,
      body,
      matched: rule?.marker ?? null,
    }
    const status = text.includes(FAIL_MARKER) ? 500 : rule?.status
    if (status) {
      record({ ...base, status })
      return failure(status, rule?.error ?? 'Fake AI failure')
    }
    const dimensions = typeof body.dimensions === 'number' ? body.dimensions : DEFAULT_DIMENSIONS
    const base64 = body.encoding_format === 'base64'
    record({ ...base, status: 200 })
    return Response.json({
      object: 'list',
      model,
      data: inputs.map((input, index) => {
        const vector = fakeEmbedding(input, dimensions)
        return {
          object: 'embedding',
          index,
          embedding: base64
            ? Buffer.from(new Float32Array(vector).buffer).toString('base64')
            : vector,
        }
      }),
      usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
    })
  }

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '')

    if (path === '/__fake/health') return Response.json({ ok: true })
    if (path === '/__fake/rules' && request.method === 'POST') {
      const rule = (await request.json()) as FakeAiRule
      if (!rule || typeof rule.marker !== 'string' || rule.marker.length < 4) {
        return Response.json({ error: 'marker (4+ chars) is required' }, { status: 400 })
      }
      rules.push({ ...rule, uses: 0 })
      return Response.json({ ok: true, rules: rules.length })
    }
    if (path === '/__fake/rules' && request.method === 'DELETE') {
      const marker = url.searchParams.get('marker')
      for (let i = rules.length - 1; i >= 0; i--) if (rules[i].marker === marker) rules.splice(i, 1)
      return Response.json({ ok: true })
    }
    if (path === '/__fake/requests' && request.method === 'GET') {
      const contains = url.searchParams.get('contains')
      const endpoint = url.searchParams.get('endpoint')
      return Response.json(
        requests.filter(
          (r) => (!contains || r.text.includes(contains)) && (!endpoint || r.endpoint === endpoint)
        )
      )
    }

    if (request.method === 'GET' && path.endsWith('/models')) {
      return Response.json({
        object: 'list',
        data: [
          { id: 'fake-chat', object: 'model', owned_by: 'e2e' },
          { id: 'fake-embedding', object: 'model', owned_by: 'e2e' },
        ],
      })
    }
    if (request.method === 'POST' && path.endsWith('/chat/completions')) {
      return handleChat((await request.json()) as Record<string, unknown>)
    }
    if (request.method === 'POST' && path.endsWith('/embeddings')) {
      return handleEmbeddings((await request.json()) as Record<string, unknown>)
    }
    return failure(404, `Fake AI has no ${request.method} ${path}`)
  }

  return { fetch }
}

if (import.meta.main) {
  const { fakeAiPort } = supportEnv()
  const fake = createFakeAi()
  Bun.serve({ port: fakeAiPort, hostname: '127.0.0.1', fetch: fake.fetch, idleTimeout: 0 })
  process.stdout.write(`fake AI listening on http://127.0.0.1:${fakeAiPort}\n`)
}
