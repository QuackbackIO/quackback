export {
  createCompany,
  updateCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  getForPrincipal,
  attachPrincipal,
  detachPrincipal,
} from './company.service'
export type {
  Company,
  CompanyId,
  CompanyWithMemberCount,
  CreateCompanyInput,
  UpdateCompanyInput,
} from './company.types'
