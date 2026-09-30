import { Suspense, use } from 'react'
import {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  BellIcon,
  BoltIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BugAntIcon,
  BuildingOfficeIcon,
  CalendarIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CloudIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  CreditCardIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  GiftIcon,
  GlobeAltIcon,
  HeartIcon,
  HomeIcon,
  InformationCircleIcon,
  KeyIcon,
  LifebuoyIcon,
  LightBulbIcon,
  LinkIcon,
  LockClosedIcon,
  MegaphoneIcon,
  PuzzlePieceIcon,
  QuestionMarkCircleIcon,
  RocketLaunchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
  TruckIcon,
  UserCircleIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'
import type { HeroIcon } from './category-icon-map'

export type { HeroIcon } from './category-icon-map'

/**
 * The icons help-center categories usually pick, resolved without loading the
 * picker's full set. Every entry must be the same component ICON_MAP holds
 * under that name.
 */
const COMMON_ICONS: Record<string, HeroIcon> = {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  BellIcon,
  BoltIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BugAntIcon,
  BuildingOfficeIcon,
  CalendarIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CloudIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  CreditCardIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  GiftIcon,
  GlobeAltIcon,
  HeartIcon,
  HomeIcon,
  InformationCircleIcon,
  KeyIcon,
  LifebuoyIcon,
  LightBulbIcon,
  LinkIcon,
  LockClosedIcon,
  MegaphoneIcon,
  PuzzlePieceIcon,
  QuestionMarkCircleIcon,
  RocketLaunchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
  TruckIcon,
  UserCircleIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
}

/**
 * The shape of a heroicon export name. Anything else (an emoji, say) is never
 * in the set, and checking it first keeps prototype keys out of the lookups.
 */
const HEROICON_NAME = /^[A-Z][A-Za-z0-9]*Icon$/

type IconMap = Record<string, HeroIcon>

let iconMap: IconMap | undefined
let iconMapLoad: Promise<IconMap> | undefined

/**
 * Load the picker's full icon set. Idempotent; call it ahead of need (the
 * picker opening) to have the set ready by the time it renders.
 */
export function loadCategoryIconMap(): Promise<IconMap> {
  iconMapLoad ??= import('./category-icon-map').then((m) => (iconMap = m.ICON_MAP))
  return iconMapLoad
}

// The server renders every icon in full, so it holds the set from the start.
if (typeof window === 'undefined') loadCategoryIconMap().catch(() => {})

/** The picker's full icon set; suspends until it has loaded. */
export function useCategoryIconMap(): IconMap {
  return iconMap ?? use(loadCategoryIconMap())
}

let renderMapLoad: Promise<IconMap | null> | undefined

/** An icon outside the common set, read from the full set once it arrives. */
function FullSetIcon({ icon, className }: { icon: string; className?: string }) {
  // A set that fails to load renders the default icon rather than failing the page.
  const map = iconMap ?? use((renderMapLoad ??= loadCategoryIconMap().catch(() => null)))
  const Icon = map?.[icon] ?? FolderIcon
  return <Icon className={className} />
}

interface CategoryIconProps {
  icon: string | null
  className?: string
}

export function CategoryIcon({ icon, className }: CategoryIconProps) {
  if (!icon || !HEROICON_NAME.test(icon)) return <FolderIcon className={className} />
  const Common = COMMON_ICONS[icon]
  if (Common) return <Common className={className} />
  // Holds the space while the set loads; a server-rendered icon stays on
  // screen until then, since hydration waits for it.
  const placeholder = <svg viewBox="0 0 20 20" aria-hidden="true" className={className} />
  return (
    <Suspense fallback={placeholder}>
      <FullSetIcon icon={icon} className={className} />
    </Suspense>
  )
}
