import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { pdfUrl } from '../api'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface FindTarget {
  value: string
  nonce: number
}

interface Props {
  filename: string | null
  findTarget: FindTarget | null
  heightPercent: number
}

interface PageIndex {
  normalized: string
  itemRanges: Map<number, { start: number; end: number }>
}

interface Occurrence {
  pageNumber: number
  itemIndices: number[]
}

const SHELL = 'shrink-0 flex flex-col bg-gray-50'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function dateVariants(s: string): string[] {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return [s]
  const [, dd, mm, yyyy] = m
  const d = Number(dd)
  const mo = Number(mm)
  const variants = [s, `${dd}/${mm}/${yyyy}`, `${d}/${mo}/${yyyy}`, `${dd}.${mm}.${yyyy}`]
  const monthName = MONTHS[mo - 1]
  if (monthName) variants.push(`${d} ${monthName} ${yyyy}`)
  return variants
}

function numericVariants(s: string): string[] {
  const m = s.match(/^(-?\d+)\.(\d+)$/)
  if (!m) return [s]
  const trimmed = m[2].replace(/0+$/, '')
  return trimmed ? [s, `${m[1]}.${trimmed}`] : [s, m[1]]
}

function buildVariants(value: string): string[] {
  return [...new Set([...dateVariants(value), ...numericVariants(value)])]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function buildPageIndexes(pdfDoc: PDFDocumentProxy): Promise<Map<number, PageIndex>> {
  const indexes = new Map<number, PageIndex>()
  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const page = await pdfDoc.getPage(pageNumber)
    const content = await page.getTextContent()
    let normalized = ''
    const itemRanges = new Map<number, { start: number; end: number }>()
    content.items.forEach((item, itemIndex) => {
      if (!('str' in item)) return
      const norm = normalize(item.str)
      if (!norm) return
      if (normalized.length > 0 && !normalized.endsWith(' ')) normalized += ' '
      const start = normalized.length
      normalized += norm
      itemRanges.set(itemIndex, { start, end: normalized.length })
    })
    indexes.set(pageNumber, { normalized, itemRanges })
  }
  return indexes
}

function findAllOccurrences(haystack: string, needle: string): { start: number; end: number }[] {
  if (!needle) return []
  const out: { start: number; end: number }[] = []
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    out.push({ start: idx, end: idx + needle.length })
    from = idx + needle.length
  }
  return out
}

function searchAllPages(pageIndexes: Map<number, PageIndex>, value: string): Occurrence[] {
  const seen = new Map<string, Occurrence>()
  const variants = buildVariants(value).map(normalize).filter(Boolean)
  for (const [pageNumber, { normalized, itemRanges }] of pageIndexes) {
    for (const variant of variants) {
      for (const range of findAllOccurrences(normalized, variant)) {
        const itemIndices = [...itemRanges.entries()]
          .filter(([, r]) => r.start < range.end && r.end > range.start)
          .map(([idx]) => idx)
        if (itemIndices.length === 0) continue
        const key = `${pageNumber}:${itemIndices.join(',')}`
        if (!seen.has(key)) seen.set(key, { pageNumber, itemIndices })
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.pageNumber - b.pageNumber || a.itemIndices[0] - b.itemIndices[0])
}

export default function PdfViewer({ filename, findTarget, heightPercent }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageIndexes, setPageIndexes] = useState<Map<number, PageIndex> | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set())

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>(0)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const scrolledKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setNumPages(null)
    setError(null)
    setPdfDoc(null)
    setPageIndexes(null)
    setIndexing(false)
    setOccurrences([])
    setCurrentIndex(0)
    setRenderedPages(new Set())
    pageRefs.current = {}
    scrolledKeyRef.current = null
  }, [filename])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdfDoc) { setPageIndexes(null); return }
    let cancelled = false
    setIndexing(true)
    buildPageIndexes(pdfDoc).then((indexes) => {
      if (!cancelled) { setPageIndexes(indexes); setIndexing(false) }
    })
    return () => { cancelled = true }
  }, [pdfDoc])

  useEffect(() => {
    if (!findTarget || !pageIndexes) { setOccurrences([]); setCurrentIndex(0); return }
    setOccurrences(searchAllPages(pageIndexes, findTarget.value))
    setCurrentIndex(0)
  }, [findTarget, pageIndexes])

  useEffect(() => {
    if (occurrences.length === 0) return
    const occ = occurrences[currentIndex]
    const key = `${findTarget?.nonce}-${currentIndex}`
    if (scrolledKeyRef.current === key) return
    if (!renderedPages.has(occ.pageNumber)) return
    const pageEl = pageRefs.current[occ.pageNumber]
    if (!pageEl) return
    const markEl = pageEl.querySelector<HTMLElement>('.pdf-highlight-current')
    ;(markEl ?? pageEl).scrollIntoView({ behavior: 'smooth', block: 'center' })
    scrolledKeyRef.current = key
    // eslint-disable-next-line react-hooks/exhaustive-deps -- findTarget intentionally excluded: this must
    // only re-run once occurrences/currentIndex catch up to the new target, not on the same render the
    // target prop changes (that render still has the previous target's stale occurrences/currentIndex).
  }, [occurrences, currentIndex, renderedPages])

  const highlightedItems = useMemo(() => {
    const map = new Map<number, Map<number, 'current' | 'other'>>()
    occurrences.forEach((occ, idx) => {
      const pageMap = map.get(occ.pageNumber) ?? new Map<number, 'current' | 'other'>()
      const status = idx === currentIndex ? 'current' : 'other'
      occ.itemIndices.forEach((itemIdx) => {
        if (pageMap.get(itemIdx) !== 'current') pageMap.set(itemIdx, status)
      })
      map.set(occ.pageNumber, pageMap)
    })
    return map
  }, [occurrences, currentIndex])

  const customTextRenderer = useCallback(
    ({ pageNumber, itemIndex, str }: { pageNumber: number; itemIndex: number; str: string }) => {
      const status = highlightedItems.get(pageNumber)?.get(itemIndex)
      if (!status) return escapeHtml(str)
      const cls = status === 'current' ? 'pdf-highlight-current' : 'pdf-highlight'
      return `<mark class="${cls}">${escapeHtml(str)}</mark>`
    },
    [highlightedItems]
  )

  if (!filename) {
    return (
      <div className={`${SHELL} items-center justify-center text-gray-400`} style={{ height: `${heightPercent}%` }}>
        Select a contract to view its PDF
      </div>
    )
  }

  return (
    <div className={SHELL} style={{ height: `${heightPercent}%` }}>
      {findTarget && (
        <div className="shrink-0 px-3 py-1.5 border-b bg-white flex items-center justify-end gap-2 text-xs">
          {indexing ? (
            <span className="text-gray-400">Searching…</span>
          ) : occurrences.length === 0 ? (
            <span className="text-gray-400">No match in this document</span>
          ) : (
            <>
              {occurrences.length > 1 && (
                <button
                  onClick={() => setCurrentIndex((i) => (i - 1 + occurrences.length) % occurrences.length)}
                  className="px-1 rounded border hover:bg-gray-50"
                  aria-label="Previous match"
                >
                  ◀
                </button>
              )}
              <span className="text-gray-600">{currentIndex + 1} of {occurrences.length}</span>
              {occurrences.length > 1 && (
                <button
                  onClick={() => setCurrentIndex((i) => (i + 1) % occurrences.length)}
                  className="px-1 rounded border hover:bg-gray-50"
                  aria-label="Next match"
                >
                  ▶
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {error ? (
          <div className="h-full flex items-center justify-center text-danger">{error}</div>
        ) : (
          <Document
            key={filename}
            file={pdfUrl(filename)}
            loading={<div className="p-4 text-gray-400">Loading PDF…</div>}
            onLoadSuccess={(pdf) => { setNumPages(pdf.numPages); setPdfDoc(pdf) }}
            onLoadError={(err) =>
              setError(err.message.includes('404') ? 'PDF not found for this contract' : err.message)
            }
          >
            {numPages != null &&
              Array.from({ length: numPages }, (_, i) => {
                const pageNumber = i + 1
                return (
                  <div key={pageNumber} ref={(el) => { pageRefs.current[pageNumber] = el }} className="mb-2">
                    <Page
                      pageNumber={pageNumber}
                      width={width || undefined}
                      customTextRenderer={highlightedItems.size > 0 ? customTextRenderer : undefined}
                      onRenderSuccess={() => setRenderedPages((prev) => new Set(prev).add(pageNumber))}
                    />
                  </div>
                )
              })}
          </Document>
        )}
      </div>
    </div>
  )
}
