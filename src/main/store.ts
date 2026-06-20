import Store from 'electron-store'
import type { Settings } from '../shared'

const defaults: Settings = {
  exePath: 'C:\\MateSel83178\\MateSelBatch.exe',
  stopExePath: 'C:\\MateSel83178\\MateselBatchStop.exe',
  outputRootDir: '',
  saveToInputFolder: false,
  maxConcurrent: 2
}

export const store = new Store<Settings>({ defaults })
