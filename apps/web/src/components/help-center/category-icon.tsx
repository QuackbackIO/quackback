import * as SolidIcons from '@heroicons/react/20/solid'
import type { ComponentType, SVGProps } from 'react'

export type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>
export const ICON_LOOKUP = SolidIcons as Record<string, HeroIcon>
export const ALL_ICON_KEYS = Object.keys(SolidIcons).filter((k) => k.endsWith('Icon'))

interface CategoryIconProps {
  icon: string | null
  className?: string
}

export function CategoryIcon({ icon, className }: CategoryIconProps) {
  const Icon = (icon ? ICON_LOOKUP[icon] : null) ?? SolidIcons.FolderIcon
  return <Icon className={className} />
}
