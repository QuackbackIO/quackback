import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/roadmap.index'

export function usePublicRoadmapSelection(): {
  selectedRoadmapId: string | null
  setSelectedRoadmap: (roadmapId: string | null) => void
} {
  const navigate = useNavigate()
  const { roadmap } = Route.useSearch()

  function setSelectedRoadmap(roadmapId: string | null): void {
    void navigate({
      to: '/roadmap',
      search: { roadmap: roadmapId ?? undefined },
      replace: true,
    })
  }

  return { selectedRoadmapId: roadmap ?? null, setSelectedRoadmap }
}
