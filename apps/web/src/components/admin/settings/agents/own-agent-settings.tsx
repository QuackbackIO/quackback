import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '../settings-card'
import { SignInAgainDialog } from '@/components/auth/sign-in-again-dialog'
import { useSignInAgain } from '@/lib/client/hooks/use-sign-in-again'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { isRecentSignInRequired } from '@/lib/shared/recent-sign-in'
import { supportAgentQueries } from '@/lib/client/queries/support-agents'
import {
  manageSupportAgentFn,
  type SupportAgentAction,
} from '@/lib/server/functions/support-agents'
import type { SupportAgentView } from '@/lib/server/domains/support-agents/support-agents.service'

export function OwnAgentSettings() {
  const intl = useIntl()
  const flags = useFeatureFlags()
  const queryClient = useQueryClient()
  const query = useQuery({ ...supportAgentQueries.config(), enabled: flags?.ownAgent === true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string> | null>(null)
  const requestAgain = useRef<(action: string) => void>(() => {})
  const m = (key: string, fallback: string) =>
    intl.formatMessage({ id: `ownAgent.${key}`, defaultMessage: fallback })
  async function perform(data: SupportAgentAction) {
    setBusy(true)
    setError(null)
    try {
      const result = await manageSupportAgentFn({ data })
      if (isRecentSignInRequired(result)) {
        // The sign-in marker names a tab-local frozen request, rather than
        // whatever happens to be in the form after returning from a provider.
        const key = `own-agent:${crypto.randomUUID()}`
        sessionStorage.setItem(key, JSON.stringify(data))
        requestAgain.current(key)
        return false
      }
      if (result.ok) {
        const next: Record<string, string> = {}
        if ('credential' in result && result.credential) next.credential = result.credential
        if ('signingSecret' in result && result.signingSecret) next.signing = result.signingSecret
        if (Object.keys(next).length) setSecrets(next)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['support-agent', 'config'] }),
          queryClient.invalidateQueries({ queryKey: ['support-agent', 'answering'] }),
        ])
        return true
      }
      return false
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const signInAgain = useSignInAgain({
    onSignedIn: (key) => {
      if (!key.startsWith('own-agent:')) return
      const raw = sessionStorage.getItem(key)
      sessionStorage.removeItem(key)
      if (raw) void perform(JSON.parse(raw) as SupportAgentAction)
    },
  })
  requestAgain.current = signInAgain.request
  if (!flags?.ownAgent)
    return (
      <SettingsCard>
        <p className="text-sm text-muted-foreground">
          {m('enableFirst', 'Turn on Your AI agent in Labs before connecting it.')}
        </p>
        <Link to="/admin/settings/labs" className="text-sm underline">
          Labs
        </Link>
      </SettingsCard>
    )
  if (!query.data)
    return (
      <p role={query.isError ? 'alert' : 'status'}>
        {query.error?.message ?? m('loading', 'Loading…')}
      </p>
    )
  return (
    <>
      <SettingsCard>
        <p className="mb-5 text-sm text-muted-foreground">
          {m('description', 'Connect your agent to answer customers in Messenger.')}
        </p>
        <p className="mb-5 text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'ownAgent.localHint',
            defaultMessage:
              'For a local agent, leave the URL empty and poll /api/v1/agent/turns with its credential.',
          })}
        </p>
        <AgentForm
          key={query.data.agent?.id ?? 'new'}
          agent={query.data.agent}
          busy={busy}
          save={perform}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsCard>
      {secrets && (
        <SettingsCard>
          <p className="mb-3 text-sm">
            {m('showOnce', 'Copy these secrets now. They will not be shown again.')}
          </p>
          {Object.entries(secrets).map(([key, value]) => (
            <div key={key} className="mb-3 space-y-1">
              <Label>{m(key, key === 'credential' ? 'Agent credential' : 'Signing secret')}</Label>
              <code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs select-all">
                {value}
              </code>
            </div>
          ))}
          <Button onClick={() => setSecrets(null)}>{m('done', 'Done')}</Button>
        </SettingsCard>
      )}
      <SignInAgainDialog {...signInAgain.dialog} />
    </>
  )
}

function AgentForm({
  agent,
  busy,
  save,
}: {
  agent: SupportAgentView | null
  busy: boolean
  save: (action: SupportAgentAction) => Promise<boolean>
}) {
  const intl = useIntl()
  const m = (key: string, fallback: string) =>
    intl.formatMessage({ id: `ownAgent.${key}`, defaultMessage: fallback })
  const initial = () => ({
    name: agent?.name ?? '',
    endpointUrl: agent?.endpointUrl ?? '',
    replyDeadlineSeconds: agent?.replyDeadlineSeconds ?? 20,
    fallback: agent?.fallback ?? ('team' as const),
  })
  const [draft, setDraft] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!dirty) setDraft(initial())
  }, [agent?.name, agent?.endpointUrl, agent?.replyDeadlineSeconds, agent?.fallback, dirty])
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save(
          agent
            ? {
                ...draft,
                endpointUrl: draft.endpointUrl || null,
                action: 'update',
                id: agent.id,
                status: agent.status,
              }
            : { ...draft, endpointUrl: draft.endpointUrl || null, action: 'create' }
        ).then((ok) => {
          if (ok) setDirty(false)
        })
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="own-agent-name">{m('name', 'Name')}</Label>
        <Input
          id="own-agent-name"
          value={draft.name}
          maxLength={80}
          required
          disabled={busy}
          onChange={(e) => {
            setDirty(true)
            setDraft({ ...draft, name: e.target.value })
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="own-agent-url">{m('endpoint', 'Webhook URL (optional)')}</Label>
        <Input
          id="own-agent-url"
          type="url"
          value={draft.endpointUrl}
          disabled={busy}
          onChange={(e) => {
            setDirty(true)
            setDraft({ ...draft, endpointUrl: e.target.value })
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="own-agent-deadline">{m('deadline', 'Reply deadline (seconds)')}</Label>
        <Input
          id="own-agent-deadline"
          type="number"
          min={5}
          max={120}
          value={draft.replyDeadlineSeconds}
          required
          disabled={busy}
          onChange={(e) => {
            setDirty(true)
            setDraft({ ...draft, replyDeadlineSeconds: Number(e.target.value) })
          }}
        />
      </div>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-2 text-sm font-medium">
          {m('fallback', 'If the agent does not reply')}
        </legend>
        {(['team', 'quackback_ai'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="agent-fallback"
              value={value}
              checked={draft.fallback === value}
              onChange={() => {
                setDirty(true)
                setDraft({ ...draft, fallback: value })
              }}
            />
            {value === 'team' ? m('team', 'Human team') : 'Quackback AI'}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} type="submit">
          {agent ? m('save', 'Save') : m('connect', 'Connect agent')}
        </Button>
        <Button
          disabled={busy}
          variant="outline"
          type="button"
          onClick={() => {
            setDirty(false)
            setDraft(initial())
          }}
        >
          {m('cancel', 'Cancel')}
        </Button>
      </div>
      {agent && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm">
            {agent.status === 'active' ? m('active', 'Active') : m('paused', 'Paused')}
          </p>
          {agent.lastError && <p className="text-sm text-muted-foreground">{agent.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void save({
                  action: 'update',
                  id: agent.id,
                  name: agent.name,
                  endpointUrl: agent.endpointUrl!,
                  replyDeadlineSeconds: agent.replyDeadlineSeconds,
                  fallback: agent.fallback,
                  status: agent.status === 'active' ? 'paused' : 'active',
                })
              }
            >
              {agent.status === 'active' ? m('pause', 'Pause') : m('resume', 'Resume')}
            </Button>
            {(['credential', 'signing'] as const).map((which) => (
              <Button
                key={which}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void save({ action: 'rotate', id: agent.id, which })}
              >
                {which === 'credential'
                  ? m('rotateCredential', 'Rotate credential')
                  : m('rotateSigning', 'Rotate signing secret')}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(true)}
            >
              {m('remove', 'Remove agent')}
            </Button>
          </div>
          {removing && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void save({ action: 'delete', id: agent.id })}
              >
                {m('remove', 'Remove agent')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRemoving(false)}>
                {m('cancel', 'Cancel')}
              </Button>
            </div>
          )}
        </div>
      )}
    </form>
  )
}
