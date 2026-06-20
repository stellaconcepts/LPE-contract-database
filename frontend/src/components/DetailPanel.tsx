import { useEffect, useState } from 'react'
import { fetchContractDetail, saveContract } from '../api'
import type { ContractDetail, ContractEditable, PricingLineItem, Signatory } from '../types'
import PricingBadge from './PricingBadge'

interface Props {
  filename: string | null
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}

const SHELL = 'flex-1 min-h-0 overflow-auto border-b'

function cell(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value)
}

function parseLike(raw: string, original: unknown): string | number | boolean | null {
  if (raw === '') return null
  if (typeof original === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

function toEditable(d: ContractDetail): ContractEditable {
  const { has_edit, last_edited_at, ...rest } = d
  return rest
}

interface PricingTableProps {
  items: PricingLineItem[]
  originalItems: PricingLineItem[]
  editable: boolean
  onCellChange?: (itemIdx: number, col: string, raw: string, original: unknown) => void
}

function PricingTable({ items, originalItems, editable, onCellChange }: PricingTableProps) {
  const columns = Array.from(new Set(items.flatMap((item) => Object.keys(item))))
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th key={col} className="text-left px-3 py-2 font-medium text-gray-400">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col} className="px-3 py-1.5">
                  {editable ? (
                    <input
                      value={item[col] === null || item[col] === undefined ? '' : String(item[col])}
                      onChange={(e) => onCellChange?.(i, col, e.target.value, originalItems[i]?.[col])}
                      className="w-full border rounded px-1 py-0.5"
                    />
                  ) : (
                    cell(item[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DetailPanel({ filename, onDirtyChange, onSaved }: Props) {
  const [detail, setDetail] = useState<ContractDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ContractEditable | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!filename) { setDetail(null); setError(null); return }
    setLoading(true)
    setError(null)
    setDetail(null)
    setEditing(false)
    setDraft(null)
    setSaveError(null)
    fetchContractDetail(filename)
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [filename])

  useEffect(() => {
    const dirty = editing && draft != null && detail != null &&
      JSON.stringify(draft) !== JSON.stringify(toEditable(detail))
    onDirtyChange(dirty)
  }, [editing, draft, detail, onDirtyChange])

  function startEdit() {
    if (!detail) return
    setDraft(toEditable(detail))
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  function saveEdit() {
    if (!filename || !draft) return
    setSaving(true)
    setSaveError(null)
    saveContract(filename, draft)
      .then((result) => {
        setDetail(result)
        setEditing(false)
        setDraft(null)
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 2000)
        onSaved()
      })
      .catch((e: Error) => setSaveError(e.message))
      .finally(() => setSaving(false))
  }

  function updateSignatory(i: number, field: keyof Signatory, value: string | null) {
    setDraft((d) => d && { ...d, signatories: d.signatories.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)) })
  }

  function removeSignatory(i: number) {
    setDraft((d) => d && { ...d, signatories: d.signatories.filter((_, idx) => idx !== i) })
  }

  function addSignatory() {
    setDraft((d) => d && { ...d, signatories: [...d.signatories, { name: '', position: null }] })
  }

  function updatePricingCell(blockIdx: number, category: string, itemIdx: number, col: string, raw: string, original: unknown) {
    const value = parseLike(raw, original)
    setDraft((d) => {
      if (!d) return d
      const pricing = d.pricing.map((block, bIdx) => {
        if (bIdx !== blockIdx) return block
        return {
          ...block,
          [category]: block[category].map((item, iIdx) => (iIdx === itemIdx ? { ...item, [col]: value } : item)),
        }
      })
      return { ...d, pricing }
    })
  }

  if (!filename) {
    return (
      <div className={`${SHELL} flex items-center justify-center text-gray-400`}>
        Select a contract
      </div>
    )
  }
  if (loading) {
    return (
      <div className={`${SHELL} flex items-center justify-center text-gray-400`}>
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className={`${SHELL} flex items-center justify-center text-red-400`}>
        {error}
      </div>
    )
  }
  if (!detail) return null

  const signatories = editing && draft ? draft.signatories : detail.signatories
  const pricingSource = editing && draft ? draft.pricing : detail.pricing

  return (
    <div className={SHELL}>
      <div className="p-4 space-y-4">

        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-semibold">{detail.filename}</h1>
            <PricingBadge isPricing={editing && draft ? draft.is_pricing_contract : detail.is_pricing_contract} />
            <div className="flex-1" />
            {!editing && (
              <button onClick={startEdit} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEdit} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">
                  Cancel
                </button>
              </>
            )}
            {justSaved && <span className="text-xs text-green-600">Saved</span>}
          </div>
          {saveError && <p className="text-xs text-red-500 mt-1">{saveError}</p>}
        </div>

        {editing && draft ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_pricing_contract}
              onChange={(e) => setDraft((d) => d && { ...d, is_pricing_contract: e.target.checked })}
            />
            Pricing contract
          </label>
        ) : null}

        <div className="text-sm">
          <span className="text-gray-400">Term: </span>
          {editing && draft ? (
            <span className="inline-flex items-center gap-1">
              <input
                value={draft.contract_start_date ?? ''}
                onChange={(e) => setDraft((d) => d && { ...d, contract_start_date: e.target.value === '' ? null : e.target.value })}
                placeholder="DD-MM-YYYY"
                className="border rounded px-1 py-0.5 w-28"
              />
              <span>–</span>
              <input
                value={draft.contract_end_date ?? ''}
                onChange={(e) => setDraft((d) => d && { ...d, contract_end_date: e.target.value === '' ? null : e.target.value })}
                placeholder="DD-MM-YYYY"
                className="border rounded px-1 py-0.5 w-28"
              />
            </span>
          ) : (
            <>{detail.contract_start_date ?? 'Not specified'} – {detail.contract_end_date ?? 'Not specified'}</>
          )}
        </div>

        <div className="text-sm">
          <span className="text-gray-400">Location: </span>
          {editing && draft ? (
            <input
              value={draft.location}
              onChange={(e) => setDraft((d) => d && { ...d, location: e.target.value })}
              className="border rounded px-1 py-0.5 w-full max-w-sm"
            />
          ) : (
            detail.location
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Signatories
          </div>
          <ul className="text-sm space-y-1">
            {signatories.map((s, i) =>
              editing ? (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={s.name}
                    onChange={(e) => updateSignatory(i, 'name', e.target.value)}
                    placeholder="Name"
                    className="border rounded px-1 py-0.5 flex-1"
                  />
                  <input
                    value={s.position ?? ''}
                    onChange={(e) => updateSignatory(i, 'position', e.target.value === '' ? null : e.target.value)}
                    placeholder="Position"
                    className="border rounded px-1 py-0.5 flex-1"
                  />
                  <button onClick={() => removeSignatory(i)} className="text-red-500 text-xs px-1" aria-label="Remove signatory">
                    ✕
                  </button>
                </li>
              ) : (
                <li key={i}>{s.name} — {s.position ?? 'unknown'}</li>
              )
            )}
          </ul>
          {editing && (
            <button onClick={addSignatory} className="text-xs text-blue-600 mt-1 hover:underline">
              + Add signatory
            </button>
          )}
        </div>

        {pricingSource.length > 0 && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Pricing
            </div>
            {pricingSource.map((block, blockIdx) =>
              Object.entries(block).map(([category, items]) => (
                <div key={`${blockIdx}-${category}`}>
                  <div className="text-sm font-medium mb-1">{category}</div>
                  <PricingTable
                    items={items}
                    originalItems={detail.pricing[blockIdx]?.[category] ?? items}
                    editable={editing}
                    onCellChange={(itemIdx, col, raw, original) => updatePricingCell(blockIdx, category, itemIdx, col, raw, original)}
                  />
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  )
}
