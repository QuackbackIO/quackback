'use client'

/**
 * GitHub accounts matched to teammates, for the connection as a whole: one
 * GitHub account is the same teammate in every repository. In a repository
 * with Assignees on, an issue assigned on GitHub assigns its linked tickets
 * to the matched teammate. Each match can move to another teammate or be
 * removed. "Suggest matches" proposes teammates for the people who can be
 * assigned issues in the synced repositories; nothing is matched until a
 * suggestion is accepted. An account nobody suggested is added by login.
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, PlusIcon, SparklesIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  useDeleteIntegrationUserMapping,
  useUpsertIntegrationUserMapping,
} from '@/lib/client/mutations'
import {
  findGitHubUserFn,
  suggestGitHubPeopleFn,
  type GitHubPersonSuggestion,
} from '@/integrations/github/server/functions'
import type { IntegrationUserMappingSummary } from '@/lib/server/functions/integration-user-mappings'

const INTEGRATION_TYPE = 'github'

/** GitHub serves every account's avatar by its numeric id. */
const avatarFor = (externalUserId: string) =>
  `https://avatars.githubusercontent.com/u/${encodeURIComponent(externalUserId)}?s=48`

interface Teammate {
  id: string
  name: string | null
  email: string | null
}

function TeammateSelect({
  teammates,
  value,
  onChange,
  label,
  placeholder,
  disabled,
}: {
  teammates: Teammate[]
  value: string
  onChange: (principalId: string) => void
  label: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-56 text-xs" aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {teammates.map((teammate) => (
          <SelectItem key={teammate.id} value={teammate.id}>
            {teammate.name || teammate.email || teammate.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function GitHubPeople({ disabled }: { disabled?: boolean }) {
  const intl = useIntl()
  const mappingsQuery = useQuery(adminQueries.integrationUserMappings(INTEGRATION_TYPE))
  const membersQuery = useQuery(adminQueries.teamMembers())
  const destinations = useQuery(adminQueries.integrationDestinations(INTEGRATION_TYPE))
  const upsert = useUpsertIntegrationUserMapping()
  const remove = useDeleteIntegrationUserMapping()
  const suggest = useMutation({ mutationFn: () => suggestGitHubPeopleFn() })
  const [login, setLogin] = useState('')
  const [principalId, setPrincipalId] = useState('')
  const [adding, setAdding] = useState(false)

  const mappings = mappingsQuery.data ?? []
  const teammates: Teammate[] = membersQuery.data ?? []
  const mappedPrincipals = new Set(mappings.map((m) => m.principalId as string))
  const assigneeSyncOn = (destinations.data ?? []).some((d) => d.kind === 'repo' && d.assigneeSync)
  // A teammate matches one account; the select offers the ones still free.
  const freeTeammates = (keep?: string) =>
    teammates.filter((t) => t.id === keep || !mappedPrincipals.has(t.id))
  const pending = disabled || upsert.isPending || remove.isPending

  const saveFailed = (error: unknown) =>
    toast.error(
      error instanceof Error && error.message
        ? error.message
        : intl.formatMessage({
            id: 'admin.githubPeople.saveFailed',
            defaultMessage: 'Could not save the match',
          })
    )

  const match = (
    account: { externalUserId: string; login: string; name?: string | null },
    teammateId: string,
    onDone?: () => void
  ) =>
    upsert.mutate(
      {
        integrationType: INTEGRATION_TYPE,
        externalUserId: account.externalUserId,
        externalLogin: account.login,
        externalDisplayName: account.name ?? null,
        principalId: teammateId,
      },
      { onSuccess: onDone, onError: saveFailed }
    )

  // An accepted suggestion leaves the list once the matches reload.
  const accept = (suggestion: GitHubPersonSuggestion) =>
    match(
      {
        externalUserId: suggestion.account.id,
        login: suggestion.account.login,
        name: suggestion.account.name,
      },
      suggestion.principalId
    )

  const handleAdd = async () => {
    const wanted = login.trim().replace(/^@/, '')
    if (!wanted || !principalId) return
    setAdding(true)
    try {
      const account = await findGitHubUserFn({ data: { login: wanted } })
      match(
        { externalUserId: account.id, login: account.login, name: account.name },
        principalId,
        () => {
          setLogin('')
          setPrincipalId('')
        }
      )
    } catch (error) {
      saveFailed(error)
    } finally {
      setAdding(false)
    }
  }

  const reasonLabel = (reason: GitHubPersonSuggestion['reason']) =>
    reason === 'email'
      ? intl.formatMessage({ id: 'admin.githubPeople.reason.email', defaultMessage: 'Same email' })
      : reason === 'login'
        ? intl.formatMessage({
            id: 'admin.githubPeople.reason.login',
            defaultMessage: 'Similar login',
          })
        : intl.formatMessage({ id: 'admin.githubPeople.reason.name', defaultMessage: 'Same name' })

  const suggestions = (suggest.data?.suggestions ?? []).filter(
    (s) =>
      !mappedPrincipals.has(s.principalId) &&
      !mappings.some((m) => m.externalUserId === s.account.id)
  )

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <FormattedMessage id="admin.githubPeople.title" defaultMessage="People" />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <FormattedMessage
              id="admin.githubPeople.description"
              defaultMessage="Match GitHub accounts to teammates. In repositories with Assignees on, assigning an issue on GitHub assigns its tickets to the matched teammate, and unassigning them clears it."
            />
          </p>
          {destinations.isSuccess && !assigneeSyncOn && (
            <p className="mt-1 text-xs text-muted-foreground">
              <FormattedMessage
                id="admin.githubPeople.assigneeSyncOff"
                defaultMessage="No repository has Assignees on yet, so these matches are not used."
              />
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => suggest.mutate(undefined, { onError: saveFailed })}
          disabled={disabled || suggest.isPending}
          className="h-8 shrink-0 gap-1.5 text-xs"
        >
          {suggest.isPending ? (
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SparklesIcon className="h-3.5 w-3.5" />
          )}
          <FormattedMessage id="admin.githubPeople.suggest" defaultMessage="Suggest matches" />
        </Button>
      </div>

      {suggest.isSuccess && (
        <div className="border-t border-border px-4 py-3">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <FormattedMessage
                id="admin.githubPeople.noSuggestions"
                defaultMessage="No new matches among the {count, plural, one {# person} other {# people}} who can be assigned issues."
                values={{ count: suggest.data.scanned }}
              />
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.account.id} className="flex items-center gap-3 text-sm">
                  <Avatar
                    src={suggestion.account.avatarUrl}
                    name={suggestion.account.login}
                    className="size-6"
                  />
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs">@{suggestion.account.login}</span>
                    {' → '}
                    {suggestion.teammateName || suggestion.teammateEmail}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {reasonLabel(suggestion.reason)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 text-xs"
                    disabled={pending}
                    onClick={() => accept(suggestion)}
                    aria-label={intl.formatMessage(
                      {
                        id: 'admin.githubPeople.acceptLabel',
                        defaultMessage: 'Match @{login} to {teammate}',
                      },
                      {
                        login: suggestion.account.login,
                        teammate: suggestion.teammateName || suggestion.teammateEmail || '',
                      }
                    )}
                  >
                    <FormattedMessage id="admin.githubPeople.accept" defaultMessage="Accept" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mappings.length > 0 && (
        <table className="w-full border-t border-border text-sm">
          <thead>
            <tr className="border-b border-border/50 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">
                <FormattedMessage id="admin.githubPeople.account" defaultMessage="GitHub account" />
              </th>
              <th className="px-4 py-2 text-left font-medium">
                <FormattedMessage id="admin.githubPeople.teammate" defaultMessage="Teammate" />
              </th>
              <th className="w-10 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping: IntegrationUserMappingSummary) => (
              <tr key={mapping.id} className="border-b border-border/30 last:border-0">
                <td className="px-4 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar
                      src={avatarFor(mapping.externalUserId)}
                      name={mapping.externalLogin}
                      className="size-6"
                    />
                    <span className="truncate font-mono text-xs">@{mapping.externalLogin}</span>
                    {mapping.externalDisplayName && (
                      <span className="truncate text-xs text-muted-foreground">
                        {mapping.externalDisplayName}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <TeammateSelect
                    teammates={freeTeammates(mapping.principalId)}
                    value={mapping.principalId}
                    disabled={pending}
                    label={intl.formatMessage(
                      {
                        id: 'admin.githubPeople.teammateFor',
                        defaultMessage: 'Teammate for @{login}',
                      },
                      { login: mapping.externalLogin }
                    )}
                    onChange={(teammateId) =>
                      match(
                        {
                          externalUserId: mapping.externalUserId,
                          login: mapping.externalLogin,
                          name: mapping.externalDisplayName,
                        },
                        teammateId
                      )
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() =>
                      remove.mutate(
                        { integrationType: INTEGRATION_TYPE, mappingId: mapping.id },
                        { onError: saveFailed }
                      )
                    }
                    aria-label={intl.formatMessage(
                      {
                        id: 'admin.githubPeople.remove',
                        defaultMessage: 'Remove the match for @{login}',
                      },
                      { login: mapping.externalLogin }
                    )}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'admin.githubPeople.loginPlaceholder',
            defaultMessage: 'GitHub login',
          })}
          aria-label={intl.formatMessage({
            id: 'admin.githubPeople.loginPlaceholder',
            defaultMessage: 'GitHub login',
          })}
          disabled={disabled}
          className="h-8 w-48 text-xs"
        />
        <TeammateSelect
          teammates={freeTeammates()}
          value={principalId}
          onChange={setPrincipalId}
          disabled={disabled}
          label={intl.formatMessage({
            id: 'admin.githubPeople.teammate',
            defaultMessage: 'Teammate',
          })}
          placeholder={intl.formatMessage({
            id: 'admin.githubPeople.chooseTeammate',
            defaultMessage: 'Choose a teammate',
          })}
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={pending || adding || !login.trim() || !principalId}
          className="h-8 gap-1.5 text-xs"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          <FormattedMessage id="admin.githubPeople.add" defaultMessage="Add match" />
        </Button>
      </div>
    </section>
  )
}
