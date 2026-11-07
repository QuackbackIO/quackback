import { useNavigate, useSearch } from '@tanstack/react-router'
import type { RoadmapSearch } from '@/routes/_portal/roadmap.index'

export function usePublicRoadmapSelection(): {
  selectedRoadmapId: string | null
  setSelectedRoadmap: (roadmapId: string | null) => void
} {
  const navigate = useNavigate()
  const { roadmap } = useSearch({ strict: false }) as RoadmapSearch

  function setSelectedRoadmap(roadmapId: string | null): void {
    void navigate({
      to: '.',
      search: { roadmap: roadmapId ?? undefined },
      replace: true,
    })
  }

  return { selectedRoadmapId: roadmap ?? null, setSelectedRoadmap }
}
