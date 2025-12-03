'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { InboxLayout } from './inbox-layout'
import { InboxFiltersPanel } from './inbox-filters'
import { InboxPostList } from './inbox-post-list'
import { InboxPostDetail } from './inbox-post-detail'
import { CreatePostDialog } from './create-post-dialog'
import { useInboxFilters, type InboxFilters } from './use-inbox-filters'
import type {
  PostListItem,
  PostStatus,
  Board,
  Tag,
  InboxPostListResult,
  PostStatusEntity,
} from '@quackback/db'

interface TeamMember {
  id: string
  name: string
  email: string
  image?: string | null
}

interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

interface PostDetails {
  id: string
  title: string
  content: string
  status: PostStatus
  voteCount: number
  // Member-scoped identity (Hub-and-Spoke model)
  memberId: string | null
  ownerMemberId: string | null
  // Legacy/anonymous identity fields
  authorName: string | null
  authorEmail: string | null
  ownerId: string | null
  createdAt: Date
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  comments: CommentWithReplies[]
  officialResponse: OfficialResponse | null
}

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface CommentWithReplies {
  id: string
  postId: string
  parentId: string | null
  // Member-scoped identity (Hub-and-Spoke model)
  memberId: string | null
  // Legacy/anonymous identity fields
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  replies: CommentWithReplies[]
  reactions: CommentReaction[]
}

interface InboxContainerProps {
  organizationId: string
  initialPosts: InboxPostListResult
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
}

export function InboxContainer({
  organizationId,
  initialPosts,
  boards,
  tags,
  statuses,
  members,
}: InboxContainerProps) {
  const router = useRouter()
  const {
    filters,
    setFilters,
    clearFilters,
    selectedPostId,
    setSelectedPostId: setSelectedPostIdNuqs,
    hasActiveFilters,
  } = useInboxFilters()

  // Wrapper to match expected signature (nuqs returns Promise, components expect void)
  const setSelectedPostId = (id: string | null) => {
    void setSelectedPostIdNuqs(id)
  }

  const [posts, setPosts] = useState<PostListItem[]>(initialPosts.items)
  const [total, setTotal] = useState(initialPosts.total)
  const [hasMore, setHasMore] = useState(initialPosts.hasMore)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const [selectedPost, setSelectedPost] = useState<PostDetails | null>(null)
  const [isLoadingPost, setIsLoadingPost] = useState(false)

  // Track if this is the initial mount to skip fetching (we have initialPosts)
  const isInitialMount = useRef(true)

  // Create a stable string key for filters to use in useEffect dependencies
  const filtersKey = useMemo(
    () =>
      JSON.stringify({
        search: filters.search,
        status: filters.status,
        board: filters.board,
        tags: filters.tags,
        owner: filters.owner,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        minVotes: filters.minVotes,
        sort: filters.sort,
      }),
    [filters]
  )

  // Fetch posts - accepts filters as parameter to avoid dependency issues
  const fetchPosts = useCallback(
    async (pageNum: number, currentFilters: InboxFilters, append = false) => {
      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
      }

      try {
        const params = new URLSearchParams()
        params.set('organizationId', organizationId)
        params.set('page', pageNum.toString())

        if (currentFilters.search) params.set('search', currentFilters.search)
        if (currentFilters.sort) params.set('sort', currentFilters.sort)
        currentFilters.status?.forEach((s) => params.append('status', s))
        currentFilters.board?.forEach((b) => params.append('board', b))
        currentFilters.tags?.forEach((t) => params.append('tags', t))
        if (currentFilters.owner) params.set('owner', currentFilters.owner)
        if (currentFilters.dateFrom) params.set('dateFrom', currentFilters.dateFrom)
        if (currentFilters.dateTo) params.set('dateTo', currentFilters.dateTo)
        if (currentFilters.minVotes !== undefined)
          params.set('minVotes', currentFilters.minVotes.toString())

        const response = await fetch(`/api/posts?${params.toString()}`)
        if (!response.ok) throw new Error('Failed to fetch posts')

        const data: InboxPostListResult = await response.json()

        if (append) {
          setPosts((prev) => [...prev, ...data.items])
        } else {
          setPosts(data.items)
        }
        setTotal(data.total)
        setHasMore(data.hasMore)
        setPage(pageNum)
      } catch (error) {
        console.error('Error fetching posts:', error)
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [organizationId]
  )

  // Refetch when filters change (skip initial mount since we have initialPosts)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    fetchPosts(1, filters)
  }, [filtersKey, fetchPosts, filters])

  // Fetch post details when selection changes
  useEffect(() => {
    if (!selectedPostId) {
      setSelectedPost(null)
      return
    }

    const fetchPostDetails = async () => {
      setIsLoadingPost(true)
      try {
        const response = await fetch(
          `/api/posts/${selectedPostId}?organizationId=${organizationId}`
        )
        if (!response.ok) throw new Error('Failed to fetch post')
        const data = await response.json()
        setSelectedPost(data)
      } catch (error) {
        console.error('Error fetching post details:', error)
        setSelectedPost(null)
      } finally {
        setIsLoadingPost(false)
      }
    }

    fetchPostDetails()
  }, [selectedPostId, organizationId])

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      fetchPosts(page + 1, filters, true)
    }
  }, [fetchPosts, hasMore, isLoadingMore, page, filters])

  const handleStatusChange = async (status: PostStatus) => {
    if (!selectedPostId) return
    try {
      const response = await fetch(`/api/posts/${selectedPostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update status')

      // Update local state
      setSelectedPost((prev) => (prev ? { ...prev, status } : null))
      setPosts((prev) => prev.map((p) => (p.id === selectedPostId ? { ...p, status } : p)))
      router.refresh()
    } catch (error) {
      console.error('Error updating status:', error)
    }
  }

  const handleOwnerChange = async (ownerId: string | null) => {
    if (!selectedPostId) return
    try {
      const response = await fetch(`/api/posts/${selectedPostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update owner')

      setSelectedPost((prev) => (prev ? { ...prev, ownerId } : null))
      router.refresh()
    } catch (error) {
      console.error('Error updating owner:', error)
    }
  }

  const handleTagsChange = async (tagIds: string[]) => {
    if (!selectedPostId) return
    try {
      const response = await fetch(`/api/posts/${selectedPostId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update tags')

      const newTags = tags.filter((t) => tagIds.includes(t.id))
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              tags: newTags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
            }
          : null
      )
      setPosts((prev) =>
        prev.map((p) =>
          p.id === selectedPostId
            ? {
                ...p,
                tags: newTags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
              }
            : p
        )
      )
      router.refresh()
    } catch (error) {
      console.error('Error updating tags:', error)
    }
  }

  const handleOfficialResponseChange = async (response: string | null) => {
    if (!selectedPostId) return
    try {
      const res = await fetch(`/api/posts/${selectedPostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officialResponse: response, organizationId }),
      })
      if (!res.ok) throw new Error('Failed to update official response')

      const updatedPost = await res.json()
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              officialResponse: updatedPost.officialResponse
                ? {
                    content: updatedPost.officialResponse,
                    authorName: updatedPost.officialResponseAuthorName,
                    respondedAt: updatedPost.officialResponseAt,
                  }
                : null,
            }
          : null
      )
      router.refresh()
    } catch (error) {
      console.error('Error updating official response:', error)
    }
  }

  return (
    <InboxLayout
      hasActiveFilters={hasActiveFilters}
      hasSelectedPost={!!selectedPostId}
      filters={
        <InboxFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          onClearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          boards={boards}
          tags={tags}
          statuses={statuses}
          members={members}
          headerAction={
            <CreatePostDialog
              organizationId={organizationId}
              boards={boards}
              tags={tags}
              statuses={statuses}
              onPostCreated={() => fetchPosts(1, filters)}
            />
          }
        />
      }
      postList={
        <InboxPostList
          posts={posts}
          statuses={statuses}
          total={total}
          hasMore={hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
          onLoadMore={handleLoadMore}
          sort={filters.sort}
          onSortChange={(sort) => setFilters({ sort })}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      }
      postDetail={
        <InboxPostDetail
          post={selectedPost}
          isLoading={isLoadingPost}
          members={members}
          allTags={tags}
          statuses={statuses}
          onClose={() => setSelectedPostId(null)}
          onStatusChange={handleStatusChange}
          onOwnerChange={handleOwnerChange}
          onTagsChange={handleTagsChange}
          onOfficialResponseChange={handleOfficialResponseChange}
        />
      }
    />
  )
}
