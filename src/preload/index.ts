import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../main/ipc/channels'

contextBridge.exposeInMainWorld('mateselAPI', {
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  getAllJobs: () => ipcRenderer.invoke(IPC.JOBS_GET_ALL),
  inspectBatchStarter: (starterFolder: string) =>
    ipcRenderer.invoke(IPC.BATCH_INSPECT_STARTER, starterFolder),
  generateBatchJobs: (payload: {
    starterFolder: string
    destinationParent: string
    batchName?: string
    batchTimestamp?: string
    selectedDataFileName?: string
    variations: Array<{
      rowId: string
      endUseIndex: number
      mode: 'value' | 'range' | 'list'
      value: string
      increment?: string
    }>
    allowLargeBatch?: boolean
  }) => ipcRenderer.invoke(IPC.BATCH_GENERATE, payload),
  addJobs: (jobs: Array<string | { folder: string; dataFileName?: string }>) =>
    ipcRenderer.invoke(IPC.JOB_ADD, jobs),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_CANCEL, jobId),
  cancelAllJobs: () => ipcRenderer.invoke(IPC.JOB_CANCEL_ALL),
  clearCompletedJobs: () => ipcRenderer.invoke(IPC.JOB_CLEAR_COMPLETED),
  restartJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_RESTART, jobId),
  startJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_START, jobId),
  startAllJobs: () => ipcRenderer.invoke(IPC.JOB_START_ALL),

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),

  openFolderDialog: (discoverJobs = true) => ipcRenderer.invoke(IPC.DIALOG_OPEN_FOLDER, discoverJobs),
  openFileDialog: (filters: Electron.FileFilter[]) =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, filters),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, targetPath),
  installUpdateAndRestart: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL_AND_RESTART),

  onStatusUpdate: (cb: (patch: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: Record<string, unknown>): void => cb(data)
    ipcRenderer.on(IPC.JOB_STATUS_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.JOB_STATUS_UPDATE, handler)
  },

  onLogChunk: (cb: (payload: { jobId: string; text: string }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { jobId: string; text: string }
    ): void => cb(data)
    ipcRenderer.on(IPC.JOB_LOG_CHUNK, handler)
    return () => ipcRenderer.removeListener(IPC.JOB_LOG_CHUNK, handler)
  },

  onUpdateReady: (cb: (payload: { version: string | null }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { version: string | null }
    ): void => cb(data)
    ipcRenderer.on(IPC.UPDATE_READY, handler)
    return () => ipcRenderer.removeListener(IPC.UPDATE_READY, handler)
  }
})
