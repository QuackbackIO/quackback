/**
 * Connection — the first of the three sections on a configured provider.
 *
 * A working connection is a summary, not a form: who the last test signed in
 * as, when, and two actions (Test again, Edit). The form only appears behind
 * Edit, because the provider, discovery URL and credentials are set once and
 * then left alone; showing them permanently made a finished setup look like
 * unfinished configuration work.
 *
 * Exceptions stay visible in the summary — no client secret, a test made stale
 * by a later change, a test account with no email — because those are the
 * things that stop sign-in working, and hiding them behind Edit would hide the
 * reason.
 */
import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { setProviderCredentialsFn } from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { previewClaimMapping } from '@/lib/shared/sso-mapping-preview'
import { diffClaimMappingOperations, mappingSaveRisks } from '@/lib/shared/sso-claim-mapping-edit'
import type { ProfileOutcome } from '@/lib/shared/sso-profile-outcome'
import {
  ConnectionFields,
  connectionDraftFrom,
  connectionPatchFrom,
  type ConnectionDraft,
} from './connection-form'
import { TestDetails } from './outcome-preview-rail'
import {
  getConnectionTestState,
  mergeClaimMapping,
  reportMissingIdpFields,
  withAllowMissingEmail,
} from './provider-shared'
import { useConnectionTest, useProviderCapture } from './use-connection-test'
import { useProviderSave } from './use-provider-save'

export function ConnectionCard({ provider }: { provider: IdentityProvider }) {
  // A provider with no saved secret cannot be tested, so there is nothing to
  // summarise: open straight on the form.
  const [editing, setEditing] = useState(!provider.configured)

  return (
    <div id="connection" className="scroll-mt-6">
      <SettingsCard title="Connection" contentClassName="space-y-5">
        {editing ? (
          <ConnectionEditor provider={provider} onDone={() => setEditing(false)} />
        ) : (
          <ConnectionSummary provider={provider} onEdit={() => setEditing(true)} />
        )}
      </SettingsCard>
    </div>
  )
}

function ConnectionSummary({
  provider,
  onEdit,
}: {
  provider: IdentityProvider
  onEdit: () => void
}) {
  const { openTest } = useConnectionTest(provider)
  const capture = useProviderCapture(provider)
  const state = getConnectionTestState(provider)
  const preview = capture
    ? previewClaimMapping({
        draft: provider.claimMapping,
        capture,
        definitions: [],
        providerPolicy: {
          autoCreateUsers: provider.autoCreateUsers,
          autoProvisionRole: provider.autoProvisionRole,
          detailsChangedAt: provider.detailsChangedAt,
          registrationId: provider.registrationId,
        },
      })
    : null
  const who = capture?.identity?.name ?? capture?.identity?.email ?? capture?.identity?.id ?? null
  // When the newest capture is a failure, that failure is the summary:
  // neither "Connected as <the account that failed>" (the row's earlier
  // success) nor the generic "changed since the last test" applies.
  const failure = preview?.status === 'mapping_failed' ? preview.identity : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1 text-sm">
          {failure !== undefined ? (
            <p className="flex items-start gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
              {failureSummary(failure)}
            </p>
          ) : state.kind === 'verified' && who ? (
            <>
              <p className="flex flex-wrap items-center gap-x-1.5 font-medium">
                <CheckCircleIcon className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                <span>Connected as {who}</span>
                <span className="font-normal text-muted-foreground">
                  · Tested <TimeAgo date={state.testedAt} />
                </span>
              </p>
              {capture?.identity?.email && who !== capture.identity.email && (
                <p className="text-muted-foreground">{capture.identity.email}</p>
              )}
            </>
          ) : state.kind === 'verified' ? (
            <p className="flex items-center gap-1.5 font-medium">
              <CheckCircleIcon className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              Connected · Tested <TimeAgo date={state.testedAt} />
            </p>
          ) : state.kind === 'stale' ? (
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <ClockIcon className="size-4 shrink-0" />
              Connection changed since the last test. Test again before requiring SSO.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Not tested yet. Sign in through this provider to confirm the connection.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openTest}>
            {capture ? 'Test again' : 'Test sign-in'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>

      {failure?.kind === 'missing_email' && <AllowMissingEmailOffer provider={provider} />}

      {capture && <TestDetails capture={capture} identity={preview?.identity ?? null} />}
    </div>
  )
}

/** One line on why the newest test failed, replayed against the saved
 *  settings: the same account would now resolve (settings were fixed since),
 *  has no email, or cannot be identified at all. */
function failureSummary(identity: ProfileOutcome | null): string {
  if (identity?.kind === 'missing_email') {
    return 'The test account has no email address, so it could not sign in.'
  }
  if (identity?.kind === 'identity' || identity?.kind === 'placeholder_required') {
    return 'The last test failed with the previous settings. Test again to confirm the fix.'
  }
  return 'The last test could not identify the account. Check the profile fields under User details, then test again.'
}

/**
 * The one test failure an admin can fix from here: the account has no email
 * and the provider does not allow that. Everything else (wrong claim path,
 * missing identifier) is a User details problem and is explained there.
 */
function AllowMissingEmailOffer({ provider }: { provider: IdentityProvider }) {
  const { saving, saveClaimMapping } = useProviderSave(provider)

  const allow = async () => {
    const proposed = mergeClaimMapping(provider.claimMapping, {
      profile: withAllowMissingEmail(provider.claimMapping?.profile, true),
    })
    // Pre-existing admin rules are untouched by this change but the server
    // still requires them to be acknowledged on every mapping write.
    await saveClaimMapping(
      {
        operations: diffClaimMappingOperations(provider.claimMapping, proposed),
        acknowledgeAdminRules: mappingSaveRisks(provider.claimMapping, proposed).hasAdminRules,
      },
      'People can now sign in without an email address.'
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
      <p>
        If your provider does not release email addresses, you can let people sign in without one.
        They get a permanent placeholder address and are asked for a real one afterwards.
      </p>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={allow}>
        Let people sign in without an email address
      </Button>
    </div>
  )
}

function ConnectionEditor({
  provider,
  onDone,
}: {
  provider: IdentityProvider
  onDone: () => void
}) {
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const setCreds = useServerFn(setProviderCredentialsFn)
  const { saving, save } = useProviderSave(provider)
  const { openTest } = useConnectionTest(provider)
  const [draft, setDraft] = useState<ConnectionDraft>(() => connectionDraftFrom(provider))
  const [savingSecret, setSavingSecret] = useState(false)
  const busy = saving || savingSecret

  const persist = async (): Promise<boolean> => {
    if (reportMissingIdpFields({ clientId: draft.clientId })) return false
    const ok = await save(connectionPatchFrom(draft), 'Connection saved.')
    if (!ok) return false
    const secret = draft.secret.trim()
    if (!secret) return true
    setSavingSecret(true)
    try {
      await setCreds({ data: { id: provider.id, clientSecret: secret } })
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the client secret.')
      return false
    } finally {
      setSavingSecret(false)
    }
  }

  const handleSave = async () => {
    if (await persist()) onDone()
  }

  const handleSaveAndTest = async () => {
    if (!(await persist())) return
    onDone()
    openTest()
  }

  return (
    <div className="space-y-6">
      <ConnectionFields
        draft={draft}
        onChange={setDraft}
        registrationId={provider.registrationId}
        baseUrl={baseUrl}
        disabled={busy}
        existing
      />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-5">
        {provider.configured && (
          <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" onClick={handleSaveAndTest} disabled={busy}>
          Save and test
        </Button>
      </div>
    </div>
  )
}
