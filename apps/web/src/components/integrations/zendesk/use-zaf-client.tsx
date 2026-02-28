import { useState, useEffect, useRef } from 'react'

export interface TicketContext {
  id: string
  subject: string
  requesterName: string
  requesterEmail: string
}

interface ZAFClientInstance {
  get: (paths: string | string[]) => Promise<Record<string, unknown>>
  metadata: () => Promise<{ settings: Record<string, string> }>
  invoke: (name: string, ...args: unknown[]) => Promise<unknown>
}

declare global {
  interface Window {
    ZAFClient?: {
      init: () => ZAFClientInstance
    }
  }
}

interface ZafState {
  status: 'loading' | 'ready' | 'error'
  ticket: TicketContext | null
  apiKey: string | null
  baseUrl: string | null
  error: string | null
}

/**
 * Hook that loads the ZAF SDK, initializes the client, and extracts
 * ticket context + API key from Zendesk settings.
 *
 * Falls back to URL search params for local development.
 */
export function useZafClient(): ZafState {
  const [state, setState] = useState<ZafState>({
    status: 'loading',
    ticket: null,
    apiKey: null,
    baseUrl: null,
    error: null,
  })
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const params = new URLSearchParams(window.location.search)

    // Check if we're inside a Zendesk iframe (ZAF appends these params)
    const hasZafParams = params.has('app_guid') && params.has('origin')

    if (hasZafParams) {
      loadZafSdk()
        .then(initializeZaf)
        .catch((err) =>
          setState((s) => ({ ...s, status: 'error', error: String(err) }))
        )
    } else {
      // Local development fallback: read from URL params
      const apiKey = params.get('key')
      if (!apiKey) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Not in Zendesk context and no ?key= param provided',
        }))
        return
      }

      setState({
        status: 'ready',
        ticket: {
          id: params.get('ticketId') ?? 'dev-1',
          subject: params.get('subject') ?? 'Development ticket',
          requesterName: params.get('name') ?? 'Test User',
          requesterEmail: params.get('email') ?? 'test@example.com',
        },
        apiKey,
        baseUrl: window.location.origin,
        error: null,
      })
    }
  }, [])

  async function initializeZaf() {
    const client = window.ZAFClient!.init()

    const [ticketData, metadata] = await Promise.all([
      client.get([
        'ticket.id',
        'ticket.subject',
        'ticket.requester.name',
        'ticket.requester.email',
      ]),
      client.metadata(),
    ])

    const apiKey = metadata.settings.api_key
    const baseUrl = metadata.settings.quackback_url

    if (!apiKey) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'API key not configured in Zendesk app settings',
      }))
      return
    }

    setState({
      status: 'ready',
      ticket: {
        id: String(ticketData['ticket.id'] ?? ''),
        subject: String(ticketData['ticket.subject'] ?? ''),
        requesterName: String(ticketData['ticket.requester.name'] ?? ''),
        requesterEmail: String(ticketData['ticket.requester.email'] ?? ''),
      },
      apiKey,
      baseUrl: baseUrl || window.location.origin,
      error: null,
    })
  }

  return state
}

function loadZafSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.ZAFClient) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://static.zdassets.com/zendesk_app_framework_sdk/2.0/zaf_sdk.min.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load ZAF SDK'))
    document.head.appendChild(script)
  })
}
