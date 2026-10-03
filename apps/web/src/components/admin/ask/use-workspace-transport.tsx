import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import type { StartAguiTurnOptions } from '@/lib/client/hooks/use-agui-turn'

export interface WorkspaceTransport {
  start: (options: StartAguiTurnOptions) => Promise<void>
  stop: () => void
  clear: () => void
}
type TransportComponent = ComponentType<{ onReady: (transport: WorkspaceTransport) => void }>

export function useWorkspaceTransport() {
  const transport = useRef<WorkspaceTransport | null>(null)
  const pending = useRef<Promise<WorkspaceTransport> | null>(null)
  const resolve = useRef<((transport: WorkspaceTransport) => void) | null>(null)
  const reject = useRef<((error: unknown) => void) | null>(null)
  const epoch = useRef(0)
  const [Component, setComponent] = useState<TransportComponent | null>(null)
  const onReady = useCallback((ready: WorkspaceTransport) => {
    transport.current = ready
    resolve.current?.(ready)
  }, [])
  const load = useCallback((): Promise<WorkspaceTransport> => {
    if (transport.current) return Promise.resolve(transport.current)
    if (!pending.current) {
      pending.current = new Promise((success, failure) => {
        resolve.current = success
        reject.current = failure
      })
      void import('./workspace-copilot-transport')
        .then(({ WorkspaceCopilotTransport }) => {
          setComponent(() => WorkspaceCopilotTransport)
        })
        .catch((error) => {
          reject.current?.(error)
          pending.current = null
        })
    }
    return pending.current
  }, [])
  const start = useCallback(
    async (options: StartAguiTurnOptions) => {
      const requestedAt = epoch.current
      const ready = await load()
      if (epoch.current !== requestedAt)
        throw new DOMException('The request was cancelled', 'AbortError')
      await ready.start(options)
    },
    [load]
  )
  const stop = useCallback(() => {
    epoch.current++
    transport.current?.stop()
  }, [])
  const clear = useCallback(() => {
    epoch.current++
    transport.current?.clear()
  }, [])
  useEffect(
    () => () => {
      stop()
      reject.current?.(new DOMException('The request was cancelled', 'AbortError'))
    },
    [stop]
  )
  return { start, stop, clear, renderer: Component ? <Component onReady={onReady} /> : null }
}
