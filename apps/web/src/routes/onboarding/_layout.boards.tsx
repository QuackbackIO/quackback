import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon, CheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createBoardsBatchFn } from '@/lib/server-functions/boards'
import { checkOnboardingState } from '@/lib/server-functions/admin'
import { listBoardsForOnboarding } from '@/lib/server-functions/onboarding'
import {
  getBoardsForUseCase,
  getBoardOptionsForUseCase,
  getUseCaseLabel,
} from '@/components/onboarding/default-boards'
import type { UseCaseType } from '@quackback/db/types'

export const Route = createFileRoute('/onboarding/_layout/boards')({
  loader: async ({ context }) => {
    const { session } = context

    if (!session?.user) {
      throw redirect({ to: '/onboarding/account' })
    }

    const state = await checkOnboardingState({ data: session.user.id })

    if (state.needsInvitation) {
      throw redirect({ to: '/auth/login' })
    }

    if (state.isOnboardingComplete) {
      throw redirect({ to: '/admin' })
    }

    if (!state.setupState?.steps?.workspace) {
      throw redirect({ to: '/onboarding/workspace' })
    }

    const existingBoards = await listBoardsForOnboarding()

    return {
      existingBoards,
      useCase: state.setupState?.useCase as UseCaseType | undefined,
    }
  },
  component: BoardsStep,
})

function BoardsStep() {
  const navigate = useNavigate()
  const { existingBoards, useCase } = Route.useLoaderData()

  // Get board options filtered by use case
  const boardOptions = getBoardOptionsForUseCase(useCase)
  const existingBoardNames = new Set(existingBoards.map((b) => b.name.toLowerCase()))

  // Initialize selection: pre-select all boards for the use case that don't already exist
  const initialSelection =
    existingBoards.length > 0
      ? new Set(
          boardOptions.filter((b) => existingBoardNames.has(b.name.toLowerCase())).map((b) => b.id)
        )
      : getBoardsForUseCase(useCase)

  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(initialSelection)
  const [customBoards, setCustomBoards] = useState<Array<{ name: string; description: string }>>([])
  const [newCustomBoard, setNewCustomBoard] = useState({ name: '', description: '' })
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  function toggleBoard(boardId: string) {
    setSelectedBoards((prev) => {
      const next = new Set(prev)
      if (next.has(boardId)) {
        next.delete(boardId)
      } else {
        next.add(boardId)
      }
      return next
    })
  }

  function addCustomBoard() {
    const name = newCustomBoard.name.trim()
    if (name) {
      setCustomBoards((prev) => [...prev, { name, description: newCustomBoard.description.trim() }])
      setNewCustomBoard({ name: '', description: '' })
      setShowCustomForm(false)
    }
  }

  async function handleContinue() {
    setIsLoading(true)
    setError('')

    try {
      const defaultBoardsToCreate = boardOptions
        .filter((b) => selectedBoards.has(b.id) && !existingBoardNames.has(b.name.toLowerCase()))
        .map((b) => ({ name: b.name, description: b.description }))

      const customBoardsToCreate = customBoards.filter(
        (b) => !existingBoardNames.has(b.name.toLowerCase())
      )

      const boardsToCreate = [...defaultBoardsToCreate, ...customBoardsToCreate]

      await createBoardsBatchFn({ data: { boards: boardsToCreate } })

      navigate({ to: '/onboarding/complete' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  const newBoardsCount =
    boardOptions.filter(
      (b) => selectedBoards.has(b.id) && !existingBoardNames.has(b.name.toLowerCase())
    ).length + customBoards.filter((b) => !existingBoardNames.has(b.name.toLowerCase())).length

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">Create your first boards</h1>
        <p className="text-muted-foreground">
          Boards help organize feedback by topic.
          {useCase && ` Here are some suggestions for ${getUseCaseLabel(useCase)}.`}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive text-center">
          {error}
        </div>
      )}

      {/* Board options */}
      <div className="space-y-2 mb-6">
        {boardOptions.map((board) => {
          const isSelected = selectedBoards.has(board.id)
          const alreadyExists = existingBoardNames.has(board.name.toLowerCase())

          return (
            <button
              key={board.id}
              type="button"
              onClick={() => !alreadyExists && toggleBoard(board.id)}
              disabled={isLoading || alreadyExists}
              className={`
                w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all duration-200
                disabled:cursor-not-allowed
                ${alreadyExists ? 'opacity-50' : ''}
                ${
                  isSelected && !alreadyExists
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50 bg-card/50 hover:border-border hover:bg-card/80'
                }
              `}
            >
              <div
                className={`
                  h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${isSelected || alreadyExists ? 'bg-primary border-primary' : 'border-muted-foreground/40'}
                `}
              >
                {(isSelected || alreadyExists) && (
                  <CheckIcon className="h-3 w-3 text-primary-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{board.name}</div>
                <div className="text-xs text-muted-foreground">{board.description}</div>
              </div>
            </button>
          )
        })}

        {/* Custom boards */}
        {customBoards.map((board, index) => (
          <div
            key={`custom-${index}`}
            className="w-full flex items-center gap-3 p-4 rounded-xl border border-primary bg-primary/5"
          >
            <div className="h-5 w-5 rounded border-2 bg-primary border-primary flex items-center justify-center shrink-0">
              <CheckIcon className="h-3 w-3 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{board.name}</div>
              {board.description && (
                <div className="text-xs text-muted-foreground">{board.description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCustomBoards((prev) => prev.filter((_, i) => i !== index))}
              disabled={isLoading}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ))}

        {/* Add custom board */}
        {showCustomForm ? (
          <div className="p-4 rounded-xl border border-dashed border-border space-y-3">
            <Input
              type="text"
              value={newCustomBoard.name}
              onChange={(e) => setNewCustomBoard((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Board name"
              autoFocus
              disabled={isLoading}
              className="h-10"
            />
            <Input
              type="text"
              value={newCustomBoard.description}
              onChange={(e) =>
                setNewCustomBoard((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Description (optional)"
              disabled={isLoading}
              className="h-10"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCustomForm(false)
                  setNewCustomBoard({ name: '', description: '' })
                }}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={addCustomBoard}
                disabled={isLoading || !newCustomBoard.name.trim()}
              >
                Add
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCustomForm(true)}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-all disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            <span className="text-sm">Add custom board</span>
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 max-w-sm mx-auto">
        <Button
          type="button"
          variant="ghost"
          onClick={handleContinue}
          disabled={isLoading}
          className="flex-1 h-11"
        >
          Skip
        </Button>
        <Button type="button" onClick={handleContinue} disabled={isLoading} className="flex-1 h-11">
          {isLoading ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : newBoardsCount === 0 ? (
            'Continue'
          ) : (
            `Create ${newBoardsCount} board${newBoardsCount !== 1 ? 's' : ''}`
          )}
        </Button>
      </div>
    </div>
  )
}
