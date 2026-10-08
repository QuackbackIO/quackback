type ClientConfig = {
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiDefaultHeaders?: string
}

/** Server-only gateway options; errors never include configured header values. */
export function parseOpenAIHeaders(value?: string): Record<string, string | null> {
  if (!value) return {}
  const message =
    'Invalid OPENAI_DEFAULT_HEADERS: expected unique HTTP header names with string or null values'
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(message)
    const headers: Record<string, string | null> = Object.create(null)
    for (const [name, entry] of Object.entries(parsed)) {
      const key = name.toLowerCase()
      if (
        !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(key) ||
        Object.hasOwn(headers, key) ||
        (entry !== null && typeof entry !== 'string')
      )
        throw new Error(message)
      if (entry !== null) new Headers([[key, entry]])
      headers[key] = entry
    }
    return { ...headers }
  } catch {
    throw new Error(message)
  }
}

/** Shared by the OpenAI SDK and TanStack's OpenAI-compatible adapters. */
export function getOpenAIClientOptions(config: ClientConfig) {
  const defaultHeaders = parseOpenAIHeaders(config.openaiDefaultHeaders)
  return {
    apiKey: config.openaiApiKey!,
    baseURL: config.openaiBaseUrl!,
    defaultHeaders,
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      // Apply at the wire boundary too: adapters may reconstruct SDK defaults.
      for (const [name, value] of Object.entries(defaultHeaders)) {
        if (value === null) headers.delete(name)
        else headers.set(name, value)
      }
      return fetch(new Request(request, { headers }))
    },
  }
}
