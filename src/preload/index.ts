import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'

contextBridge.exposeInMainWorld('mateselAPI', {
  getAllJobs: () => ipcRenderer.invoke(IPC.JOBS_GET_ALL),
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
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, targetPath),

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
  }
})
