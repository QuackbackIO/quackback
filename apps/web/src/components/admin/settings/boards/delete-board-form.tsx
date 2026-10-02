import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter, useNavigate } from '@tanstack/react-router'
import { useDeleteBoard } from '@/lib/client/mutations'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import type { BoardId } from '@quackback/ids'

interface Board {
  id: BoardId
  name: string
  slug: string
}

interface DeleteBoardFormProps {
  board: Board
}

/** The danger zone row: one outline-red button, with the board name asked for in the dialog. */
export function DeleteBoardForm({ board }: DeleteBoardFormProps) {
  const router = useRouter()
  const navigate = useNavigate()
  const mutation = useDeleteBoard()
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setConfirmName('')
  }

  function onConfirm() {
    if (confirmName !== board.name) return
    mutation.mutate(
      { id: board.id },
      {
        onSuccess: () => {
          setOpen(false)
          void navigate({ to: '/admin/settings/boards', search: {} })
          router.invalidate()
        },
        onError: () => toast.error("Couldn't delete the board. Try again."),
      }
    )
  }

  return (
    <>
      <SettingRows>
        <SettingRow
          label="Delete this board"
          description="Removes the board and its posts, votes and comments."
          control={
            <Button
              type="button"
              variant="outline-destructive"
              size="sm"
              onClick={() => setOpen(true)}
            >
              Delete board
            </Button>
          }
        />
      </SettingRows>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Delete board?"
        description="This permanently deletes the board and everything on it. It cannot be undone."
        variant="destructive"
        confirmLabel="Delete board"
        confirmDisabled={confirmName !== board.name}
        isPending={mutation.isPending}
        onConfirm={onConfirm}
      >
        <div className="space-y-2">
          <Label htmlFor="confirm-board-name">
            Type <span className="font-mono font-semibold">{board.name}</span> to confirm
          </Label>
          <Input
            id="confirm-board-name"
            placeholder={board.name}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </div>
      </ConfirmDialog>
    </>
  )
}
