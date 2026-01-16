import type { BoardId } from '@quackback/ids'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { PencilIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { useCreatePublicPost } from '@/lib/hooks/use-public-posts-query'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { useSimilarPosts } from '@/lib/hooks/use-similar-posts'
import { SimilarPostsCard } from '@/components/public/similar-posts-card'
import { signOut } from '@/lib/auth/client'
import type { JSONContent } from '@tiptap/react'

interface BoardOption {
  id: string
  name: string
  slug: string
}

interface FeedbackHeaderProps {
  workspaceName: string
  boards: BoardOption[]
  defaultBoardId?: string
  user?: { name: string | null; email: string } | null
  onPostCreated?: (postId: string, boardSlug: string) => void
}

export function FeedbackHeader({
  boards,
  defaultBoardId,
  user,
  onPostCreated,
}: FeedbackHeaderProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const { openAuthPopover } = useAuthPopover()

  const createPost = useCreatePublicPost()

  // Get user from session
  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : user

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
    enabled: expanded,
  })

  // Board selection - only default if on a specific board page
  const [selectedBoardId, setSelectedBoardId] = useState(defaultBoardId || '')

  // Sync selectedBoardId when defaultBoardId prop changes
  useEffect(() => {
    if (defaultBoardId) {
      setSelectedBoardId(defaultBoardId)
    }
  }, [defaultBoardId])

  const [title, setTitle] = useState('')
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Focus title input when form expands
  useEffect(() => {
    if (expanded && titleInputRef.current) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
      })
    }
  }, [expanded])

  // Find similar posts as user types (for duplicate detection)
  // Searches across ALL boards to find potential duplicates
  const { posts: similarPosts } = useSimilarPosts({
    title,
    enabled: expanded,
  })

  const handleContentChange = useCallback(function (json: JSONContent): void {
    setContentJson(json)
  }, [])

  async function handleSubmit() {
    setError('')

    if (!selectedBoardId) {
      setError('Please select a board')
      return
    }

    if (!title.trim()) {
      setError('Please add a title')
      return
    }

    const plainText = contentJson ? richTextToPlainText(contentJson) : ''
    if (!plainText.trim()) {
      setError('Please add a description')
      return
    }

    try {
      const result = await createPost.mutateAsync({
        boardId: selectedBoardId as BoardId,
        title: title.trim(),
        content: plainText,
        contentJson,
      })

      resetForm()
      setExpanded(false)
      onPostCreated?.(result.id, result.board.slug)

      toast.success('Feedback submitted', {
        action: {
          label: 'View',
          onClick: () => router.navigate({ to: `/b/${result.board.slug}/posts/${result.id}` }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    }
  }

  function resetForm() {
    setSelectedBoardId(defaultBoardId || '')
    setTitle('')
    setContentJson(null)
    setError('')
  }

  function handleCancel() {
    resetForm()
    setExpanded(false)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <motion.div
      className="bg-card border border-border rounded-lg mb-5 shadow-sm overflow-hidden"
      initial={false}
      animate={{
        boxShadow: expanded
          ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
          : '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      }}
      transition={{ duration: 0.2 }}
      onKeyDown={handleKeyDown}
    >
      {/* Board selector - above title when expanded */}
      <AnimatePresence>
        {expanded && boards.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center px-4 sm:px-5 pt-3 pb-1">
              <span className="text-xs text-muted-foreground mr-1">Posting to</span>
              <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                <SelectTrigger
                  size="xs"
                  className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                >
                  <SelectValue placeholder="Select a board" />
                </SelectTrigger>
                <SelectContent align="start">
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id} className="text-xs py-1">
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Icon + Title Row - Always visible */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Icon - fades out when expanded */}
        <AnimatePresence>
          {!expanded && (
            <motion.div
              initial={false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, width: 0, marginRight: -12 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"
            >
              <PencilIcon className="w-4 h-4 text-primary" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Title input - always visible, grows when expanded */}
        <motion.input
          ref={titleInputRef}
          type="text"
          placeholder="What's your idea?"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!expanded) setExpanded(true)
          }}
          onFocus={() => !expanded && setExpanded(true)}
          className="flex-1 bg-transparent border-0 outline-none text-foreground font-semibold placeholder:text-muted-foreground/60 placeholder:font-normal caret-primary"
          initial={false}
          animate={{
            fontSize: expanded ? '1.25rem' : '1rem',
            lineHeight: expanded ? '1.75rem' : '1.5rem',
          }}
          transition={{ duration: 0.2 }}
        />
      </div>

      {/* Expandable content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {/* Error message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 sm:px-5"
                >
                  <div className="[border-radius:calc(var(--radius)*0.8)] bg-destructive/10 px-3 py-2 text-sm text-destructive mb-2">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Rich text editor */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.15 }}
              className="px-4 sm:px-5 pb-4"
            >
              <RichTextEditor
                value={contentJson || ''}
                onChange={handleContentChange}
                placeholder="Add more details..."
                minHeight="150px"
                borderless
                toolbarPosition="bottom"
              />
            </motion.div>

            {/* Similar posts card - shown above footer as pre-submit prompt */}
            <SimilarPostsCard
              posts={similarPosts}
              show={title.length >= 5}
              className="px-4 sm:px-5 pb-3"
            />

            {/* Footer with auth and actions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
              className="flex items-center justify-between px-4 sm:px-5 py-3 border-t bg-muted/30"
            >
              {effectiveUser ? (
                <p className="text-xs text-muted-foreground">
                  Posting as{' '}
                  <span className="font-medium text-foreground">
                    {effectiveUser.name || effectiveUser.email}
                  </span>
                  {' ('}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={async () => {
                      await signOut()
                      router.invalidate()
                    }}
                  >
                    sign out
                  </button>
                  {')'}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthPopover({ mode: 'login' })}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Sign in to post
                </button>
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={createPost.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={createPost.isPending || !effectiveUser}
                  title={!effectiveUser ? 'Please sign in to submit feedback' : undefined}
                  className="portal-submit-button bg-[var(--portal-button-background)] text-[var(--portal-button-foreground)] hover:bg-[var(--portal-button-background)]/90"
                >
                  {createPost.isPending ? 'Submitting...' : 'Submit'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
