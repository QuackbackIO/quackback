/**
 * Team-member post actions for the portal post detail page.
 *
 * Wires the admin post mutations (status, ETA, tags, board, comments
 * lock, delete/restore, title/content edit) to the portal detail cache, one
 * capability per permission key. Gating here is render-only — every server
 * function independently enforces its own permission.
 *
 * Reversible metadata changes apply optimistically to the portal detail query
 * and surface a toast with an Undo action that issues the reverse mutation.
 * Destructive actions stay confirm-first behind their existing dialogs.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import type { BoardId, PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { portalDetailQueries, type PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { portalQueries } from '@/lib/client/queries/portal'
import { postOwnerQueries } from '@/lib/client/queries/post-owner'
import { postVotersQueries } from '@/lib/client/queries/post-voters'
import {
  useChangePostStatusId,
  useChangePostBoard,
  useUpdatePostTags,
  useToggleCommentsLock,
  useDeletePost,
  useRestorePost,
  useUpdatePost,
} from './posts'
import type { EditPostInput } from './portal-post-actions'
import { setPostEtaFn, setPostOwnerFn } from '@/lib/server/functions/posts'
import type { OwnerRef } from '@/lib/server/functions/post-owner-context'
import type { PostTag } from '@/lib/shared/db-types'

/** How long the Undo action stays available on reversible-change toasts. */
const UNDO_TOAST_DURATION_MS = 5000

interface UsePortalTeamPostActionsOptions {
  postId: PostId
  post: PublicPostDetailView | undefined
  boardSlug: string
  /** Called after a team title/content edit is saved (e.g. to close the editor). */
  onEditSaved?: () => void
}

export function usePortalTeamPostActions({
  postId,
  post,
  boardSlug,
  onEditSaved,
}: UsePortalTeamPostActionsOptions) {
  const intl = useIntl()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = usePortalPermissions()

  const canSetStatus = can(PERMISSIONS.POST_SET_STATUS)
  const canSetEta = can(PERMISSIONS.POST_SET_ETA)
  const canSetTags = can(PERMISSIONS.POST_SET_TAGS)
  const canSetBoard = can(PERMISSIONS.POST_SET_BOARD)
  const canSetOwner = can(PERMISSIONS.POST_SET_OWNER)
  const canMerge = can(PERMISSIONS.POST_MERGE)
  const canTeamEdit = can(PERMISSIONS.POST_EDIT)
  const canTeamDelete = can(PERMISSIONS.POST_DELETE)
  // Vote-management tools (voters stack + modal + proxy-vote flow). The list,
  // proxy-vote, remove-vote, and subscription mutations all gate on
  // post.vote_on_behalf. The add-voter member search and create-user branch
  // gate on the broader people.view / people.manage; those affordances are
  // hidden unless the actor ALSO holds them (rather than widening any gate).
  const canVoteOnBehalf = can(PERMISSIONS.POST_VOTE_ON_BEHALF)
  const canSearchPeople = can(PERMISSIONS.PEOPLE_VIEW)
  const canCreatePeople = can(PERMISSIONS.PEOPLE_MANAGE)

  // Option lists for the editors, fetched only when the matching key is held.
  // The portal list endpoints are portal-access-gated, so they are safe for
  // any permission combination (unlike the admin queries, whose view
  // permissions a narrowly-scoped role may not hold).
  const { data: allTags } = useQuery({ ...portalQueries.tags(), enabled: canSetTags })
  const { data: allBoards } = useQuery({ ...portalQueries.boards(), enabled: canSetBoard })

  // Owner (assignee) context. The public post payload carries no owner, so the
  // current owner and the assignable roster are fetched here, each gated on
  // post.set_owner and enabled only when the actor holds it.
  const { data: ownerCandidates } = useQuery({
    ...postOwnerQueries.candidates(),
    enabled: canSetOwner,
  })
  const { data: owner } = useQuery({
    ...postOwnerQueries.forPost(postId),
    enabled: canSetOwner,
  })

  const changeStatus = useChangePostStatusId()
  const changeBoard = useChangePostBoard()
  const updateTags = useUpdatePostTags()
  const toggleCommentsLock = useToggleCommentsLock()
  const deletePost = useDeletePost()
  const restorePost = useRestorePost()
  const updatePost = useUpdatePost()

  const [isMetaUpdating, setIsMetaUpdating] = useState(false)

  const detailKey = portalDetailQueries.postDetail(postId).queryKey

  /** Refresh the portal surfaces that render this post. */
  const invalidatePortal = () => {
    queryClient.invalidateQueries({ queryKey: detailKey })
    queryClient.invalidateQueries({ queryKey: ['portal', 'data'] })
    queryClient.invalidateQueries({ queryKey: ['portal', 'posts'] })
    queryClient.invalidateQueries({ queryKey: ['portal', 'roadmapPosts'] })
  }

  // Voters read from a portal-specific key (not the admin `inbox` cache the
  // vote-management mutations invalidate), so after one lands we refresh that
  // key here and the portal surfaces (the vote count changes on add/remove).
  const votersKey = postVotersQueries.forPost(postId).queryKey
  const invalidateVoters = () => {
    queryClient.invalidateQueries({ queryKey: votersKey })
    invalidatePortal()
  }

  const genericErrorMessage = () =>
    intl.formatMessage({
      id: 'portal.postDetail.team.actionFailed',
      defaultMessage: 'Something went wrong',
    })

  /**
   * Optimistically apply a reversible change to the portal detail cache, run
   * the mutation, then offer Undo on the success toast. On failure the
   * previous cache value is restored.
   */
  const runReversible = async (opts: {
    optimistic: (current: PublicPostDetailView) => PublicPostDetailView
    message: string
    perform: () => Promise<unknown>
    undo?: () => Promise<unknown>
  }) => {
    await queryClient.cancelQueries({ queryKey: detailKey })
    const previous = queryClient.getQueryData<PublicPostDetailView>(detailKey)
    if (previous) {
      queryClient.setQueryData<PublicPostDetailView>(detailKey, opts.optimistic(previous))
    }
    setIsMetaUpdating(true)
    try {
      await opts.perform()
      invalidatePortal()
      const undo = opts.undo
      toast(opts.message, {
        duration: UNDO_TOAST_DURATION_MS,
        action: undo
          ? {
              label: intl.formatMessage({
                id: 'portal.postDetail.team.undo',
                defaultMessage: 'Undo',
              }),
              onClick: () => {
                void undo()
                  .then(() => invalidatePortal())
                  .catch((err: unknown) => {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : intl.formatMessage({
                            id: 'portal.postDetail.team.undoFailed',
                            defaultMessage: "Couldn't undo the change",
                          })
                    )
                  })
              },
            }
          : undefined,
      })
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(detailKey, previous)
      }
      toast.error(err instanceof Error ? err.message : genericErrorMessage())
    } finally {
      setIsMetaUpdating(false)
    }
  }

  // --- Reversible metadata editors (optimistic + undo) ---

  const onStatusChange = canSetStatus
    ? async (statusId: PostStatusId) => {
        const previousStatusId = post?.statusId ?? null
        await runReversible({
          optimistic: (p) => ({ ...p, statusId }),
          message: intl.formatMessage({
            id: 'portal.postDetail.team.statusUpdated',
            defaultMessage: 'Status updated',
          }),
          perform: () => changeStatus.mutateAsync({ postId, statusId }),
          // A post with no prior status has nothing to revert to.
          undo: previousStatusId
            ? () => changeStatus.mutateAsync({ postId, statusId: previousStatusId })
            : undefined,
        })
      }
    : undefined

  const onEtaChange = canSetEta
    ? async (eta: string | null) => {
        const previousEta = post?.eta ? new Date(post.eta).toISOString() : null
        await runReversible({
          optimistic: (p) => ({ ...p, eta }),
          message: eta
            ? intl.formatMessage({
                id: 'portal.postDetail.team.etaUpdated',
                defaultMessage: 'ETA updated',
              })
            : intl.formatMessage({
                id: 'portal.postDetail.team.etaCleared',
                defaultMessage: 'ETA cleared',
              }),
          perform: () => setPostEtaFn({ data: { id: postId, eta } }),
          undo: () => setPostEtaFn({ data: { id: postId, eta: previousEta } }),
        })
      }
    : undefined

  const onTagsChange = canSetTags
    ? async (tagIds: PostTagId[]) => {
        const tags = (allTags ?? []) as PostTag[]
        const previousTagIds = (post?.tags ?? []).map((t) => t.id as PostTagId)
        const tagIdSet = new Set<string>(tagIds)
        await runReversible({
          optimistic: (p) => ({
            ...p,
            tags: tags
              .filter((t) => tagIdSet.has(t.id))
              .map((t) => ({ id: t.id, name: t.name, color: t.color })),
          }),
          message: intl.formatMessage({
            id: 'portal.postDetail.team.tagsUpdated',
            defaultMessage: 'Tags updated',
          }),
          perform: () => updateTags.mutateAsync({ postId, tagIds, allTags: tags }),
          undo: () => updateTags.mutateAsync({ postId, tagIds: previousTagIds, allTags: tags }),
        })
      }
    : undefined

  const onBoardChange = canSetBoard
    ? async (boardId: BoardId) => {
        const previousBoard = post?.board
        const nextBoard = (allBoards ?? []).find((b) => b.id === boardId)
        if (!previousBoard || !nextBoard || nextBoard.id === previousBoard.id) return
        await runReversible({
          optimistic: (p) => ({
            ...p,
            board: { id: nextBoard.id, name: nextBoard.name, slug: nextBoard.slug },
          }),
          message: intl.formatMessage({
            id: 'portal.postDetail.team.boardUpdated',
            defaultMessage: 'Board updated',
          }),
          perform: async () => {
            await changeBoard.mutateAsync({ postId, boardId })
            // The detail URL embeds the board slug; move to the new one so a
            // refresh doesn't 404.
            await navigate({
              to: '/b/$slug/posts/$postId',
              params: { slug: nextBoard.slug, postId },
              replace: true,
            })
          },
          undo: async () => {
            await changeBoard.mutateAsync({ postId, boardId: previousBoard.id as BoardId })
            // Restore the cached board before navigating so the detail loader's
            // slug guard passes ahead of the refetch.
            const detail = queryClient.getQueryData<PublicPostDetailView>(detailKey)
            if (detail) {
              queryClient.setQueryData<PublicPostDetailView>(detailKey, {
                ...detail,
                board: previousBoard,
              })
            }
            await navigate({
              to: '/b/$slug/posts/$postId',
              params: { slug: previousBoard.slug, postId },
              replace: true,
            })
          },
        })
      }
    : undefined

  // Owner assignment targets its own query cache (not the portal detail view),
  // so it applies optimistically there with the same 5s-undo toast shape.
  const ownerKey = postOwnerQueries.forPost(postId).queryKey
  const onOwnerChange = canSetOwner
    ? async (ownerId: PrincipalId | null) => {
        await queryClient.cancelQueries({ queryKey: ownerKey })
        const previous = queryClient.getQueryData<OwnerRef | null>(ownerKey) ?? null
        const previousOwnerId = (previous?.principalId ?? null) as PrincipalId | null
        const next = ownerId
          ? ((ownerCandidates ?? []).find((m) => m.principalId === ownerId) ?? null)
          : null
        queryClient.setQueryData<OwnerRef | null>(ownerKey, next)
        setIsMetaUpdating(true)
        try {
          await setPostOwnerFn({ data: { id: postId, ownerId } })
          queryClient.invalidateQueries({ queryKey: ownerKey })
          invalidatePortal()
          toast(
            ownerId
              ? intl.formatMessage({
                  id: 'portal.postDetail.team.ownerAssigned',
                  defaultMessage: 'Owner assigned',
                })
              : intl.formatMessage({
                  id: 'portal.postDetail.team.ownerUnassigned',
                  defaultMessage: 'Owner unassigned',
                }),
            {
              duration: UNDO_TOAST_DURATION_MS,
              action: {
                label: intl.formatMessage({
                  id: 'portal.postDetail.team.undo',
                  defaultMessage: 'Undo',
                }),
                onClick: () => {
                  void setPostOwnerFn({ data: { id: postId, ownerId: previousOwnerId } })
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ownerKey })
                      invalidatePortal()
                    })
                    .catch((err: unknown) => {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : intl.formatMessage({
                              id: 'portal.postDetail.team.undoFailed',
                              defaultMessage: "Couldn't undo the change",
                            })
                      )
                    })
                },
              },
            }
          )
        } catch (err) {
          queryClient.setQueryData<OwnerRef | null>(ownerKey, previous)
          toast.error(err instanceof Error ? err.message : genericErrorMessage())
        } finally {
          setIsMetaUpdating(false)
        }
      }
    : undefined

  // --- Manage actions (lock, delete/restore) ---

  const onToggleLock = canTeamEdit
    ? () => {
        toggleCommentsLock.mutate(
          { postId, locked: !post?.isCommentsLocked },
          {
            onSuccess: () => invalidatePortal(),
            onError: (err) =>
              toast.error(err instanceof Error ? err.message : genericErrorMessage()),
          }
        )
      }
    : undefined

  const deletePostAsTeam = canTeamDelete
    ? async () => {
        try {
          await deletePost.mutateAsync({ postId })
          // Drop the detail cache so a back-navigation doesn't render the
          // deleted post, then leave for the board feed.
          queryClient.removeQueries({ queryKey: detailKey })
          queryClient.invalidateQueries({ queryKey: ['portal', 'data'] })
          queryClient.invalidateQueries({ queryKey: ['portal', 'posts'] })
          queryClient.invalidateQueries({ queryKey: ['portal', 'roadmapPosts'] })
          toast.success(
            intl.formatMessage({
              id: 'portal.postDetail.team.postDeleted',
              defaultMessage: 'Post deleted',
            })
          )
          await navigate({ to: '/', search: { board: boardSlug } })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : genericErrorMessage())
        }
      }
    : undefined

  const restorePostAsTeam = canTeamDelete
    ? async () => {
        try {
          await restorePost.mutateAsync(postId)
          invalidatePortal()
          toast.success(
            intl.formatMessage({
              id: 'portal.postDetail.team.postRestored',
              defaultMessage: 'Post restored',
            })
          )
        } catch (err) {
          toast.error(err instanceof Error ? err.message : genericErrorMessage())
        }
      }
    : undefined

  // --- Title/content editing (permission-enforced admin path) ---

  const saveEditAsTeam = canTeamEdit
    ? async (input: EditPostInput) => {
        try {
          await updatePost.mutateAsync({
            postId,
            title: input.title,
            content: input.content,
            contentJson: input.contentJson ?? null,
          })
          invalidatePortal()
          toast.success(
            intl.formatMessage({
              id: 'portal.postDetail.team.postUpdated',
              defaultMessage: 'Post updated',
            })
          )
          onEditSaved?.()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : genericErrorMessage())
        }
      }
    : undefined

  return {
    // Permission flags (render-only gating; the server re-checks every call)
    canSetStatus,
    canSetEta,
    canSetTags,
    canSetBoard,
    canSetOwner,
    canMerge,
    canTeamEdit,
    canTeamDelete,
    canVoteOnBehalf,
    canSearchPeople,
    canCreatePeople,
    // Vote-management wiring for the sidebar's voters tools
    votersQuery: canVoteOnBehalf ? postVotersQueries.forPost(postId) : undefined,
    invalidateVoters,
    // Option lists
    allTags,
    allBoards,
    ownerCandidates,
    owner: owner ?? null,
    // Metadata editors
    onStatusChange,
    onEtaChange,
    onTagsChange,
    onBoardChange,
    onOwnerChange,
    isMetaUpdating,
    // Manage actions
    onToggleLock,
    isLockPending: toggleCommentsLock.isPending,
    deletePostAsTeam,
    isTeamDeleting: deletePost.isPending,
    restorePostAsTeam,
    isTeamRestoring: restorePost.isPending,
    // Title/content edit
    saveEditAsTeam,
    isTeamSavingEdit: updatePost.isPending,
    // Cache refresh (e.g. after the merge dialogs close)
    invalidatePortal,
  }
}
