import { userAttributeDefinitions } from '@/lib/server/db'
import type { UserAttributeId } from '@quackback/ids'
import { createAttributeDefinitionService } from '@/lib/server/domains/attribute-definitions/attribute-definition.service'
import type {
  UserAttribute,
  CreateUserAttributeInput,
  UpdateUserAttributeInput,
} from './user-attribute.types'

const service = createAttributeDefinitionService({
  table: userAttributeDefinitions,
  idPrefix: 'user_attr',
  singular: 'User attribute',
  plural: 'user attributes',
  logComponent: 'user-attributes',
})

export async function listUserAttributes(): Promise<UserAttribute[]> {
  return (await service.list()) as UserAttribute[]
}

export async function createUserAttribute(input: CreateUserAttributeInput): Promise<UserAttribute> {
  return (await service.create(input)) as UserAttribute
}

export async function updateUserAttribute(
  id: UserAttributeId,
  input: UpdateUserAttributeInput
): Promise<UserAttribute> {
  return (await service.update(id, input)) as UserAttribute
}

export async function deleteUserAttribute(id: UserAttributeId): Promise<void> {
  return service.remove(id)
}
