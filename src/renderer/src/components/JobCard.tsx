import { useEffect, useState } from 'react'
import type { Job } from '../types/job'
import { StatusBadge } from './StatusBadge'

function PlayIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function JobCard({
  job,
  selected,
  onClick,
  onStart
}: {
  job: Job
  selected: boolean
  onClick: () => void
  onStart: () => void
}): JSX.Element {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (job.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [job.status])

  const elapsed =
    job.startedAt
      ? formatElapsed((job.finishedAt ?? now) - job.startedAt)
      : null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
      className={`w-full cursor-pointer text-left px-3 py-2.5 rounded-lg transition-colors ${
        selected ? 'bg-slate-600' : 'hover:bg-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-100 truncate">{job.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {job.status === 'ready' && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onStart()
              }}
              className="rounded p-1 text-emerald-200 hover:bg-emerald-800 hover:text-white"
              title="Start job"
              aria-label="Start job"
            >
              <PlayIcon />
            </button>
          )}
          <StatusBadge status={job.status} />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {elapsed && (
          <span className="text-xs text-slate-400 font-mono">{elapsed}</span>
        )}
        {job.aboveNormalPriority && job.status === 'running' && (
          <span className="flex items-center gap-0.5 text-xs font-medium text-amber-400" title="Running at above normal priority">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            High Priority
          </span>
        )}
      </div>
      {job.stage && (
        <div className="mt-1 truncate text-xs font-medium text-cyan-200">
          {job.stage}
        </div>
      )}
    </div>
  )
}
