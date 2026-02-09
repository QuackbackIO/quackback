import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { fetchMondayBoardsFn, type MondayBoard } from '@/lib/server/integrations/monday/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface MondayConfigProps {
  integrationId: string
  initialConfig: { boardId?: string }
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'New feedback submitted',
    description: 'Create Monday.com items when users submit new feedback',
  },
]

export function MondayConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: MondayConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [boards, setBoards] = useState<MondayBoard[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [selectedBoard, setSelectedBoard] = useState(initialConfig.boardId || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_CONFIG.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchBoards = useCallback(async () => {
    setLoadingBoards(true)
    setBoardError(null)
    try {
      const result = await fetchMondayBoardsFn()
      setBoards(result)
    } catch {
      setBoardError('Failed to load boards. Please try again.')
    } finally {
      setLoadingBoards(false)
    }
  }, [integrationId])

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleBoardChange = (boardId: string) => {
    setSelectedBoard(boardId)
    updateMutation.mutate({ id: integrationId, config: { boardId } })
  }

  const handleEventToggle = (eventId: string, checked: boolean) => {
    const newSettings = { ...eventSettings, [eventId]: checked }
    setEventSettings(newSettings)
    updateMutation.mutate({
      id: integrationId,
      eventMappings: Object.entries(newSettings).map(([eventType, enabled]) => ({
        eventType,
        enabled,
      })),
    })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-sm text-muted-foreground">
            Turn off to pause all Monday.com synchronization
          </p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="board-select">Monday.com Board</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchBoards}
            disabled={loadingBoards}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingBoards ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {boardError ? (
          <p className="text-sm text-destructive">{boardError}</p>
        ) : (
          <Select
            value={selectedBoard}
            onValueChange={handleBoardChange}
            disabled={loadingBoards || saving || !integrationEnabled}
          >
            <SelectTrigger id="board-select" className="w-full">
              {loadingBoards ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading boards...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a board" />
              )}
            </SelectTrigger>
            <SelectContent>
              {boards.map((board) => (
                <SelectItem key={board.id} value={board.id}>
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          Items will be created in this board when new feedback is submitted.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Events</Label>
        <p className="text-sm text-muted-foreground">
          Choose which events trigger Monday.com actions
        </p>
        <div className="space-y-3 pt-2">
          {EVENT_CONFIG.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-lg border border-border/50 p-3"
            >
              <div>
                <div className="font-medium text-sm">{event.label}</div>
                <div className="text-xs text-muted-foreground">{event.description}</div>
              </div>
              <Switch
                checked={eventSettings[event.id] ?? false}
                onCheckedChange={(checked) => handleEventToggle(event.id, checked)}
                disabled={saving || !integrationEnabled}
              />
            </div>
          ))}
        </div>
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {updateMutation.isError && (
        <div className="text-sm text-destructive">
          {updateMutation.error?.message || 'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
