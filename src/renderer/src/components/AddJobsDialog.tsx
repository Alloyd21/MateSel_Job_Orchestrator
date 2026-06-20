import { useState, type DragEvent } from 'react'
import type { AddJobRequest, AddJobResult } from '../../../shared'

interface AddJobsDialogProps {
  onClose: () => void
  onAdd: (jobs: Array<string | AddJobRequest>) => Promise<AddJobResult[]>
}

export function AddJobsDialog({ onClose, onAdd }: AddJobsDialogProps): JSX.Element {
  const [folders, setFolders] = useState<string[]>([])
  const [queuedFolders, setQueuedFolders] = useState<Set<string>>(new Set())
  const [pendingDataFiles, setPendingDataFiles] = useState<AddJobResult[]>([])
  const [selectedDataFiles, setSelectedDataFiles] = useState<Record<string, string>>({})
  const [draggingFolders, setDraggingFolders] = useState(false)
  const [loading, setLoading] = useState(false)
  const hasAllSelectedDataFiles =
    pendingDataFiles.length === 0 ||
    pendingDataFiles.every((result) => Boolean(selectedDataFiles[result.folder]))

  const addFolders = (selected: string[]): void => {
    if (selected.length === 0) return
    setFolders((prev) => [...prev, ...selected.filter((f) => !prev.includes(f))])
  }

  const browse = async (): Promise<void> => {
    addFolders(await window.mateselAPI.openFolderDialog())
  }

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingFolders(true)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    setDraggingFolders(false)
    addFolders(
      Array.from(event.dataTransfer.files)
        .map((file) => window.mateselAPI.getDroppedFilePath(file))
        .filter(Boolean)
    )
  }

  const remove = (folder: string): void => {
    setFolders((prev) => prev.filter((f) => f !== folder))
    setPendingDataFiles((prev) => prev.filter((result) => result.folder !== folder))
    setSelectedDataFiles((prev) => {
      const next = { ...prev }
      delete next[folder]
      return next
    })
  }

  const handleAdd = async (): Promise<void> => {
    if (folders.length === 0) return
    setLoading(true)
    const foldersToAdd = folders.filter((folder) => !queuedFolders.has(folder))
    const results = await onAdd(foldersToAdd)
    setLoading(false)
    const needsDataFiles = results.filter((result) => result.needsDataFile)
    const queued = results.filter((result) => result.valid && !result.needsDataFile).map((result) => result.folder)
    setQueuedFolders((prev) => new Set([...prev, ...queued]))
    if (needsDataFiles.length > 0) {
      setPendingDataFiles(needsDataFiles)
      setSelectedDataFiles(
        Object.fromEntries(
          needsDataFiles.map((result) => [result.folder, result.files?.[0] ?? ''])
        )
      )
      return
    }
    onClose()
  }

  const handleAddSelectedDataFiles = async (): Promise<void> => {
    const jobs = pendingDataFiles
      .map((result) => ({
        folder: result.folder,
        dataFileName: selectedDataFiles[result.folder]
      }))
      .filter((job): job is { folder: string; dataFileName: string } =>
        Boolean(job.dataFileName)
      )

    if (jobs.length !== pendingDataFiles.length) return

    setLoading(true)
    const results = await onAdd(jobs)
    setLoading(false)
    const unresolved = results.filter((result) => result.needsDataFile || !result.valid)
    if (unresolved.length > 0) {
      setPendingDataFiles(unresolved)
      return
    }

    setQueuedFolders((prev) => new Set([...prev, ...jobs.map((job) => job.folder)]))
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">Add MateSel Jobs</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Select job folders or parent folders containing multiple jobs.
          </p>
        </div>

        <div className="p-5 flex flex-col gap-3 min-h-0">
          <button
            onClick={browse}
            onDragOver={handleDragOver}
            onDragLeave={() => setDraggingFolders(false)}
            onDrop={handleDrop}
            className={`w-full py-2 border border-dashed rounded-lg text-sm transition-colors ${
              draggingFolders
                ? 'border-blue-400 bg-blue-950/40 text-blue-200'
                : 'border-slate-500 text-slate-300 hover:border-blue-400 hover:text-blue-300'
            }`}
          >
            {draggingFolders ? 'Drop folder(s) to add' : '+ Browse for job folder(s) or parent folder'}
          </button>

          {folders.length > 0 && (
            <div className="flex flex-col gap-2 min-h-0">
              <div className="text-xs font-medium text-slate-300">
                {folders.length} run{folders.length !== 1 ? 's' : ''} detected
              </div>
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {folders.map((f) => (
                  <div
                    key={f}
                    className="flex items-center justify-between gap-2 bg-slate-700 rounded px-3 py-2"
                  >
                    <span className="text-xs text-slate-200 truncate font-mono">{f}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {queuedFolders.has(f) && (
                        <span className="rounded bg-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">
                          Queued
                        </span>
                      )}
                      <button
                        onClick={() => remove(f)}
                        className="text-slate-400 hover:text-red-400 text-xs"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingDataFiles.length > 0 && (
            <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3">
              <div className="text-sm font-semibold text-amber-100">Select data file</div>
              <p className="mt-1 text-xs text-amber-200">
                No recognised MateSel data file was found. Choose the file to pass to MateSel for each folder.
              </p>
              <div className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
                {pendingDataFiles.map((result) => (
                  <label key={result.folder} className="flex flex-col gap-1">
                    <span className="font-mono text-xs text-slate-300 break-all">{result.folder}</span>
                    <select
                      value={selectedDataFiles[result.folder] ?? ''}
                      onChange={(event) =>
                        setSelectedDataFiles((prev) => ({
                          ...prev,
                          [result.folder]: event.target.value
                        }))
                      }
                      className="rounded bg-slate-900 border border-slate-600 px-2 py-1.5 text-xs text-slate-100"
                    >
                      {(result.files ?? []).map((fileName) => (
                        <option key={fileName} value={fileName}>
                          {fileName}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={pendingDataFiles.length > 0 ? handleAddSelectedDataFiles : handleAdd}
            disabled={folders.length === 0 || loading || !hasAllSelectedDataFiles}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            {loading ? 'Adding...' : pendingDataFiles.length > 0 ? 'Add selected files' : `Add ${folders.length > 0 ? `${folders.length} ` : ''}Job${folders.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
