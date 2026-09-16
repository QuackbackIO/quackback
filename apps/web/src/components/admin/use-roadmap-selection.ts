import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/roadmap'

export function useRoadmapSelection(): {
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

  const { roadmap } = search

  return { selectedRoadmapId: roadmap ?? null, setSelectedRoadmap }
}
