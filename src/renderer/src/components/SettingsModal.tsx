import { useEffect, useState } from 'react'
import type { Settings, SystemCapacity } from '../../../shared'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [capacity, setCapacity] = useState<SystemCapacity | null>(null)
  const [saving, setSaving] = useState(false)
  const maxJobs = capacity?.maxConcurrentJobs ?? 1

  useEffect(() => {
    Promise.all([window.mateselAPI.getSettings(), window.mateselAPI.getSystemCapacity()]).then(
      ([value, systemCapacity]) => {
        setCapacity(systemCapacity)
        setSettings({
          ...value,
          maxConcurrent: Math.min(value.maxConcurrent, systemCapacity.maxConcurrentJobs)
        })
      }
    )
  }, [])

  const patch = (key: keyof Settings, value: string | number | boolean): void => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const browsePath = async (key: keyof Settings): Promise<void> => {
    const file: string | null = await window.mateselAPI.openFileDialog([
      { name: 'Executables', extensions: ['exe'] }
    ])
    if (file) patch(key, file)
  }

  const browseDir = async (): Promise<void> => {
    const dirs: string[] = await window.mateselAPI.openFolderDialog(false)
    if (dirs.length > 0) patch('outputRootDir', dirs[0])
  }

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    await window.mateselAPI.setSettings(settings)
    setSaving(false)
    onClose()
  }

  if (!settings || !capacity) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="text-slate-400 text-sm">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">Settings</h2>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <Field label="MateSel Batch Exe">
            <PathInput
              value={settings.exePath}
              onChange={(v) => patch('exePath', v)}
              onBrowse={() => browsePath('exePath')}
            />
          </Field>

          <Field label="MateSel Stop Exe">
            <PathInput
              value={settings.stopExePath}
              onChange={(v) => patch('stopExePath', v)}
              onBrowse={() => browsePath('stopExePath')}
            />
          </Field>

          <Field label="Output Root Directory">
            <PathInput
              value={settings.outputRootDir}
              onChange={(v) => patch('outputRootDir', v)}
              onBrowse={browseDir}
              placeholder="Select where job output folders will be created"
              disabled={settings.saveToInputFolder}
            />
          </Field>

          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={settings.saveToInputFolder}
              onChange={(e) => patch('saveToInputFolder', e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <span>
              Save output to input directory
            </span>
          </label>

          <Field label={`Max Parallel Jobs: ${settings.maxConcurrent}`}>
            <input
              type="range"
              min={1}
              max={maxJobs}
              value={settings.maxConcurrent}
              onChange={(e) => patch('maxConcurrent', Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-0.5">
              <span>1</span>
              <span>{maxJobs}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Detected{' '}
              <span className="text-slate-300 font-medium">
                {capacity.logicalProcessors} logical processors
              </span>
              . The maximum is limited to 80% to leave
              capacity for the operating system and other applications.
            </p>
          </Field>
        </div>

        <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function PathInput({
  value,
  onChange,
  onBrowse,
  placeholder,
  disabled = false
}: {
  value: string
  onChange: (v: string) => void
  onBrowse: () => void
  placeholder?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 disabled:opacity-45 disabled:cursor-not-allowed"
      />
      <button
        onClick={onBrowse}
        disabled={disabled}
        className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-slate-200 whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-slate-600"
      >
        Browse
      </button>
    </div>
  )
}
