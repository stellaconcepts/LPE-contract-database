import type { ContractDetail, ContractEditable } from './types'

const BASE = 'http://localhost:8000'

export async function fetchContracts(): Promise<ContractDetail[]> {
  const res = await fetch(`${BASE}/api/contracts`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<ContractDetail[]>
}

export async function fetchContractDetail(filename: string): Promise<ContractDetail> {
  const res = await fetch(`${BASE}/api/contract?file=${encodeURIComponent(filename)}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<ContractDetail>
}

export function pdfUrl(filename: string): string {
  return `${BASE}/api/contract/pdf?file=${encodeURIComponent(filename)}`
}

export async function saveContract(filename: string, edit: ContractEditable): Promise<ContractDetail> {
  const res = await fetch(`${BASE}/api/contract?file=${encodeURIComponent(filename)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ? JSON.stringify(body.detail) : `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<ContractDetail>
}
