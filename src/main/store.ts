import Store from 'electron-store'

export interface Settings {
  exePath: string
  stopExePath: string
  outputRootDir: string
  saveToInputFolder: boolean
  maxConcurrent: number
}

const defaults: Settings = {
  exePath: 'C:\\MateSel83178\\MateSelBatch.exe',
  stopExePath: 'C:\\MateSel83178\\MateselBatchStop.exe',
  outputRootDir: '',
  saveToInputFolder: false,
  maxConcurrent: 2
}

export const store = new Store<Settings>({ defaults })
