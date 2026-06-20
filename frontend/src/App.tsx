import { useState } from 'react'
import ContractList from './components/ContractList'
import DetailPanel from './components/DetailPanel'
import PdfViewer from './components/PdfViewer'

export default function App() {
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  function handleSelect(filename: string) {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
    setSelectedFilename(filename)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-sm">
      <ContractList
        selectedFilename={selectedFilename}
        onSelect={handleSelect}
        onSelectionUnavailable={() => setSelectedFilename(null)}
        refreshToken={refreshToken}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <DetailPanel
          filename={selectedFilename}
          onDirtyChange={setDirty}
          onSaved={() => setRefreshToken((t) => t + 1)}
        />
        <PdfViewer filename={selectedFilename} />
      </div>
    </div>
  )
}
