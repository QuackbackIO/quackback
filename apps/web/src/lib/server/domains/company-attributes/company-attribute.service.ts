import { companyAttributeDefinitions } from '@/lib/server/db'
import type { CompanyAttributeId } from '@quackback/ids'
import { createAttributeDefinitionService } from '@/lib/server/domains/attribute-definitions/attribute-definition.service'
import type {
  CompanyAttribute,
  CreateCompanyAttributeInput,
  UpdateCompanyAttributeInput,
} from './company-attribute.types'

const service = createAttributeDefinitionService({
  table: companyAttributeDefinitions,
  idPrefix: 'company_attr',
  singular: 'Company attribute',
  plural: 'company attributes',
  logComponent: 'company-attributes',
})

export async function listCompanyAttributes(): Promise<CompanyAttribute[]> {
  return (await service.list()) as CompanyAttribute[]
}

export async function createCompanyAttribute(
  input: CreateCompanyAttributeInput
): Promise<CompanyAttribute> {
  return (await service.create(input)) as CompanyAttribute
}

export async function updateCompanyAttribute(
  id: CompanyAttributeId,
  input: UpdateCompanyAttributeInput
): Promise<CompanyAttribute> {
  return (await service.update(id, input)) as CompanyAttribute
}

export async function deleteCompanyAttribute(id: CompanyAttributeId): Promise<void> {
  return service.remove(id)
}
