'use client'

import {
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  BuildingStorefrontIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import type { UseCaseType } from '@/lib/shared/db-types'
import type { ComponentType } from 'react'

interface UseCaseOption {
  id: UseCaseType
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}

const USE_CASE_OPTIONS: UseCaseOption[] = [
  {
    id: 'saas',
    label: 'SaaS product',
    description: 'Feature requests from business customers',
    icon: ComputerDesktopIcon,
  },
  {
    id: 'consumer',
    label: 'Consumer app',
    description: 'Feedback from your users',
    icon: DevicePhoneMobileIcon,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    description: 'Feedback from buyers and sellers',
    icon: BuildingStorefrontIcon,
  },
  {
    id: 'internal',
    label: 'Internal team',
    description: 'Ideas and improvements',
    icon: UserGroupIcon,
  },
]

interface UseCaseSelectorProps {
  value: UseCaseType | undefined
  onChange: (value: UseCaseType) => void
  disabled?: boolean
}

export function UseCaseSelector({ value, onChange, disabled }: UseCaseSelectorProps) {
  return (
    <div className="space-y-2 max-w-sm mx-auto">
      {USE_CASE_OPTIONS.map((option) => {
        const isSelected = value === option.id
        const Icon = option.icon
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            disabled={disabled}
            className={`
              w-full flex items-center gap-4 p-4
              rounded-xl border transition-all duration-200
              disabled:cursor-not-allowed disabled:opacity-50
              ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/50 bg-card/50 hover:border-border hover:bg-card/80'
              }
            `}
          >
            {/* Icon */}
            <div
              className={`
              shrink-0 p-2.5 rounded-lg transition-colors
              ${isSelected ? 'bg-primary/10' : 'bg-muted/50'}
            `}
            >
              <Icon
                className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
              />
            </div>

            {/* Text */}
            <div className="text-left min-w-0">
              <div
                className={`font-medium text-sm ${isSelected ? 'text-foreground' : 'text-foreground/90'}`}
              >
                {option.label}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
