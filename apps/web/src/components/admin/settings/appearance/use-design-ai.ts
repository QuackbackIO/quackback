import { useCallback, useRef, useState } from 'react'
import { track } from '@/lib/client/analytics'
import {
  askPortalDesignAiFn,
  portalDesignDirectionsFn,
} from '@/lib/server/functions/portal-design-ai'
import type { AppliedDesignChange, DesignAiScope } from '@/lib/shared/design/apply-changes'
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'

export interface DesignLook {
  name: string
  description: string
  design: PortalDesign
}

export type DesignAiTurn =
  | { role: 'user'; text: string }
  | {
      role: 'assistant'
      text: string
      changes?: AppliedDesignChange[]
      /** What the solver adjusted to keep text readable after these changes. */
      readability?: string[]
      looks?: DesignLook[]
    }

type Report = { adjustments: DesignAdjustment[]; errors: string[] }

/**
 * The Appearance conversation. A request's changes are already in the draft
 * when the answer arrives; the conversation only reports them.
 */
export function useDesignAi({
  flush,
  adopt,
}: {
  /** Saves a pending draft change first, so the server reads the latest draft. */
  flush: () => Promise<void>
  adopt: (design: PortalDesign, report: Report) => void
}) {
  const [turns, setTurns] = useState<DesignAiTurn[]>([])
  const [busy, setBusy] = useState(false)
  // Whether the draft now holds anything Quackback AI put there, for the publish event.
  const shaped = useRef(false)
  const say = (turn: DesignAiTurn) => setTurns((previous) => [...previous, turn])

  const ask = useCallback(
    async (text: string, scope: DesignAiScope) => {
      setBusy(true)
      const history = turns.map((turn) => ({ role: turn.role, content: turn.text }))
      say({ role: 'user', text })
      try {
        await flush()
        const result = await askPortalDesignAiFn({ data: { message: text, scope, history } })
        if (!result.ok) {
          say({ role: 'assistant', text: result.message })
          return
        }
        if ('report' in result && result.applied.length > 0) {
          adopt(result.design, result.report)
          shaped.current = true
        }
        say({
          role: 'assistant',
          text: result.reply,
          changes: result.applied,
          readability: result.readability,
        })
      } finally {
        setBusy(false)
      }
    },
    [turns, flush, adopt]
  )

  const start = useCallback(async (kind: 'website' | 'words', value: string) => {
    setBusy(true)
    void track('appearance_start_chosen', { start: kind })
    say({ role: 'user', text: value })
    try {
      const result = await portalDesignDirectionsFn({
        data: kind === 'website' ? { site: value } : { words: value },
      })
      if (result.ok)
        say({ role: 'assistant', text: 'Here are three looks to start from.', looks: result.looks })
      else say({ role: 'assistant', text: result.message })
    } finally {
      setBusy(false)
    }
  }, [])

  const lookPicked = useCallback((look: DesignLook) => {
    shaped.current = true
    void track('appearance_look_picked', { look: look.name })
  }, [])

  return { turns, busy, ask, start, lookPicked, shaped }
}
