import type { ContractDetail, ContractEditable, UploadedFile, UploadJob } from './types'

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

export async function uploadContract(file: File): Promise<{ job_id: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE}/api/uploads`, { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ? String(body.detail) : `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<{ job_id: string }>
}

export async function getUploadStatus(jobId: string): Promise<UploadJob> {
  const res = await fetch(`${BASE}/api/uploads/${encodeURIComponent(jobId)}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<UploadJob>
}

export async function fetchUploadedFiles(): Promise<UploadedFile[]> {
  const res = await fetch(`${BASE}/api/uploads`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<UploadedFile[]>
}

export async function deleteUpload(filename: string): Promise<void> {
  const res = await fetch(`${BASE}/api/uploads/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ? String(body.detail) : `${res.status} ${res.statusText}`)
  }
}
