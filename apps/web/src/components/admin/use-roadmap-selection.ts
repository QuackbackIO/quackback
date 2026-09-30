import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/roadmap'

/**
 * The roadmap the admin board shows: the one the URL names, else the first.
 * The default is derived rather than written into the URL, so landing on the
 * board does not navigate (and re-run every route guard) a second time.
 */
export function useRoadmapSelection(roadmaps: readonly { id: string }[] | undefined): {
  selectedRoadmapId: string | null
  setSelectedRoadmap: (roadmapId: string | null) => void
} {
  const navigate = useNavigate()
  const search = Route.useSearch()

  function setSelectedRoadmap(roadmapId: string | null): void {
    void navigate({
      to: '/admin/roadmap',
      search: { ...search, roadmap: roadmapId ?? undefined },
      replace: true,
    })
  }

  return { selectedRoadmapId: search.roadmap ?? roadmaps?.[0]?.id ?? null, setSelectedRoadmap }
}
