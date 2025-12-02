'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface Board {
  id: string
  name: string
  slug: string
}

interface DeleteBoardFormProps {
  board: Board
}

export function DeleteBoardForm({ board }: DeleteBoardFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmName, setConfirmName] = useState('')

  const canDelete = confirmName === board.name

  async function handleDelete() {
    if (!canDelete) return

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete board')
      }

      router.push('/admin/settings/boards')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete board')
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md bg-destructive/10 p-4">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-destructive">Delete this board</p>
          <p className="text-sm text-muted-foreground">
            Once you delete a board, there is no going back. All feedback, votes, and
            comments associated with this board will be permanently deleted.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="confirmName" className="text-sm font-medium">
          Type <span className="font-mono font-bold">{board.name}</span> to confirm
        </label>
        <Input
          id="confirmName"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={board.name}
        />
      </div>

      <Button
        variant="destructive"
        onClick={handleDelete}
        disabled={!canDelete || isLoading}
      >
        {isLoading ? 'Deleting...' : 'Delete board'}
      </Button>
    </div>
  )
}
