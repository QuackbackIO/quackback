import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface UserAvatarProps {
  name: string
  avatarUrl?: string | null
  className?: string
  fallbackClassName?: string
}

/**
 * User avatar component with SSR support.
 *
 * For flicker-free rendering, pass a base64 data URL as avatarUrl.
 * Use getUserAvatarUrl() server-side to generate the data URL.
 */
export function UserAvatar({ name, avatarUrl, className, fallbackClassName }: UserAvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
      <AvatarFallback className={fallbackClassName}>{initials || '?'}</AvatarFallback>
    </Avatar>
  )
}

/**
 * Props for components that need to display a user avatar.
 * Use getUserAvatarData() to populate these fields server-side.
 */
export interface UserAvatarData {
  name: string
  avatarUrl: string | null
}
