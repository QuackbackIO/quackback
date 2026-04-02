'use client'

import { useIntl, FormattedMessage } from 'react-intl'
import { EllipsisVerticalIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface PostActionsMenuProps {
  canEdit: boolean
  canDelete: boolean
  editReason?: string | null
  deleteReason?: string | null
  onEdit: () => void
  onDelete: () => void
}

export function PostActionsMenu({
  canEdit,
  canDelete,
  editReason,
  deleteReason,
  onEdit,
  onDelete,
}: PostActionsMenuProps) {
  const intl = useIntl()

  // Don't render the menu if user can't do anything
  if (!canEdit && !canDelete) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <EllipsisVerticalIcon className="size-5" />
          <span className="sr-only">
            {intl.formatMessage({
              id: 'portal.postDetail.postActions.ariaLabel',
              defaultMessage: 'Post actions',
            })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Edit option */}
        {canEdit ? (
          <DropdownMenuItem onClick={onEdit}>
            <PencilIcon className="size-4" />
            <FormattedMessage id="portal.postDetail.postActions.edit" defaultMessage="Edit" />
          </DropdownMenuItem>
        ) : editReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem disabled>
                <PencilIcon className="size-4" />
                <FormattedMessage id="portal.postDetail.postActions.edit" defaultMessage="Edit" />
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">{editReason}</TooltipContent>
          </Tooltip>
        ) : null}

        {/* Delete option */}
        {canDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <TrashIcon className="size-4" />
            <FormattedMessage id="portal.postDetail.postActions.delete" defaultMessage="Delete" />
          </DropdownMenuItem>
        ) : deleteReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem disabled>
                <TrashIcon className="size-4" />
                <FormattedMessage
                  id="portal.postDetail.postActions.delete"
                  defaultMessage="Delete"
                />
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">{deleteReason}</TooltipContent>
          </Tooltip>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
