import type { Job, JobStatus } from '../../../shared'
import { JobCard } from './JobCard'

interface JobQueuePanelProps {
  jobs: Job[]
  selectedJobId: string | null
  onSelect: (id: string) => void
  onStart: (id: string) => void
  onStartAll: () => void
  onStopAll: () => void
  bulkAction: 'starting' | 'stopping' | null
  onClearCompleted: () => void
  onClearAll: () => void
  onAddJobs: () => void
}

const terminalStatuses: JobStatus[] = ['done', 'failed', 'cancelled']

export function JobQueuePanel({
  jobs,
  selectedJobId,
  onSelect,
  onStart,
  onStartAll,
  onStopAll,
  bulkAction,
  onClearCompleted,
  onClearAll,
  onAddJobs
}: JobQueuePanelProps): JSX.Element {
  const hasCompleted = jobs.some((j) => terminalStatuses.includes(j.status))
  const hasReady = jobs.some((j) => j.status === 'ready')
  const readyCount = jobs.filter((j) => j.status === 'ready').length
  const activeCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length
  const showStartAll = readyCount > 0
  const showStopAll = activeCount > 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Job Queue
          </span>
          <span className="text-xs text-slate-500">{jobs.length} jobs</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {jobs.length === 0 ? (
          <p className="text-xs text-slate-500 text-center mt-8 px-4">
            No jobs yet. Click{' '}
            <button
              type="button"
              onClick={onAddJobs}
              className="font-semibold text-slate-300 hover:text-white"
            >
              + Add Jobs
            </button>{' '}
            to get started.
          </p>
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              selected={job.id === selectedJobId}
              onClick={() => onSelect(job.id)}
              onStart={() => onStart(job.id)}
            />
          ))
        )}
      </div>

      {(showStartAll || showStopAll || hasCompleted || hasReady) && (
        <div className="px-3 py-2 border-t border-slate-700 space-y-2">
          {showStartAll && (
            <button
              type="button"
              onClick={onStartAll}
              disabled={bulkAction !== null}
              className="flex w-full items-center justify-center gap-2 rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
            >
              {bulkAction === 'starting' && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {bulkAction === 'starting' ? 'Starting...' : 'Start all ready'}
            </button>
          )}
          {showStopAll && (
            <button
              type="button"
              onClick={onStopAll}
              disabled={bulkAction !== null}
              className="flex w-full items-center justify-center gap-2 rounded bg-red-800 px-3 py-2 text-xs font-semibold text-red-50 hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
            >
              {bulkAction === 'stopping' && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {bulkAction === 'stopping' ? 'Stopping...' : 'Stop all'}
            </button>
          )}
          <button
            onClick={onClearCompleted}
            className={`w-full rounded px-3 py-2 text-xs font-semibold ${
              hasCompleted
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                : 'cursor-not-allowed bg-slate-800 text-slate-600'
            }`}
            disabled={!hasCompleted}
          >
            Clear completed
          </button>
          <button
            onClick={onClearAll}
            className="w-full rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
