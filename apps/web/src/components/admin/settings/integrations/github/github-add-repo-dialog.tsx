'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, FolderIcon } from '@heroicons/react/24/solid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  fetchGitHubReposFn,
  type GitHubRepo,
  getGitHubConnectUrl,
} from '@/lib/server/integrations/github/functions'

interface GitHubAddRepoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GitHubAddRepoDialog({ open, onOpenChange }: GitHubAddRepoDialogProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Try to fetch repos using any existing GitHub connection's token
      const result = await fetchGitHubReposFn({ data: {} })
      setRepos(result)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No active GitHub connection found. The new connection will authenticate with GitHub.'
      )
      setRepos([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchRepos()
    }
  }, [open, fetchRepos])

  const handleSelectRepo = async (repo: GitHubRepo) => {
    setConnecting(true)
    try {
      const url = await getGitHubConnectUrl({
        data: {
          intent: 'new',
          repoFullName: repo.fullName,
        },
      })
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      setConnecting(false)
    }
  }

  const handleConnectNew = async () => {
    setConnecting(true)
    try {
      const url = await getGitHubConnectUrl({ data: { intent: 'new' } })
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add GitHub repository</DialogTitle>
          <DialogDescription>
            Select a repository to connect. Each repository gets its own sync configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Available repositories</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchRepos}
              disabled={loading}
              className="h-8 gap-1.5 text-xs"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="text-sm text-muted-foreground rounded-lg border border-border/50 p-3">
              <p>{error}</p>
              <Button className="mt-2" size="sm" onClick={handleConnectNew} disabled={connecting}>
                {connecting ? (
                  <>
                    <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect with GitHub'
                )}
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && !error && repos.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No repositories found.</p>
          )}

          {!loading && repos.length > 0 && (
            <div className="max-h-80 overflow-y-auto space-y-1 rounded-lg border border-border/50 p-1">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleSelectRepo(repo)}
                  disabled={connecting}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{repo.fullName}</span>
                  {repo.private && (
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">Private</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
