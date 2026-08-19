/**
 * One-action AI tag backfill on the tags settings page: an admin picks a
 * board and applies every tag carrying an AI prompt to that board's existing
 * untagged posts. The server batches the work, so a "more remain" result
 * invites a repeat click rather than failing. Hidden when no tag carries an
 * AI prompt — there is nothing to apply.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { backfillAiTagsFn } from '@/lib/server/functions/post-tags'
import type { Board, PostTag } from '@/lib/shared/db-types'

interface AiBackfillCardProps {
  tags: PostTag[]
  boards: Board[]
}

export function AiBackfillCard({ tags, boards }: AiBackfillCardProps) {
  const [boardId, setBoardId] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  const promptedCount = tags.filter((t) => t.aiPrompt?.trim()).length
  if (promptedCount === 0) return null

  async function handleRun() {
    if (!boardId) return
    setIsRunning(true)
    try {
      const result = await backfillAiTagsFn({ data: { boardId } })
      if (result.scanned === 0) {
        toast.info('No untagged posts on this board')
      } else {
        toast.success(
          `Tagged ${result.tagged} of ${result.scanned} untagged posts` +
            (result.hasMore ? ' — more remain, run again to continue' : '')
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply AI tags')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <SettingsCard
      title="AI auto-tagging"
      description={`${promptedCount} ${promptedCount === 1 ? 'tag has' : 'tags have'} an AI rule. New posts are tagged automatically; apply the same rules to existing untagged posts.`}
      contentClassName="p-4"
    >
      <div className="flex items-center gap-2">
        <Select value={boardId} onValueChange={setBoardId}>
          <SelectTrigger size="sm" className="w-56" aria-label="Board">
            <SelectValue placeholder="Choose a board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.id}>
                {board.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleRun} disabled={!boardId || isRunning}>
          <SparklesIcon className="h-3.5 w-3.5" />
          {isRunning ? 'Applying...' : 'Apply to untagged posts'}
        </Button>
      </div>
    </SettingsCard>
  )
}
