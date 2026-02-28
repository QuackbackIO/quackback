import { useState, useEffect, useCallback } from 'react'
import { Loader2Icon, AlertCircleIcon } from 'lucide-react'
import { useZafClient } from './use-zaf-client'
import { AppContextProvider, useAppContext } from './use-app-context'
import { SidebarLinkedPosts, type LinkedPostData } from './sidebar-linked-posts'
import { SidebarSuggestions } from './sidebar-suggestions'
import { SidebarSearch } from './sidebar-search'
import { SidebarCreateForm } from './sidebar-create-form'
import type { PostRowData } from './sidebar-post-row'

export function SidebarApp() {
  const zaf = useZafClient()

  if (zaf.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (zaf.status === 'error' || !zaf.apiKey || !zaf.ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <AlertCircleIcon className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{zaf.error ?? 'Failed to initialize'}</p>
      </div>
    )
  }

  return (
    <AppContextProvider apiKey={zaf.apiKey} baseUrl={zaf.baseUrl ?? ''} ticket={zaf.ticket}>
      <SidebarContent />
    </AppContextProvider>
  )
}

type View = 'main' | 'create'

function SidebarContent() {
  const { appFetch, ticket } = useAppContext()
  const [view, setView] = useState<View>('main')
  const [createTitle, setCreateTitle] = useState('')
  const [linkedPosts, setLinkedPosts] = useState<LinkedPostData[]>([])
  const [suggestions, setSuggestions] = useState<PostRowData[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [searchActive, setSearchActive] = useState(false)

  const linkedPostIds = new Set(linkedPosts.map((p) => p.id))

  const fetchLinked = useCallback(async () => {
    try {
      const res = await appFetch(
        `/api/v1/apps/linked?integrationType=zendesk&externalId=${encodeURIComponent(ticket.id)}`
      )
      if (res.ok) {
        const data = await res.json()
        setLinkedPosts(data.data?.posts ?? [])
      }
    } catch {
      // Silently fail
    }
  }, [appFetch, ticket.id])

  const fetchSuggestions = useCallback(async () => {
    if (!ticket.subject) {
      setSuggestionsLoading(false)
      return
    }

    setSuggestionsLoading(true)
    try {
      const res = await appFetch(
        `/api/v1/apps/suggest?text=${encodeURIComponent(ticket.subject)}&limit=5`
      )
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data.data?.posts ?? [])
      }
    } catch {
      // Silently fail
    } finally {
      setSuggestionsLoading(false)
    }
  }, [appFetch, ticket.subject])

  useEffect(() => {
    fetchLinked()
    fetchSuggestions()
  }, [fetchLinked, fetchSuggestions])

  async function handleLink(postId: string) {
    try {
      await appFetch('/api/v1/apps/link', {
        method: 'POST',
        body: JSON.stringify({
          postId,
          integrationType: 'zendesk',
          externalId: ticket.id,
          externalUrl: `zendesk:ticket:${ticket.id}`,
          requester: ticket.requesterEmail
            ? { email: ticket.requesterEmail, name: ticket.requesterName || undefined }
            : undefined,
        }),
      })
      await fetchLinked()
    } catch {
      // Silently fail
    }
  }

  async function handleUnlink(postId: string) {
    try {
      await appFetch('/api/v1/apps/unlink', {
        method: 'POST',
        body: JSON.stringify({
          postId,
          integrationType: 'zendesk',
          externalId: ticket.id,
        }),
      })
      await fetchLinked()
    } catch {
      // Silently fail
    }
  }

  function handleCreateFromSearch(query: string) {
    setCreateTitle(query)
    setView('create')
  }

  function handleCreateNew() {
    setCreateTitle('')
    setView('create')
  }

  function handleCreated() {
    setView('main')
    fetchLinked()
    fetchSuggestions()
  }

  if (view === 'create') {
    return (
      <div className="p-3">
        <SidebarCreateForm
          initialTitle={createTitle}
          onBack={() => setView('main')}
          onCreated={handleCreated}
        />
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">🦆</span>
        <span className="text-sm font-semibold">Quackback</span>
      </div>

      <div className="space-y-4">
        <SidebarSearch
          linkedPostIds={linkedPostIds}
          onLink={handleLink}
          onSearchActiveChange={setSearchActive}
          onCreateFromSearch={handleCreateFromSearch}
        />

        {!searchActive && (
          <>
            <SidebarLinkedPosts posts={linkedPosts} onUnlink={handleUnlink} />

            <SidebarSuggestions
              posts={suggestions.filter((s) => !linkedPostIds.has(s.id))}
              linkedPostIds={linkedPostIds}
              loading={suggestionsLoading}
              onLink={handleLink}
              label={linkedPosts.length > 0 ? 'More suggestions' : 'Suggested matches'}
            />

            <button
              onClick={handleCreateNew}
              className="flex w-full items-center justify-center rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            >
              + Create new post
            </button>
          </>
        )}
      </div>
    </div>
  )
}
