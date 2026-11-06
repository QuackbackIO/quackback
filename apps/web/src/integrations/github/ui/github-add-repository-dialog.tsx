'use client'

/**
 * Pick a repository the GitHub connection can see and start syncing it.
 * Repositories already synced are left out; the list filters as you type.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, FolderIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fetchGitHubReposFn } from '@/integrations/github/server/functions'
import { useAddIntegrationDestination } from '@/lib/client/mutations'

interface GitHubAddRepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Repositories already synced (`owner/repo`), left out of the list. */
  synced: string[]
}

export function GitHubAddRepositoryDialog({
  open,
  onOpenChange,
  synced,
}: GitHubAddRepositoryDialogProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')
  const add = useAddIntegrationDestination()
  const repos = useQuery({
    queryKey: ['admin', 'integrations', 'github', 'repositories'],
    queryFn: () => fetchGitHubReposFn(),
    enabled: open,
    staleTime: 60_000,
  })

  const taken = new Set(synced.map((name) => name.toLowerCase()))
  const query = search.trim().toLowerCase()
  const choices = (repos.data ?? []).filter(
    (repo) =>
      !taken.has(repo.fullName.toLowerCase()) &&
      (!query || repo.fullName.toLowerCase().includes(query))
  )

  const choose = (fullName: string) =>
    add.mutate(
      { integrationType: 'github', kind: 'repo', externalId: fullName },
      {
        onSuccess: () => {
          setSearch('')
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : intl.formatMessage({
                  id: 'admin.githubRepository.addFailed',
                  defaultMessage: 'Could not add the repository',
                })
          ),
      }
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage
              id="admin.githubRepository.addTitle"
              defaultMessage="Add repository"
            />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage
              id="admin.githubRepository.addDescription"
              defaultMessage="Choose a repository to sync. Each one gets its own webhook."
            />
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={intl.formatMessage({
            id: 'admin.githubRepository.search',
            defaultMessage: 'Search repositories',
          })}
          aria-label={intl.formatMessage({
            id: 'admin.githubRepository.search',
            defaultMessage: 'Search repositories',
          })}
        />
        <div className="max-h-72 overflow-y-auto">
          {repos.isPending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              <FormattedMessage
                id="admin.githubRepository.loading"
                defaultMessage="Loading repositories…"
              />
            </div>
          ) : repos.isError ? (
            <p className="py-6 text-sm text-destructive">
              <FormattedMessage
                id="admin.githubRepository.loadFailed"
                defaultMessage="Could not load repositories."
              />
            </p>
          ) : choices.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              <FormattedMessage
                id="admin.githubRepository.noneToAdd"
                defaultMessage="No more repositories to add."
              />
            </p>
          ) : (
            <ul className="space-y-0.5">
              {choices.map((repo) => (
                <li key={repo.id}>
                  <button
                    type="button"
                    disabled={add.isPending}
                    onClick={() => choose(repo.fullName)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
                  >
                    <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{repo.fullName}</span>
                    {repo.private && (
                      <LockClosedIcon className="ml-auto size-3 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
