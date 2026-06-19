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

function BatchChangesTable({ rows }: { rows: NonNullable<Job['batchChanges']> }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">Batch Changes</div>
      <div className="max-h-44 overflow-auto rounded border border-slate-700 bg-slate-950">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-800 text-slate-400">
            <tr>
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">EndUse</th>
              <th className="px-2 py-1.5 font-medium">Default</th>
              <th className="px-2 py-1.5 font-medium">This run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {rows.map((row, index) => (
              <tr key={`${row.item}-${row.endUse}-${index}`}>
                <td className="px-2 py-1.5">{row.item}</td>
                <td className="px-2 py-1.5 text-slate-300">{row.type}</td>
                <td className="px-2 py-1.5 font-mono text-slate-300">{row.endUse}</td>
                <td className="px-2 py-1.5 font-mono text-slate-300">{row.defaultValue}</td>
                <td className="px-2 py-1.5 font-mono text-slate-100">{row.thisRun}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function JobDetailPanel({
  job,
  onCancel,
  onStart,
  onRestart
}: {
  job: Job
  onCancel: (id: string) => void
  onStart: (id: string) => void
  onRestart: (id: string) => void
}): JSX.Element {
  const canCancel = job.status === 'queued' || job.status === 'running'
  const canStart = job.status === 'ready'
  const canRestart = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
  const canOpenOutputDir = Boolean(job.outputDir)
  const runId = job.outputDir ? getRunId(job.outputDir) : '-'
  const batchChanges = job.batchChanges ?? []

  const handleOpenOutputDir = async (): Promise<void> => {
    if (!job.outputDir) return
    await window.mateselAPI.openPath(job.outputDir)
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-100 break-all">{job.name}</h2>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5 break-all">{job.jobFolder}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {job.aboveNormalPriority && job.status === 'running' && (
            <span
              className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400"
              title="This job's process is running at above normal OS priority"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              Above Normal Priority
            </span>
          )}
          {canStart && (
            <button
              onClick={() => onStart(job.id)}
              className="text-xs px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-emerald-50 font-medium"
            >
              Start
            </button>
          )}
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
        {job.itersSinceLastChange != null && (
          <div>
            <span className="text-slate-500">Iters since last change</span>
            <div className="font-mono text-slate-200">{job.itersSinceLastChange.toLocaleString()}</div>
          </div>
        )}
        {job.exitCode != null && (
          <div>
            <span className="text-slate-500">Exit code</span>
            <div className="font-mono">{job.exitCode}</div>
          </div>
        )}
      </div>

      {batchChanges.length > 0 && <BatchChangesTable rows={batchChanges} />}

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
