import { useEffect, useRef, useState } from 'react'
import { deleteUpload, fetchUploadedFiles, getUploadStatus, uploadContract } from '../api'
import type { UploadedFile, UploadJob, UploadStep } from '../types'

interface Props {
  onUploaded: (filename: string) => void
  onDeleted: (filename: string) => void
}

const STEPS: { key: UploadStep; label: string }[] = [
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
    <div className="px-3 py-2 border-t bg-white shrink-0 h-56 overflow-y-auto space-y-2">
      <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Upload</div>
      <label className="w-full text-xs px-2 py-1.5 rounded bg-accent text-white hover:bg-accent-hover cursor-pointer flex items-center justify-center gap-1.5">
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
            const done = job.status === 'done' || i < currentIndex
            const active = i === currentIndex && job.status === 'running'
            const failed = i === currentIndex && job.status === 'error'
            return (
              <li
                key={s.key}
                className={
                  failed
                    ? 'text-danger font-medium'
                    : active
                      ? 'text-accent font-medium'
                      : done
                        ? 'text-success'
                        : 'text-neutral-400'
                }
              >
                {failed ? '✗' : active ? '…' : done ? '✓' : '·'} {s.label}
              </li>
            )
          })}
        </ul>
      )}
      {job?.status === 'error' && <p className="text-[11px] text-danger">{job.error}</p>}
      {error && <p className="text-[11px] text-danger">{error}</p>}

      {files.length > 0 && (
        <ul className="text-[11px] space-y-1 border-t pt-2">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center gap-1.5 min-w-0">
              <span
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                  f.status === 'uploaded'
                    ? 'bg-success-bg text-success-text'
                    : f.status === 'processing'
                      ? 'bg-accent-subtle/20 text-accent'
                      : 'bg-danger/10 text-danger'
                }`}
              >
                {f.status === 'uploaded' ? 'Uploaded' : f.status === 'processing' ? 'Processing…' : 'Failed'}
              </span>
              <span className="truncate flex-1 text-neutral-500">{f.filename}</span>
              <button
                onClick={() => handleDelete(f.filename)}
                className="shrink-0 text-danger hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {filesError && <p className="text-[11px] text-danger">{filesError}</p>}
    </div>
  )
}
