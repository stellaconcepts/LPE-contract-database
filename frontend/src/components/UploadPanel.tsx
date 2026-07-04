import { useEffect, useRef, useState } from 'react'
import { deleteUpload, fetchUploadedFiles, getUploadStatus, uploadContract } from '../api'
import type { UploadedFile, UploadJob, UploadStep } from '../types'

interface Props {
  onUploaded: (filename: string) => void
  onDeleted: (filename: string) => void
}

const STEPS: { key: UploadStep; label: string }[] = [
  { key: 'reading_pdf', label: 'Reading PDF' },
  { key: 'ocr', label: 'Running OCR' },
  { key: 'extracting', label: 'Extracting with Claude' },
  { key: 'done', label: 'Done' },
]

function stepIndex(step: UploadStep): number {
  return STEPS.findIndex((s) => s.key === step)
}

export default function UploadPanel({ onUploaded, onDeleted }: Props) {
  const [job, setJob] = useState<UploadJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [filesError, setFilesError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function refreshFiles() {
    fetchUploadedFiles()
      .then(setFiles)
      .catch((e: Error) => setFilesError(e.message))
  }

  useEffect(() => {
    refreshFiles()
  }, [])

  async function handleFile(file: File) {
    setError(null)
    setJob(null)
    try {
      const { job_id } = await uploadContract(file)
      refreshFiles()
      poll(job_id, file.name)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function poll(jobId: string, uploadedFilename: string) {
    const interval = setInterval(async () => {
      try {
        const status = await getUploadStatus(jobId)
        setJob(status)
        if (status.status === 'done' || status.status === 'error') {
          clearInterval(interval)
          refreshFiles()
          if (status.status === 'done') onUploaded(uploadedFilename)
        }
      } catch (e) {
        clearInterval(interval)
        setError((e as Error).message)
      }
    }, 1000)
  }

  async function handleDelete(filename: string) {
    setFilesError(null)
    try {
      await deleteUpload(filename)
      refreshFiles()
      onDeleted(filename)
    } catch (e) {
      setFilesError((e as Error).message)
    }
  }

  const currentIndex = job ? stepIndex(job.step) : -1

  return (
    <div className="px-3 py-2 border-b bg-white shrink-0 space-y-1.5">
      <label className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer inline-block">
        Upload contract PDF
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
      </label>

      {job && (
        <ul className="text-[11px] space-y-0.5">
          {STEPS.map((s, i) => {
            const skipped = s.key === 'ocr' && job.ocr_used === false
            const done = job.status === 'done' || i < currentIndex
            const active = i === currentIndex && job.status === 'running'
            const failed = i === currentIndex && job.status === 'error'
            return (
              <li
                key={s.key}
                className={
                  skipped
                    ? 'text-gray-300 line-through'
                    : failed
                      ? 'text-red-600 font-medium'
                      : active
                        ? 'text-blue-600 font-medium'
                        : done
                          ? 'text-green-600'
                          : 'text-gray-400'
                }
              >
                {failed ? '✗' : active ? '…' : done ? '✓' : '·'} {s.label}
              </li>
            )
          })}
        </ul>
      )}
      {job?.status === 'error' && <p className="text-[11px] text-red-500">{job.error}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {files.length > 0 && (
        <ul className="text-[11px] space-y-0.5 border-t pt-1.5">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center gap-1 min-w-0">
              <span
                className={`shrink-0 text-[10px] px-1 rounded ${
                  f.status === 'uploaded'
                    ? 'bg-green-100 text-green-700'
                    : f.status === 'processing'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {f.status === 'uploaded' ? 'Uploaded' : f.status === 'processing' ? 'Processing…' : 'Failed'}
              </span>
              <span className="truncate flex-1 text-gray-600">{f.filename}</span>
              <button
                onClick={() => handleDelete(f.filename)}
                className="shrink-0 text-red-500 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {filesError && <p className="text-[11px] text-red-500">{filesError}</p>}
    </div>
  )
}
