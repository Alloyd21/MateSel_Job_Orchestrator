import type { Job } from '../types/job'
import { LogViewer } from './LogViewer'
import { StatusBadge } from './StatusBadge'

function FolderIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  )
}

function formatTime(ts?: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString()
}

function formatElapsed(start?: number | null, end?: number | null): string {
  if (!start) return '-'
  const ms = (end ?? Date.now()) - start
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function getRunId(outputDir: string): string {
  const parts = outputDir.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? '-'
}

export function JobDetailPanel({
  job,
  onCancel,
  onRestart
}: {
  job: Job
  onCancel: (id: string) => void
  onRestart: (id: string) => void
}): JSX.Element {
  const canCancel = job.status === 'ready' || job.status === 'queued' || job.status === 'running'
  const canRestart = job.status === 'failed'
  const canOpenOutputDir = Boolean(job.outputDir)
  const runId = job.outputDir ? getRunId(job.outputDir) : '-'

  const handleOpenOutputDir = async (): Promise<void> => {
    if (!job.outputDir) return
    await window.mateselAPI.openPath(job.outputDir)
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 break-all">{job.name}</h2>
          <p className="text-xs text-slate-400 mt-0.5 break-all">{job.jobFolder}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={job.status} />
          {canCancel && (
            <button
              onClick={() => onCancel(job.id)}
              className="text-xs px-2.5 py-1 rounded bg-red-800 hover:bg-red-700 text-red-100"
            >
              Cancel
            </button>
          )}
          {canRestart && (
            <button
              onClick={() => onRestart(job.id)}
              className="text-xs px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-600 text-blue-100"
            >
              Restart
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-300">
        <div>
          <span className="text-slate-500">RunID</span>
          <div className="font-mono text-slate-200 break-all">{runId}</div>
        </div>
        <div>
          <span className="text-slate-500">Output directory</span>
          <div className="flex items-center gap-2">
            <div className="font-mono text-slate-200 break-all min-w-0">{job.outputDir || '-'}</div>
            {canOpenOutputDir && (
              <button
                type="button"
                onClick={handleOpenOutputDir}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                title="Open output directory"
                aria-label="Open output directory"
              >
                <FolderIcon />
              </button>
            )}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Started</span>
          <div className="font-mono">{formatTime(job.startedAt)}</div>
        </div>
        <div>
          <span className="text-slate-500">Finished</span>
          <div className="font-mono">{formatTime(job.finishedAt)}</div>
        </div>
        <div className="col-span-2">
          <span className="text-slate-500">Data file</span>
          <div className="font-mono text-slate-200 break-all">{job.dataFileName ?? 'No data file selected'}</div>
        </div>
        <div>
          <span className="text-slate-500">Elapsed</span>
          <div className="font-mono">{formatElapsed(job.startedAt, job.finishedAt)}</div>
        </div>
        {job.exitCode != null && (
          <div>
            <span className="text-slate-500">Exit code</span>
            <div className="font-mono">{job.exitCode}</div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
          <span>Console Output</span>
          <span>{job.log.length} lines</span>
        </div>
        <div className="h-full">
          <LogViewer lines={job.log} />
        </div>
      </div>
    </div>
  )
}
