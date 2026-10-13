import { useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { SettingsCard } from '../settings-card'
import { Button } from '@/components/ui/button'
import { supportAgentQueries } from '@/lib/client/queries/support-agents'
import { updateAnsweringFn } from '@/lib/server/functions/support-agents'
import type { AnswerMode } from '@/lib/shared/support-agents'
import { ANSWER_MODES } from '@/lib/shared/support-agents'
import { isRecentSignInRequired } from '@/lib/shared/recent-sign-in'
import { useSignInAgain } from '@/lib/client/hooks/use-sign-in-again'
import { SignInAgainDialog } from '@/components/auth/sign-in-again-dialog'

export function AnsweringModeCard() {
  const query = useQuery(supportAgentQueries.answering())
  if (!query.data) return null
  return <AnsweringModeForm mode={query.data.mode} ownAgentReady={query.data.ownAgentReady} />
}
function AnsweringModeForm({ mode, ownAgentReady }: { mode: AnswerMode; ownAgentReady: boolean }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState(mode)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!dirty) setChoice(mode)
  }, [mode, dirty])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const m = (key: string, fallback: string) =>
    intl.formatMessage({ id: `ownAgent.${key}`, defaultMessage: fallback })
  const signInAgain = useSignInAgain({
    onSignedIn: (action) => {
      const resumed = action.slice('own-agent-answering:'.length)
      if (action.startsWith('own-agent-answering:') && ANSWER_MODES.includes(resumed as AnswerMode))
        void save(resumed as AnswerMode)
    },
  })
  async function save(next: AnswerMode = choice) {
    setBusy(true)
    setError(null)
    try {
      const result = await updateAnsweringFn({ data: { mode: next } })
      if (isRecentSignInRequired(result)) {
        signInAgain.request(`own-agent-answering:${next}`)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['support-agent', 'answering'] })
      setChoice(next)
      setDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsCard>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">
          {m('mode', 'Who answers new conversations')}
        </legend>
        {(['quackback_ai', 'own_agent', 'team'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="answering-mode"
              checked={choice === value}
              disabled={value === 'own_agent' && !ownAgentReady}
              onChange={() => {
                setDirty(true)
                setChoice(value)
              }}
            />
            {value === 'quackback_ai'
              ? 'Quackback AI'
              : value === 'own_agent'
                ? m('title', 'Your AI agent')
                : m('team', 'Human team')}
          </label>
        ))}
      </fieldset>
      {!ownAgentReady && (
        <Link to="/admin/settings/agents/your-ai" className="mt-3 inline-block text-sm underline">
          {m('connect', 'Connect agent')}
        </Link>
      )}
      <div className="mt-4 flex gap-2">
        <Button disabled={busy || choice === mode} onClick={() => void save()}>
          {m('save', 'Save')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || choice === mode}
          onClick={() => {
            setDirty(false)
            setChoice(mode)
          }}
        >
          {m('cancel', 'Cancel')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <SignInAgainDialog {...signInAgain.dialog} />
    </SettingsCard>
  )
}
