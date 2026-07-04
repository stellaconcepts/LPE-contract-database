import { useRef, useState } from 'react'
import ContractList from './components/ContractList'
import DetailPanel from './components/DetailPanel'
import Header from './components/Header'
import PdfViewer from './components/PdfViewer'
import UploadPanel from './components/UploadPanel'

export default function App() {
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [findTarget, setFindTarget] = useState<{ value: string; nonce: number } | null>(null)
  const nonceRef = useRef(0)

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
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <DetailPanel
            filename={selectedFilename}
            onDirtyChange={setDirty}
            onSaved={() => setRefreshToken((t) => t + 1)}
            onGoToSource={handleGoToSource}
          />
          <PdfViewer filename={selectedFilename} findTarget={findTarget} />
        </div>
      </div>
    </div>
  )
}
