import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeftIcon, Loader2Icon } from 'lucide-react'
import { useAppContext } from './use-app-context'

interface Board {
  id: string
  name: string
  slug: string
}

interface SidebarCreateFormProps {
  initialTitle?: string
  onBack: () => void
  onCreated: () => void
}

export function SidebarCreateForm({ initialTitle, onBack, onCreated }: SidebarCreateFormProps) {
  const { appFetch, ticket } = useAppContext()
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState('')
  const [title, setTitle] = useState(initialTitle ?? '')
  const [description, setDescription] = useState('')
  const [linkToTicket, setLinkToTicket] = useState(true)
  const [voteOnBehalf, setVoteOnBehalf] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    appFetch('/api/v1/apps/boards')
      .then((res) => res.json())
      .then((data) => {
        const boardList = data.data?.boards ?? []
        setBoards(boardList)
        if (boardList.length > 0 && !boardId) {
          setBoardId(boardList[0].id)
        }
      })
      .catch(() => {})
  }, [appFetch])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!boardId || !title.trim()) return

    setSubmitting(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        boardId,
        title: title.trim(),
        content: description.trim(),
      }

      if (linkToTicket) {
        body.link = {
          integrationType: 'zendesk',
          externalId: ticket.id,
          externalUrl: `zendesk:ticket:${ticket.id}`,
        }
      }

      if (voteOnBehalf && ticket.requesterEmail) {
        body.requester = {
          email: ticket.requesterEmail,
          name: ticket.requesterName || undefined,
        }
      }

      const res = await appFetch('/api/v1/apps/posts', {
        method: 'POST',
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error?.message ?? `Failed (${res.status})`)
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create post')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        New Post
      </button>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="board" className="text-xs">
            Board
          </Label>
          <Select value={boardId} onValueChange={setBoardId}>
            <SelectTrigger className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="title" className="text-xs">
            Title
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title"
            className="mt-1 h-9 text-sm"
            required
            maxLength={200}
          />
        </div>

        <div>
          <Label htmlFor="description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            className="mt-1 min-h-[80px] text-sm"
            maxLength={10000}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="link-ticket"
              checked={linkToTicket}
              onCheckedChange={(v) => setLinkToTicket(!!v)}
            />
            <label htmlFor="link-ticket" className="text-xs">
              Link to ticket #{ticket.id}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="vote-behalf"
              checked={voteOnBehalf}
              onCheckedChange={(v) => setVoteOnBehalf(!!v)}
            />
            <label htmlFor="vote-behalf" className="text-xs">
              Vote on behalf of requester
            </label>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={submitting || !title.trim()}>
          {submitting ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Post'
          )}
        </Button>
      </form>
    </div>
  )
}
