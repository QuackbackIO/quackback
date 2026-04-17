import * as SolidIcons from '@heroicons/react/20/solid'
import type { ComponentType, SVGProps } from 'react'

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>
const ICON_LOOKUP = SolidIcons as Record<string, HeroIcon>

interface CategoryIconProps {
  icon: string | null
  className?: string
}

export function CategoryIcon({ icon, className }: CategoryIconProps) {
  const Icon = (icon ? ICON_LOOKUP[icon] : null) ?? SolidIcons.FolderIcon
  return <Icon className={className} />
}
