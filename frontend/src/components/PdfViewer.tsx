import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { pdfUrl } from '../api'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface Props {
  filename: string | null
}

const SHELL = 'h-2/5 shrink-0 border-t overflow-auto bg-gray-50'

export default function PdfViewer({ filename }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>(0)

  useEffect(() => {
    setNumPages(null)
    setError(null)
  }, [filename])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!filename) {
    return (
      <div className={`${SHELL} flex items-center justify-center text-gray-400`}>
        Select a contract to view its PDF
      </div>
    )
  }

  return (
    <div ref={containerRef} className={SHELL}>
      {error ? (
        <div className="h-full flex items-center justify-center text-red-400">{error}</div>
      ) : (
        <Document
          key={filename}
          file={pdfUrl(filename)}
          loading={<div className="p-4 text-gray-400">Loading PDF…</div>}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(err) =>
            setError(err.message.includes('404') ? 'PDF not found for this contract' : err.message)
          }
        >
          {numPages != null &&
            Array.from({ length: numPages }, (_, i) => (
              <Page key={i} pageNumber={i + 1} width={width || undefined} className="mb-2" />
            ))}
        </Document>
      )}
    </div>
  )
}
