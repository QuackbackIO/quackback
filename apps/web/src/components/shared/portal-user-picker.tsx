import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { realEmail } from '@/lib/shared/anonymous-email'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'

/** The identity fields a picked portal user hands back. */
export interface PortalUserPick {
  principalId: string
  name: string | null
  email: string | null
  image?: string | null
}

interface PortalUserPickerProps {
  onSelect: (user: PortalUserPick) => void
  /** Parent gate (e.g. dialog open && nothing picked yet). */
  enabled?: boolean
  /** Result page size. */
  limit?: number
  /** Disable (and annotate) users without a deliverable email — outbound compose
   *  needs an address; a ticket requester does not. */
  requireEmail?: boolean
  /** Only query + show results once the user types. Browse-from-empty when false. */
  searchRequired?: boolean
  autoFocus?: boolean
  placeholder?: string
}

/**
 * A debounced portal-user search + pick list, shared by the new-conversation and
 * new-ticket dialogs. Owns its own search box + query; the parent supplies the
 * gate and receives the chosen user.
 */
export function PortalUserPicker({
  onSelect,
  enabled = true,
  limit = 8,
  requireEmail = false,
  searchRequired = false,
  autoFocus = false,
  placeholder,
}: PortalUserPickerProps) {
  const intl = useOptionalIntl()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 350)
  const showResults = !searchRequired || debounced.length > 0
  const unnamed = intl.formatMessage({
    id: 'admin.shell.portalUserPicker.unnamed',
    defaultMessage: 'Unnamed user',
  })

  const usersQuery = useQuery({
    ...adminQueries.portalUsers({ search: debounced || undefined, page: 1, limit }),
    enabled: enabled && showResults,
  })

  return (
    <div className="space-y-2">
      <Input
        autoFocus={autoFocus}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={
          placeholder ??
          intl.formatMessage({
            id: 'admin.shell.portalUserPicker.search',
            defaultMessage: 'Search users by name or email…',
          })
        }
      />
      {showResults && (
        <div className="max-h-64 divide-y divide-border/40 overflow-y-auto rounded-md border border-border/60">
          {usersQuery.isLoading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'admin.shell.portalUserPicker.searching',
                defaultMessage: 'Searching…',
              })}
            </p>
          ) : (usersQuery.data?.items.length ?? 0) === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'admin.shell.portalUserPicker.noUsers',
                defaultMessage: 'No users found.',
              })}
            </p>
          ) : (
            usersQuery.data!.items.map((u) => {
              const deliverable = !requireEmail || !!realEmail(u.email)
              return (
                <button
                  key={u.principalId}
                  type="button"
                  disabled={!deliverable}
                  title={
                    deliverable
                      ? undefined
                      : intl.formatMessage({
                          id: 'admin.shell.portalUserPicker.noEmailTitle',
                          defaultMessage: 'This user has no email address',
                        })
                  }
                  onClick={() =>
                    onSelect({
                      principalId: u.principalId,
                      name: u.name,
                      email: u.email,
                      image: u.image,
                    })
                  }
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Avatar src={u.image} name={u.name ?? unnamed} className="size-7 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {u.name || unnamed}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {realEmail(u.email) ??
                        intl.formatMessage({
                          id: 'admin.shell.portalUserPicker.noEmail',
                          defaultMessage: 'No email',
                        })}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
