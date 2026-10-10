import type { UserAttributeId } from '@quackback/ids'
import type {
  AttributeDefinitionRecord,
  CreateAttributeDefinitionInput,
  UpdateAttributeDefinitionInput,
} from '@/lib/server/domains/attribute-definitions/attribute-definition.types'

export type UserAttribute = AttributeDefinitionRecord<UserAttributeId>
export type CreateUserAttributeInput = CreateAttributeDefinitionInput
export type UpdateUserAttributeInput = UpdateAttributeDefinitionInput
