'use client'

/**
 * The repositories GitHub sync serves, each with its own card, and a way to
 * add another. The default repository (where feedback issues go when nobody
 * picks) is marked on its card.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { adminQueries } from '@/lib/client/queries/admin'
import { GitHubRepositoryCard } from '@/integrations/github/ui/github-repository-card'
import { GitHubAddRepositoryDialog } from '@/integrations/github/ui/github-add-repository-dialog'

export function GitHubRepositoryList({ disabled }: { disabled?: boolean }) {
  const [adding, setAdding] = useState(false)
  const destinations = useQuery(adminQueries.integrationDestinations('github'))
  const repositories = (destinations.data ?? []).filter((d) => d.kind === 'repo')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          <FormattedMessage id="admin.githubRepository.listTitle" defaultMessage="Repositories" />
        </Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          disabled={disabled}
          className="h-8 gap-1.5 text-xs"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          <FormattedMessage id="admin.githubRepository.add" defaultMessage="Add repository" />
        </Button>
      </div>
      {destinations.isSuccess && repositories.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="admin.githubRepository.empty"
            defaultMessage="No repositories yet. Add one to create issues and sync their status."
          />
        </p>
      )}
      {repositories.map((destination) => (
        <GitHubRepositoryCard key={destination.id} destination={destination} />
      ))}
      <GitHubAddRepositoryDialog
        open={adding}
        onOpenChange={setAdding}
        synced={repositories.map((d) => d.externalId)}
      />
    </div>
  )
}
