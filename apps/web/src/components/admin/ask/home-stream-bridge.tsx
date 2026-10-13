import { memo, useEffect, useImperativeHandle, type Ref } from 'react'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'

export type HomeStreamTransport = Pick<ReturnType<typeof useAguiTurn>, 'start' | 'stop' | 'clear'>

/** Token accumulation stays in this child; the Home frame updates only on published frames. */
export const HomeStreamBridge = memo(function HomeStreamBridge({
  transportRef,
}: {
  transportRef: Ref<HomeStreamTransport>
}) {
  const { start, stop, clear } = useAguiTurn({ url: '/api/admin/assistant/workspace' })
  useImperativeHandle(transportRef, () => ({ start, stop, clear }), [start, stop, clear])
  useEffect(() => () => stop(), [stop])
  return null
})
