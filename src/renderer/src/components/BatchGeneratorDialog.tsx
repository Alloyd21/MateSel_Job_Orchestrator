import { useMemo, useState } from 'react'
import type {
  BatchGenerateResult,
  BatchInspectResult,
  BatchValueMode,
  BatchVariationSpec,
  BatchWeightingRow
} from '../globals'

interface BatchGeneratorDialogProps {
  onClose: () => void
}

interface VariationDraft {
  enabled: boolean
  mode: BatchValueMode
  value: string
  increment: string
}

const modeLabels: Record<BatchValueMode, string> = {
  value: 'Value',
  range: 'Range',
  list: 'List'
}

function keyFor(rowId: string, endUseIndex: number): string {
  return `${rowId}::${endUseIndex}`
}

function parseKey(key: string): { rowId: string; endUseIndex: number } {
  const [rowId, endUseText] = key.split('::')
  return { rowId, endUseIndex: Number(endUseText) }
}

function defaultDraft(value = ''): VariationDraft {
  return { enabled: false, mode: 'value', value, increment: '1' }
}

function normalizeNumber(value: string): number {
  const number = Number(value.trim())
  if (!Number.isFinite(number)) throw new Error('Enter numeric values only')
  return number
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function expandDraft(draft: VariationDraft): string[] {
  if (draft.mode === 'value') return [formatNumber(normalizeNumber(draft.value))]
  if (draft.mode === 'list') {
    const values = draft.value.split(',').map((value) => value.trim()).filter(Boolean)
    if (values.length === 0) throw new Error('Lists need at least one value')
    return values.map((value) => formatNumber(normalizeNumber(value)))
  }

  const match = draft.value.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*-\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/)
  if (!match) throw new Error('Ranges need the form 1-4')
  const start = normalizeNumber(match[1])
  const end = normalizeNumber(match[2])
  const increment = normalizeNumber(draft.increment)
  if (increment <= 0) throw new Error('Range increment must be greater than 0')
  if (end < start) throw new Error('Range end must be greater than or equal to start')

  const values: string[] = []
  const epsilon = increment / 1_000_000
  for (let current = start; current <= end + epsilon; current += increment) {
    values.push(formatNumber(Number(current.toFixed(12))))
    if (values.length > 10000) throw new Error('Range expands to too many values')
  }
  return values
}

function isOnlyDataFileWarning(inspection: BatchInspectResult): boolean {
  return (
    inspection.needsDataFile &&
    inspection.warnings.length === 1 &&
    inspection.warnings[0] === 'No recognised MateSel data file found'
  )
}

function hasBatchApi(): boolean {
  return (
    typeof window.mateselAPI.inspectBatchStarter === 'function' &&
    typeof window.mateselAPI.generateBatchJobs === 'function'
  )
}

export function BatchGeneratorDialog({ onClose }: BatchGeneratorDialogProps): JSX.Element {
  const [starterFolder, setStarterFolder] = useState('')
  const [inspection, setInspection] = useState<BatchInspectResult | null>(null)
  const [selectedDataFileName, setSelectedDataFileName] = useState('')
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, VariationDraft>>({})
  const [allowLargeBatch, setAllowLargeBatch] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BatchGenerateResult | null>(null)

  const rows = useMemo<BatchWeightingRow[]>(() => {
    if (!inspection) return []
    return [...inspection.traits, ...inspection.markers]
  }, [inspection])

  const rowMap = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const activeRow = activeRowId ? rowMap.get(activeRowId) ?? null : null

  const enabledSpecs = useMemo<BatchVariationSpec[]>(() => {
    return Object.entries(drafts)
      .filter(([, draft]) => draft.enabled)
      .map(([key, draft]) => {
        const parsed = parseKey(key)
        return {
          ...parsed,
          mode: draft.mode,
          value: draft.value,
          increment: draft.mode === 'range' ? draft.increment : undefined
        }
      })
  }, [drafts])

  const runCount = useMemo(() => {
    try {
      if (enabledSpecs.length === 0) return { count: 0, error: null as string | null }
      const count = enabledSpecs.reduce((total, spec) => {
        const draft = drafts[keyFor(spec.rowId, spec.endUseIndex)]
        return total * expandDraft(draft).length
      }, 1)
      return { count, error: null as string | null }
    } catch (err: unknown) {
      return { count: 0, error: err instanceof Error ? err.message : String(err) }
    }
  }, [drafts, enabledSpecs])

  const hasUsableStarter =
    inspection != null &&
    (inspection.valid || isOnlyDataFileWarning(inspection)) &&
    (!inspection.needsDataFile || Boolean(selectedDataFileName))
  const canGenerate =
    hasUsableStarter &&
    enabledSpecs.length > 0 &&
    !runCount.error &&
    runCount.count > 0 &&
    (runCount.count <= 500 || allowLargeBatch) &&
    !loading

  const browseStarter = async (): Promise<void> => {
    if (!hasBatchApi()) {
      setError('Batch Generator API is not loaded. Fully quit and restart the app so Electron reloads the preload script.')
      return
    }

    const folders = await window.mateselAPI.openFolderDialog(false)
    if (folders.length === 0) return

    const folder = folders[0]
    setStarterFolder(folder)
    setInspection(null)
    setSelectedDataFileName('')
    setDrafts({})
    setActiveRowId(null)
    setResult(null)
    setError(null)
    setLoading(true)
    try {
      const nextInspection = await window.mateselAPI.inspectBatchStarter(folder)
      setInspection(nextInspection)
      if (nextInspection.needsDataFile) {
        const fallback =
          nextInspection.files.find((file) => /^DataFile.*\.(csv|txt)$/i.test(file)) ??
          nextInspection.files.find((file) => !/^Matesel\.ini$|^InpOneGroup\.txt$/i.test(file)) ??
          ''
        setSelectedDataFileName(fallback)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const setRowEnabled = (row: BatchWeightingRow, enabled: boolean): void => {
    setActiveRowId(enabled ? row.id : activeRowId === row.id ? null : activeRowId)
    setDrafts((prev) => {
      const next = { ...prev }
      for (let index = 0; index < (inspection?.endUseCount ?? 0); index += 1) {
        const key = keyFor(row.id, index)
        const existing = next[key] ?? defaultDraft(row.values[index] ?? '')
        next[key] = { ...existing, enabled: enabled && index === 0 }
      }
      return next
    })
  }

  const updateDraft = (row: BatchWeightingRow, endUseIndex: number, patch: Partial<VariationDraft>): void => {
    const key = keyFor(row.id, endUseIndex)
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? defaultDraft(row.values[endUseIndex] ?? '')),
        ...patch
      }
    }))
  }

  const isRowEnabled = (row: BatchWeightingRow): boolean => {
    return Array.from({ length: inspection?.endUseCount ?? 0 }, (_, index) => drafts[keyFor(row.id, index)]).some(
      (draft) => draft?.enabled
    )
  }

  const handleGenerate = async (): Promise<void> => {
    if (!canGenerate || !inspection) return
    if (!hasBatchApi()) {
      setError('Batch Generator API is not loaded. Fully quit and restart the app so Electron reloads the preload script.')
      return
    }

    const destinationFolders = await window.mateselAPI.openFolderDialog(false)
    if (destinationFolders.length === 0) return

    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const generated = await window.mateselAPI.generateBatchJobs({
        starterFolder,
        destinationParent: destinationFolders[0],
        selectedDataFileName: selectedDataFileName || inspection.dataFileName,
        variations: enabledSpecs,
        allowLargeBatch
      })
      setResult(generated)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const renderRowList = (title: string, sectionRows: BatchWeightingRow[]): JSX.Element => (
    <div className={`flex shrink-0 flex-col ${title === 'Markers' ? 'border-t border-slate-700 pt-4' : ''}`}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="flex flex-col gap-1">
        {sectionRows.map((row) => {
          const enabled = isRowEnabled(row)
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                if (!enabled) setRowEnabled(row, true)
                setActiveRowId(row.id)
              }}
              className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left text-xs ${
                activeRowId === row.id
                  ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'
              }`}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setRowEnabled(row, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">
                {row.values.join(', ')}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl bg-slate-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Batch Weighting Generator</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Generate ready jobs from one starter folder by varying trait and marker weights.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <button
              onClick={browseStarter}
              disabled={loading}
              className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Select starter
            </button>
            <div className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">
              {starterFolder || 'No starter job selected'}
            </div>
            {inspection && (
              <div className="shrink-0 text-right text-xs text-slate-400">
                <div>
                  {inspection.endUseCount} EndUses, {inspection.traits.length} traits, {inspection.markerLocusCount} marker loci
                </div>
                {inspection.weightingFileName && (
                  <div className="font-mono text-[10px] text-slate-500">
                    weights: {inspection.weightingFileName}
                  </div>
                )}
              </div>
            )}
          </div>

          {inspection?.needsDataFile && (
            <label className="flex items-center gap-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">
              <span className="font-semibold">Data file</span>
              <select
                value={selectedDataFileName}
                onChange={(event) => setSelectedDataFileName(event.target.value)}
                className="min-w-0 flex-1 rounded border border-amber-700 bg-slate-950 px-2 py-1.5 text-slate-100"
              >
                {inspection.files.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </select>
            </label>
          )}

          {inspection && inspection.warnings.length > 0 && !isOnlyDataFileWarning(inspection) && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-100">
              {inspection.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}

          {inspection && (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,380px)_1fr] gap-4">
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-3">
                {renderRowList('Traits', inspection.traits)}
                {renderRowList('Markers', inspection.markers)}
              </div>

              <div className="min-h-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4">
                {activeRow ? (
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{activeRow.name}</div>
                      <div className="text-xs text-slate-500">
                        {activeRow.kind === 'trait' ? 'Trait weighting' : 'Marker weighting'}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {Array.from({ length: inspection.endUseCount }, (_, index) => {
                        const key = keyFor(activeRow.id, index)
                        const draft = drafts[key] ?? defaultDraft(activeRow.values[index] ?? '')
                        return (
                          <div key={key} className="rounded border border-slate-700 bg-slate-950 p-3">
                            <label className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-200">EndUse {index + 1}</span>
                              <span className="font-mono text-[11px] text-slate-500">
                                default {activeRow.values[index]}
                              </span>
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(event) => updateDraft(activeRow, index, { enabled: event.target.checked })}
                                className="h-3.5 w-3.5"
                              />
                            </label>

                            <div className="mt-3 grid grid-cols-[120px_1fr] gap-2">
                              <select
                                value={draft.mode}
                                onChange={(event) =>
                                  updateDraft(activeRow, index, { mode: event.target.value as BatchValueMode })
                                }
                                disabled={!draft.enabled}
                                className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-40"
                              >
                                {(Object.keys(modeLabels) as BatchValueMode[]).map((mode) => (
                                  <option key={mode} value={mode}>
                                    {modeLabels[mode]}
                                  </option>
                                ))}
                              </select>
                              <input
                                value={draft.value}
                                onChange={(event) => updateDraft(activeRow, index, { value: event.target.value })}
                                disabled={!draft.enabled}
                                placeholder={draft.mode === 'list' ? '1,4,7,98' : draft.mode === 'range' ? '1-4' : '1'}
                                className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-40"
                              />
                              {draft.mode === 'range' && (
                                <>
                                  <span className="self-center text-xs text-slate-500">Increment</span>
                                  <input
                                    value={draft.increment}
                                    onChange={(event) => updateDraft(activeRow, index, { increment: event.target.value })}
                                    disabled={!draft.enabled}
                                    placeholder="0.1"
                                    className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-40"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    Select a trait or marker to edit EndUse values
                  </div>
                )}
              </div>
            </div>
          )}

          {(error || runCount.error || result) && (
            <div
              className={`rounded-lg border p-3 text-xs ${
                result && !error && !runCount.error
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-100'
                  : 'border-red-800 bg-red-950/40 text-red-100'
              }`}
            >
              {error ?? runCount.error ?? (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    Generated {result?.generatedFolders.length} jobs in{' '}
                    <span className="font-mono">{result?.batchFolder}</span>
                  </span>
                  {result?.batchFolder && (
                    <button
                      onClick={() => window.mateselAPI.openPath(result.batchFolder)}
                      className="rounded bg-emerald-800 px-2 py-1 text-emerald-100 hover:bg-emerald-700"
                    >
                      Open folder
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-700 px-5 py-3">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>
              Runs: <span className="font-semibold text-slate-200">{runCount.count}</span>
            </span>
            {runCount.count > 500 && (
              <label className="flex items-center gap-2 text-amber-200">
                <input
                  type="checkbox"
                  checked={allowLargeBatch}
                  onChange={(event) => setAllowLargeBatch(event.target.checked)}
                />
                Confirm more than 500 runs
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded bg-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {loading ? 'Working...' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
