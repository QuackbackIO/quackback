'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpsertUserMapping, useDeleteUserMapping } from '@/lib/client/mutations'
import { fetchUserMappingsFn } from '@/lib/server/functions/integrations'
import { searchMembersFn } from '@/lib/server/functions/admin'

interface GitHubUserMappingsProps {
  integrationId: string
  disabled?: boolean
}

export function GitHubUserMappings({ integrationId, disabled }: GitHubUserMappingsProps) {
  const mappingsQuery = useQuery({
    queryKey: ['admin', 'integrations', integrationId, 'user-mappings'],
    queryFn: () => fetchUserMappingsFn({ data: { integrationId } }),
  })
  const membersQuery = useQuery({
    queryKey: ['admin', 'members-search'],
    queryFn: () => searchMembersFn({ data: {} }),
  })

  const upsertMutation = useUpsertUserMapping()
  const deleteMutation = useDeleteUserMapping()

  const [newUsername, setNewUsername] = useState('')
  const [newPrincipalId, setNewPrincipalId] = useState('')

  const mappings = mappingsQuery.data ?? []
  const members = membersQuery.data ?? []

  const handleAdd = () => {
    if (!newUsername.trim() || !newPrincipalId) return
    upsertMutation.mutate(
      {
        integrationId,
        externalUsername: newUsername.trim(),
        principalId: newPrincipalId,
      },
      {
        onSuccess: () => {
          setNewUsername('')
          setNewPrincipalId('')
          mappingsQuery.refetch()
        },
      }
    )
  }

  const handleDelete = (externalUsername: string) => {
    deleteMutation.mutate(
      { integrationId, externalUsername },
      { onSuccess: () => mappingsQuery.refetch() }
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">User mappings</Label>
        <p className="text-sm text-muted-foreground">
          Map GitHub usernames to workspace members for assignee sync
        </p>
      </div>

      {mappings.length > 0 && (
        <div className="rounded-lg border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">GitHub username</th>
                <th className="px-3 py-2 text-left font-medium">Workspace member</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => {
                const member = members.find((mem) => mem.id === m.principalId)
                return (
                  <tr key={m.externalUsername} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">@{m.externalUsername}</td>
                    <td className="px-3 py-2">{member?.name ?? member?.email ?? m.principalId}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(m.externalUsername)}
                        disabled={disabled || deleteMutation.isPending}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">GitHub username</Label>
          <Input
            placeholder="octocat"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            disabled={disabled}
            className="h-9"
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Workspace member</Label>
          <Select value={newPrincipalId} onValueChange={setNewPrincipalId} disabled={disabled}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((mem) => (
                <SelectItem key={mem.id} value={mem.id}>
                  {mem.name ?? mem.email ?? mem.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={disabled || !newUsername.trim() || !newPrincipalId || upsertMutation.isPending}
          className="h-9"
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  )
}
