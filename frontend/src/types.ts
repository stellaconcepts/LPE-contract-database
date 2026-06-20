export interface Signatory {
  name: string
  position: string | null
}

export type PricingLineItem = Record<string, string | number | boolean | null>
export type PricingBlock = Record<string, PricingLineItem[]>

export interface ContractEditable {
  filename: string
  is_pricing_contract: boolean
  contract_start_date: string | null
  contract_end_date: string | null
  signatories: Signatory[]
  location: string
  pricing: PricingBlock[]
}

export interface ContractDetail extends ContractEditable {
  has_edit: boolean
  last_edited_at: string | null
}
