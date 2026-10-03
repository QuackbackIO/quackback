import { useEffect } from 'react'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'
import type { WorkspaceTransport } from './use-workspace-transport'

export function WorkspaceCopilotTransport({
  onReady,
}: {
  onReady: (transport: WorkspaceTransport) => void
}) {
  const { start, stop, clear } = useAguiTurn({ url: '/api/admin/assistant/workspace' })
  useEffect(() => onReady({ start, stop, clear }), [start, stop, clear, onReady])
  return null
}
