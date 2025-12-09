import { describe, it, expect, beforeEach } from 'vitest'
import { PermissionService } from '../permission.service'
import type { InteractionType, PermissionUserContext } from '../permission.types'

// Define PermissionLevel locally
type PermissionLevel = 'anyone' | 'authenticated' | 'disabled'

/**
 * Tests for PermissionService
 *
 * Note: Board-level override tests are integration tests that depend on
 * @quackback/db/types module resolution. These tests focus on the core
 * permission checking logic (canUserInteract and checkInteraction).
 */
describe('PermissionService', () => {
  let permissionService: PermissionService

  beforeEach(() => {
    permissionService = new PermissionService()
  })

  describe('getEffectivePermissionForInteraction (without board)', () => {
    const orgPermissions = {
      voting: 'anyone' as PermissionLevel,
      commenting: 'authenticated' as PermissionLevel,
      submissions: 'disabled' as PermissionLevel,
    }

    it('should return org-level permission for voting when no board', () => {
      const result = permissionService.getEffectivePermissionForInteraction(
        'voting',
        orgPermissions
      )
      expect(result).toBe('anyone')
    })

    it('should return org-level permission for commenting when no board', () => {
      const result = permissionService.getEffectivePermissionForInteraction(
        'commenting',
        orgPermissions
      )
      expect(result).toBe('authenticated')
    })

    it('should return org-level permission for submissions when no board', () => {
      const result = permissionService.getEffectivePermissionForInteraction(
        'submissions',
        orgPermissions
      )
      expect(result).toBe('disabled')
    })

    it('should handle null board', () => {
      const result = permissionService.getEffectivePermissionForInteraction(
        'commenting',
        orgPermissions,
        null
      )
      expect(result).toBe('authenticated')
    })

    it('should respect all interaction types from org permissions', () => {
      const interactions: InteractionType[] = ['voting', 'commenting', 'submissions']
      const expected: PermissionLevel[] = ['anyone', 'authenticated', 'disabled']

      interactions.forEach((interaction, i) => {
        const result = permissionService.getEffectivePermissionForInteraction(
          interaction,
          orgPermissions
        )
        expect(result).toBe(expected[i])
      })
    })
  })

  describe('canUserInteract', () => {
    describe('with "anyone" permission', () => {
      it('should allow anonymous users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: false,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('anyone', user)

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe('allowed')
        expect(result.effectivePermission).toBe('anyone')
      })

      it('should allow authenticated users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('anyone', user)

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe('allowed')
      })

      it('should allow team members', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('anyone', user)

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe('allowed')
      })
    })

    describe('with "authenticated" permission', () => {
      it('should reject anonymous users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: false,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('authenticated', user)

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('requires_auth')
        expect(result.effectivePermission).toBe('authenticated')
      })

      it('should allow authenticated users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('authenticated', user)

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe('allowed')
      })

      it('should allow team members', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('authenticated', user)

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe('allowed')
      })
    })

    describe('with "disabled" permission', () => {
      it('should reject anonymous users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: false,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('disabled', user)

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('disabled')
        expect(result.effectivePermission).toBe('disabled')
      })

      it('should reject authenticated users', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: false,
        }
        const result = permissionService.canUserInteract('disabled', user)

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('disabled')
      })

      it('should also reject team members when disabled', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('disabled', user)

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('disabled')
      })
    })

    describe('team member privileges', () => {
      it('should allow team members for anyone permission', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('anyone', user)

        expect(result.allowed).toBe(true)
      })

      it('should allow team members for authenticated permission', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('authenticated', user)

        expect(result.allowed).toBe(true)
      })

      it('should NOT allow team members when disabled', () => {
        const user: PermissionUserContext = {
          isAuthenticated: true,
          isTeamMember: true,
        }
        const result = permissionService.canUserInteract('disabled', user)

        expect(result.allowed).toBe(false)
      })
    })
  })

  describe('checkInteraction (without board)', () => {
    const orgPermissions = {
      voting: 'anyone' as PermissionLevel,
      commenting: 'authenticated' as PermissionLevel,
      submissions: 'disabled' as PermissionLevel,
    }

    it('should return success result for valid interaction check', () => {
      const user: PermissionUserContext = {
        isAuthenticated: false,
        isTeamMember: false,
      }

      const result = permissionService.checkInteraction('voting', orgPermissions, user)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowed).toBe(true)
        expect(result.value.reason).toBe('allowed')
        expect(result.value.effectivePermission).toBe('anyone')
      }
    })

    it('should reject anonymous users for authenticated interactions', () => {
      const user: PermissionUserContext = {
        isAuthenticated: false,
        isTeamMember: false,
      }

      const result = permissionService.checkInteraction('commenting', orgPermissions, user)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowed).toBe(false)
        expect(result.value.reason).toBe('requires_auth')
      }
    })

    it('should reject all users for disabled interactions', () => {
      const user: PermissionUserContext = {
        isAuthenticated: true,
        isTeamMember: true,
      }

      const result = permissionService.checkInteraction('submissions', orgPermissions, user)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowed).toBe(false)
        expect(result.value.reason).toBe('disabled')
      }
    })

    it('should allow authenticated users for authenticated interactions', () => {
      const user: PermissionUserContext = {
        isAuthenticated: true,
        isTeamMember: false,
      }

      const result = permissionService.checkInteraction('commenting', orgPermissions, user)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.allowed).toBe(true)
        expect(result.value.reason).toBe('allowed')
        expect(result.value.effectivePermission).toBe('authenticated')
      }
    })
  })

  describe('complete interaction flow', () => {
    it('should handle all three interaction types correctly', () => {
      const orgPermissions = {
        voting: 'anyone' as PermissionLevel,
        commenting: 'authenticated' as PermissionLevel,
        submissions: 'authenticated' as PermissionLevel,
      }

      const authenticatedUser: PermissionUserContext = {
        isAuthenticated: true,
        isTeamMember: false,
      }

      const anonymousUser: PermissionUserContext = {
        isAuthenticated: false,
        isTeamMember: false,
      }

      // Voting should work for anyone
      const votingAnon = permissionService.checkInteraction('voting', orgPermissions, anonymousUser)
      expect(votingAnon.success && votingAnon.value.allowed).toBe(true)

      // Commenting requires auth
      const commentingAnon = permissionService.checkInteraction(
        'commenting',
        orgPermissions,
        anonymousUser
      )
      expect(commentingAnon.success && commentingAnon.value.allowed).toBe(false)

      const commentingAuth = permissionService.checkInteraction(
        'commenting',
        orgPermissions,
        authenticatedUser
      )
      expect(commentingAuth.success && commentingAuth.value.allowed).toBe(true)

      // Submissions require auth
      const submissionsAnon = permissionService.checkInteraction(
        'submissions',
        orgPermissions,
        anonymousUser
      )
      expect(submissionsAnon.success && submissionsAnon.value.allowed).toBe(false)

      const submissionsAuth = permissionService.checkInteraction(
        'submissions',
        orgPermissions,
        authenticatedUser
      )
      expect(submissionsAuth.success && submissionsAuth.value.allowed).toBe(true)
    })

    it('should handle disabled permissions correctly for all users', () => {
      const orgPermissions = {
        voting: 'disabled' as PermissionLevel,
        commenting: 'disabled' as PermissionLevel,
        submissions: 'disabled' as PermissionLevel,
      }

      const users: PermissionUserContext[] = [
        { isAuthenticated: false, isTeamMember: false },
        { isAuthenticated: true, isTeamMember: false },
        { isAuthenticated: true, isTeamMember: true },
      ]

      const interactions: InteractionType[] = ['voting', 'commenting', 'submissions']

      for (const user of users) {
        for (const interaction of interactions) {
          const result = permissionService.checkInteraction(interaction, orgPermissions, user)
          expect(result.success).toBe(true)
          if (result.success) {
            expect(result.value.allowed).toBe(false)
            expect(result.value.reason).toBe('disabled')
          }
        }
      }
    })
  })
})
