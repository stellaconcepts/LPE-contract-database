import { useRef, useState } from 'react'
import ContractList from './components/ContractList'
import DetailPanel from './components/DetailPanel'
import Header from './components/Header'
import PdfViewer from './components/PdfViewer'
import UploadPanel from './components/UploadPanel'

const MIN_PDF_HEIGHT_PCT = 20
const MAX_PDF_HEIGHT_PCT = 80

export default function App() {
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [findTarget, setFindTarget] = useState<{ value: string; nonce: number } | null>(null)
  const [pdfHeightPercent, setPdfHeightPercent] = useState(60)
  const nonceRef = useRef(0)
  const rightColRef = useRef<HTMLDivElement>(null)

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    document.body.style.userSelect = 'none'

    function handleMouseMove(ev: MouseEvent) {
      if (!rightColRef.current) return
      const rect = rightColRef.current.getBoundingClientRect()
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100
      setPdfHeightPercent(Math.min(MAX_PDF_HEIGHT_PCT, Math.max(MIN_PDF_HEIGHT_PCT, pct)))
    }
    function handleMouseUp() {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function handleSelect(filename: string) {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
    setSelectedFilename(filename)
    setFindTarget(null)
  }

  function handleSelectionUnavailable() {
    setSelectedFilename(null)
    setFindTarget(null)
  }

  function handleGoToSource(value: string) {
    setFindTarget({ value, nonce: ++nonceRef.current })
  }

  function handleUploaded(filename: string) {
    setRefreshToken((t) => t + 1)
    setSelectedFilename(filename)
    setFindTarget(null)
  }

  function handleDeleted(filename: string) {
    setRefreshToken((t) => t + 1)
    if (selectedFilename === filename) {
      setSelectedFilename(null)
      setFindTarget(null)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white text-sm">
      <Header />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-80 shrink-0 flex flex-col border-r overflow-hidden">
          <ContractList
            selectedFilename={selectedFilename}
            onSelect={handleSelect}
            onSelectionUnavailable={handleSelectionUnavailable}
            onDeleted={handleDeleted}
            refreshToken={refreshToken}
          />
          <UploadPanel onUploaded={handleUploaded} onDeleted={handleDeleted} />
        </div>
        <div ref={rightColRef} className="flex-1 flex flex-col overflow-hidden min-w-0">
          <DetailPanel
            filename={selectedFilename}
            onDirtyChange={setDirty}
            onSaved={() => setRefreshToken((t) => t + 1)}
            onGoToSource={handleGoToSource}
          />
          <div
            onMouseDown={handleDividerMouseDown}
            className="h-1.5 shrink-0 cursor-row-resize bg-neutral-100 hover:bg-accent-subtle active:bg-accent-subtle border-y border-neutral-200"
          />
          <PdfViewer filename={selectedFilename} findTarget={findTarget} heightPercent={pdfHeightPercent} />
        </div>
      </div>
    </div>
  )
}
