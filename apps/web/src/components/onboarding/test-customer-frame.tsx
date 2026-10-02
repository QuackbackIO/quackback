import { useEffect, useRef } from 'react'
import { cn } from '@/lib/shared/utils'

export type TestCustomerFrameStatus = 'connecting' | 'ready' | 'expired'

/** Where the frame lands once signed in (the widget's `quackback:open` payload). */
export type TestCustomerFrameOpen =
  { view: 'chat'; body?: string } | { view: 'new-post'; title?: string; body?: string }

interface TestCustomerFrameProps {
  /**
   * A fresh one-time token each time the frame (re)loads, or null when none can
   * be had. The token reaches the frame by postMessage only, never a URL.
   */
  getToken: () => Promise<string | null>
  open: TestCustomerFrameOpen
  onStatusChange?: (status: TestCustomerFrameStatus) => void
  /** The widget's own SDK events (`post:created` and friends). */
  onEvent?: (name: string, payload: unknown) => void
  title: string
  className?: string
}

/**
 * The real `/widget` signed in as the teammate's test customer. The frame is
 * bearer-only, so the teammate's own cookie session in this browser is never
 * touched.
 */
export function TestCustomerFrame({
  getToken,
  open,
  onStatusChange,
  onEvent,
  title,
  className,
}: TestCustomerFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const latest = useRef({ getToken, open, onStatusChange, onEvent })
  latest.current = { getToken, open, onStatusChange, onEvent }

  useEffect(() => {
    const origin = window.location.origin
    let activeDocument: string | undefined | null = null
    let requestVersion = 0
    let sessionAcknowledged = false
    let disposed = false
    function post(type: string, data: unknown, documentId?: string) {
      frameRef.current?.contentWindow?.postMessage(
        { type, data, ...(documentId && { documentId }) },
        origin
      )
    }
    async function handleMessage(event: MessageEvent) {
      const frame = frameRef.current?.contentWindow
      if (!frame || event.source !== frame || event.origin !== origin) return
      const msg = event.data as {
        type?: string
        success?: boolean
        name?: string
        payload?: unknown
        documentId?: string
      } | null
      if (msg?.type === 'quackback:ready') {
        const documentId = typeof msg.documentId === 'string' ? msg.documentId : undefined
        // Readiness may repeat during hydration; only a new document spends a token.
        if (documentId === activeDocument) return
        activeDocument = documentId
        const version = ++requestVersion
        sessionAcknowledged = false
        latest.current.onStatusChange?.('connecting')
        const token = await latest.current.getToken().catch(() => null)
        if (disposed || version !== requestVersion) return
        if (!token) {
          latest.current.onStatusChange?.('expired')
          return
        }
        post('quackback:test-token', token, documentId)
        return
      }
      if (msg?.type === 'quackback:test-session') {
        if (activeDocument === null || msg.documentId !== activeDocument || sessionAcknowledged)
          return
        sessionAcknowledged = true
        if (!msg.success) {
          latest.current.onStatusChange?.('expired')
          return
        }
        post('quackback:open', latest.current.open)
        latest.current.onStatusChange?.('ready')
        return
      }
      if (msg?.type === 'quackback:event' && typeof msg.name === 'string') {
        latest.current.onEvent?.(msg.name, msg.payload)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => {
      disposed = true
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return (
    <iframe
      ref={frameRef}
      src="/widget?test=1"
      title={title}
      className={cn('size-full border-0 bg-background', className)}
    />
  )
}
