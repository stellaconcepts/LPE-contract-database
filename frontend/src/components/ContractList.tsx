import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { deleteUpload, fetchContracts, fetchUploadedFiles } from '../api'
import type { ContractDetail, PricingBlock } from '../types'

interface Props {
  selectedFilename: string | null
  onSelect: (filename: string) => void
  onSelectionUnavailable: () => void
  onDeleted: (filename: string) => void
  refreshToken: number
}

type PricingFilter = 'all' | 'pricing' | 'non-pricing'
type EditedFilter = 'all' | 'edited' | 'unedited'
type SortKey = 'filename' | 'start' | 'end'
type SortDir = 'asc' | 'desc'

function dateRange(c: ContractDetail): string {
  const start = c.contract_start_date ?? 'Not specified'
  const end = c.contract_end_date ?? 'Not specified'
  return `${start} – ${end}`
}

function flattenPricing(pricing: PricingBlock[]): string {
  return pricing
    .flatMap((block) =>
      Object.entries(block).flatMap(([category, items]) => [
        category,
        ...items.flatMap((item) => Object.entries(item).flatMap(([k, v]) => [k, String(v ?? '')])),
      ])
    )
    .join(' ')
}

function searchText(c: ContractDetail): string {
  const signatoryNames = c.signatories.map((s) => s.name).join(' ')
  return `${c.filename} ${c.location} ${signatoryNames} ${flattenPricing(c.pricing)}`.toLowerCase()
}

function parseDDMMYYYY(s: string): number {
  const [d, m, y] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function compareDates(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir * (parseDDMMYYYY(a) - parseDDMMYYYY(b))
}

function highlight(text: string, term: string) {
  if (!term) return text
  const idx = text.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-inherit">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  )
}

export default function ContractList({ selectedFilename, onSelect, onSelectionUnavailable, onDeleted, refreshToken }: Props) {
  const [contracts, setContracts] = useState<ContractDetail[]>([])
  const [uploadedFilenames, setUploadedFilenames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all')
  const [editedFilter, setEditedFilter] = useState<EditedFilter>('all')
  const [missingDatesOnly, setMissingDatesOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('filename')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    fetchContracts()
      .then(setContracts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
    fetchUploadedFiles()
      .then((files) => setUploadedFilenames(new Set(files.map((f) => f.filename))))
      .catch(() => {})
  }, [refreshToken])

  async function handleDelete(e: React.MouseEvent, filename: string) {
    e.stopPropagation()
    if (!window.confirm(`Delete "${filename}"? This removes both the extracted data and the PDF.`)) return
    try {
      await deleteUpload(filename)
      onDeleted(filename)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const withSearchText = useMemo(
    () => contracts.map((c) => ({ c, text: searchText(c) })),
    [contracts]
  )

  const visible = useMemo(() => {
    const term = debouncedSearch.toLowerCase()
    const dir = sortDir === 'asc' ? 1 : -1
    const filtered = withSearchText
      .filter(({ text }) => term === '' || text.includes(term))
      .filter(({ c }) => pricingFilter === 'all' || (pricingFilter === 'pricing' ? c.is_pricing_contract : !c.is_pricing_contract))
      .filter(({ c }) => editedFilter === 'all' || (editedFilter === 'edited' ? c.has_edit : !c.has_edit))
      .filter(({ c }) => !missingDatesOnly || c.contract_start_date === null || c.contract_end_date === null)
      .map(({ c }) => c)

    return [...filtered].sort((a, b) => {
      if (sortKey === 'filename') return dir * a.filename.localeCompare(b.filename)
      if (sortKey === 'start') return compareDates(a.contract_start_date, b.contract_start_date, dir)
      return compareDates(a.contract_end_date, b.contract_end_date, dir)
    })
  }, [withSearchText, debouncedSearch, pricingFilter, editedFilter, missingDatesOnly, sortKey, sortDir])

  useEffect(() => {
    if (selectedFilename && !visible.some((c) => c.filename === selectedFilename)) {
      onSelectionUnavailable()
    }
  }, [visible, selectedFilename, onSelectionUnavailable])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
  })

  function resetFilters() {
    setPricingFilter('all')
    setEditedFilter('all')
    setMissingDatesOnly(false)
  }

  if (error) {
    return (
      <div className="w-80 flex-1 min-h-0 flex items-center justify-center border-r text-danger p-4 text-xs">
        {error}
      </div>
    )
  }

  return (
    <div className="w-80 flex-1 min-h-0 flex flex-col border-r bg-neutral-50 overflow-hidden">
      <div className="px-3 py-2 border-b bg-white shrink-0 space-y-2">
        <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Contracts ({visible.length} of {contracts.length})
        </div>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search filename, location, signatory, pricing…"
          className="w-full text-xs border border-neutral-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
        />
        <div className="flex items-center gap-1 text-[11px]">
          <select
            value={pricingFilter}
            onChange={(e) => setPricingFilter(e.target.value as PricingFilter)}
            className="border border-neutral-200 rounded px-2 py-1 bg-white cursor-pointer hover:border-accent-subtle focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          >
            <option value="all">All pricing</option>
            <option value="pricing">Pricing only</option>
            <option value="non-pricing">Non-pricing</option>
          </select>
          <select
            value={editedFilter}
            onChange={(e) => setEditedFilter(e.target.value as EditedFilter)}
            className="border border-neutral-200 rounded px-2 py-1 bg-white cursor-pointer hover:border-accent-subtle focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          >
            <option value="all">All edits</option>
            <option value="edited">Edited only</option>
            <option value="unedited">Unedited</option>
          </select>
          <button onClick={resetFilters} className="ml-auto text-accent hover:underline">
            Reset filters
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={missingDatesOnly}
            onChange={(e) => setMissingDatesOnly(e.target.checked)}
            className="accent-accent"
          />
          Missing start or end date
        </label>
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-neutral-400">Sort:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="border border-neutral-200 rounded px-2 py-1 bg-white cursor-pointer hover:border-accent-subtle focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          >
            <option value="filename">Filename</option>
            <option value="start">Start date</option>
            <option value="end">End date</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="border border-neutral-200 rounded px-2 py-1 cursor-pointer hover:border-accent-subtle focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            aria-label="Toggle sort direction"
          >
            {sortDir === 'asc' ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-4 text-xs text-neutral-400">Loading…</div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const c = visible[vItem.index]
              const selected = c.filename === selectedFilename
              return (
                <div
                  key={vItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vItem.size}px`,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  className={`px-3 py-2 cursor-pointer border-b flex flex-col justify-center gap-0.5 ${
                    selected ? 'bg-accent text-white' : 'hover:bg-white'
                  }`}
                  onClick={() => onSelect(c.filename)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate flex-1 text-xs leading-tight">
                      {highlight(c.filename, debouncedSearch)}
                    </span>
                    {c.has_edit && (
                      <span
                        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          selected ? 'bg-white/20 text-white' : 'bg-warning-bg text-warning-text'
                        }`}
                      >
                        Edited
                      </span>
                    )}
                    {uploadedFilenames.has(c.filename) && (
                      <button
                        onClick={(e) => handleDelete(e, c.filename)}
                        aria-label={`Delete ${c.filename}`}
                        className={`shrink-0 ${selected ? 'text-white/80 hover:text-white' : 'text-neutral-400 hover:text-danger'}`}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                  <div className={`text-[11px] truncate ${selected ? 'text-white/70' : 'text-neutral-400'}`}>
                    {highlight(c.location, debouncedSearch)} · {dateRange(c)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
