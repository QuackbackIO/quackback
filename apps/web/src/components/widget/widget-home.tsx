'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Squares2X2Icon } from '@heroicons/react/24/solid'
import { PencilIcon } from '@heroicons/react/24/solid'
import { LightBulbIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WidgetVoteButton } from './widget-vote-button'
import { useWidgetAuth } from './widget-auth-provider'
import type { PostId } from '@quackback/ids'

interface WidgetPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  commentCount: number
  board?: { id: string; name: string; slug: string }
}

interface StatusInfo {
  id: string
  name: string
  color: string
}

interface BoardInfo {
  id: string
  name: string
  slug: string
}

interface WidgetHomeProps {
  initialPosts: WidgetPost[]
  statuses: StatusInfo[]
  boards: BoardInfo[]
  defaultBoard?: string
  onPostSelect?: (postId: string) => void
  onPostCreated?: (post: {
    id: string
    title: string
    voteCount: number
    statusId: string | null
    board: { id: string; name: string; slug: string }
  }) => void
  anonymousVotingEnabled?: boolean
  anonymousPostingEnabled?: boolean
}

interface SearchResult {
  posts: WidgetPost[]
}

const searchCache = new Map<string, SearchResult>()

export function WidgetHome({
  initialPosts,
  statuses,
  boards,
  onPostSelect,
  onPostCreated,
  anonymousVotingEnabled = true,
  anonymousPostingEnabled = false,
}: WidgetHomeProps) {
  const {
    ensureSession,
    isIdentified,
    hmacRequired,
    user,
    emitEvent,
    metadata,
    identifyWithEmail,
  } = useWidgetAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const canVote = isIdentified || anonymousVotingEnabled
  const canPost = isIdentified || anonymousPostingEnabled
  const needsEmail = !isIdentified && !hmacRequired && !anonymousPostingEnabled

  // Title input — drives both search and create
  const [title, setTitle] = useState('')
  const [expanded, setExpanded] = useState(false)

  // Create form state
  const [selectedBoardId, setSelectedBoardId] = useState(boards[0]?.id ?? '')
  const [content, setContent] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search state — driven by title
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

  const handleAuthRequired = useCallback(
    (postId: string) => {
      if (!hmacRequired && onPostSelect) {
        onPostSelect(postId)
      } else {
        window.parent.postMessage(
          { type: 'quackback:navigate', url: `${window.location.origin}/auth/login` },
          '*'
        )
      }
    },
    [hmacRequired, onPostSelect]
  )

  // Debounced search driven by title
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const q = title.trim()
    if (!q) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }

    const cached = searchCache.get(q)
    if (cached) {
      setSearchResults(cached)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '5' })
        const res = await fetch(`/api/widget/search?${params}`)
        const json = await res.json()
        const result: SearchResult = { posts: json.data?.posts ?? [] }
        searchCache.set(q, result)
        setSearchResults(result)
      } catch {
        setSearchResults({ posts: [] })
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [title])

  function collapseForm() {
    setExpanded(false)
    setTitle('')
    setContent('')
    setEmail('')
    setName('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !selectedBoardId || isSubmitting) return
    if (needsEmail && !email.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      if (needsEmail) {
        const identified = await identifyWithEmail(email.trim(), name.trim() || undefined)
        if (!identified) {
          setError('Could not verify your email. Please try again.')
          setIsSubmitting(false)
          return
        }
      } else if (!canPost) {
        if (hmacRequired) {
          window.parent.postMessage(
            { type: 'quackback:navigate', url: `${window.location.origin}/auth/login` },
            '*'
          )
          setIsSubmitting(false)
          return
        }
      } else if (!isIdentified) {
        const ok = await ensureSession()
        if (!ok) {
          setError('Could not create session. Please try again.')
          setIsSubmitting(false)
          return
        }
      }

      const { getWidgetAuthHeaders } = await import('@/lib/client/widget-auth')
      const { createPublicPostFn } = await import('@/lib/server/functions/public-posts')
      const result = await createPublicPostFn({
        data: {
          boardId: selectedBoardId,
          title: title.trim(),
          content: content.trim(),
          metadata: metadata ?? undefined,
        },
        headers: getWidgetAuthHeaders(),
      })

      emitEvent('post:created', {
        id: result.id,
        title: result.title,
        board: result.board,
        statusId: result.statusId ?? null,
      })

      onPostCreated?.({
        id: result.id,
        title: result.title,
        voteCount: 0,
        statusId: result.statusId ?? null,
        board: result.board,
      })

      collapseForm()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isTyping = title.trim().length > 0
  const displayPosts = isTyping ? (searchResults?.posts ?? []) : initialPosts
  const canSubmitForm = title.trim() && (!needsEmail || email.trim()) && (canPost || needsEmail)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pt-2 pb-3">
          {/* Create card — portal-style expandable */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Board selector — visible when expanded */}
            {expanded && boards.length > 1 && (
              <div className="flex items-center px-3 pt-2.5 pb-0.5">
                <span className="text-[11px] text-muted-foreground mr-1">Posting to</span>
                <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                  <SelectTrigger
                    size="xs"
                    className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {boards.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs py-1">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Icon + Title row */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              {!expanded && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <PencilIcon className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                placeholder="What's your idea?"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (!expanded && e.target.value) setExpanded(true)
                }}
                onFocus={() => {
                  if (title && !expanded) setExpanded(true)
                }}
                className={cn(
                  'flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/50 placeholder:font-normal caret-primary',
                  expanded ? 'text-base font-semibold' : 'text-sm'
                )}
              />
            </div>

            {/* Expanded: details textarea */}
            {expanded && (
              <div className="px-3 pb-2">
                <textarea
                  placeholder="Add more details..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={10000}
                  rows={3}
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 border-0 outline-none caret-primary resize-none leading-relaxed"
                />
              </div>
            )}

            {/* Expanded: similar posts inside the card */}
            {expanded &&
              isTyping &&
              !isSearching &&
              searchResults &&
              searchResults.posts.length > 0 && (
                <div className="px-3 pb-2">
                  <p className="text-[10px] font-medium text-muted-foreground/60 flex items-center gap-1 mb-1.5">
                    <LightBulbIcon className="w-3 h-3" />
                    Similar ideas
                  </p>
                  <div className="space-y-0.5">
                    {searchResults.posts.slice(0, 3).map((post) => {
                      const status = post.statusId ? (statusMap.get(post.statusId) ?? null) : null
                      return (
                        <div
                          key={post.id}
                          className="flex items-center gap-2 rounded-md hover:bg-muted/30 transition-colors px-1.5 py-1 cursor-pointer"
                          onClick={() => onPostSelect?.(post.id)}
                        >
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <WidgetVoteButton
                              postId={post.id as PostId}
                              voteCount={post.voteCount}
                              onBeforeVote={canVote ? ensureSession : undefined}
                              onAuthRequired={
                                !canVote ? () => handleAuthRequired(post.id) : undefined
                              }
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground line-clamp-1">
                              {post.title}
                            </p>
                            {status && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <span
                                  className="size-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: status.color }}
                                />
                                {status.name}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            {error && (
              <div className="px-3 pb-2">
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              </div>
            )}

            {/* Expanded: footer with identity + submit */}
            {expanded && (
              <div className="border-t border-border bg-muted/30">
                {needsEmail && (
                  <div className="px-3 pt-2 pb-1 flex gap-2">
                    <input
                      type="email"
                      required
                      placeholder="Your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 min-w-0 bg-background rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
                    />
                    <input
                      type="text"
                      placeholder="Name (optional)"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-[100px] bg-background rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="text-[11px] text-muted-foreground truncate mr-2">
                    {user ? (
                      <>
                        Posting as{' '}
                        <span className="font-medium text-foreground">
                          {user.name || user.email}
                        </span>
                      </>
                    ) : needsEmail ? (
                      email.trim() ? (
                        <>
                          Posting as{' '}
                          <span className="font-medium text-foreground">{email.trim()}</span>
                        </>
                      ) : (
                        'Your email is required'
                      )
                    ) : (
                      'Posting anonymously'
                    )}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={collapseForm}
                      className="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmitForm || isSubmitting}
                      className="px-3 py-1 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Post list — below the card */}
          {!expanded && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide px-1 py-1.5">
                {isTyping
                  ? isSearching
                    ? 'Searching...'
                    : displayPosts.length > 0
                      ? 'Similar ideas'
                      : 'No matching ideas'
                  : 'Popular ideas'}
              </p>

              {!isTyping && displayPosts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <LightBulbIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground/70">No ideas yet</p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    Be the first to share one!
                  </p>
                </div>
              )}

              {displayPosts.length > 0 && (
                <div className="space-y-0.5">
                  {displayPosts.map((post) => {
                    const status = post.statusId ? (statusMap.get(post.statusId) ?? null) : null
                    return (
                      <div
                        key={post.id}
                        className="flex items-center gap-2 rounded-lg hover:bg-muted/30 transition-colors px-2 py-1.5 cursor-pointer"
                        onClick={() => onPostSelect?.(post.id)}
                      >
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <WidgetVoteButton
                            postId={post.id as PostId}
                            voteCount={post.voteCount}
                            onBeforeVote={canVote ? ensureSession : undefined}
                            onAuthRequired={
                              !canVote ? () => handleAuthRequired(post.id) : undefined
                            }
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-foreground line-clamp-1">
                            {post.title}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {status && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <span
                                  className="size-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: status.color }}
                                />
                                {status.name}
                              </span>
                            )}
                            {post.board && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                                <Squares2X2Icon className="h-2.5 w-2.5 text-muted-foreground/40" />
                                {post.board.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </form>
  )
}
