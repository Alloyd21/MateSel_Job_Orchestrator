import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MateSelAPI } from '../shared'
import { IPC } from '../main/ipc/channels'

const api: MateSelAPI = {
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  getAllJobs: () => ipcRenderer.invoke(IPC.JOBS_GET_ALL),
  inspectBatchStarter: (starterFolder: string) =>
    ipcRenderer.invoke(IPC.BATCH_INSPECT_STARTER, starterFolder),
  generateBatchJobs: (payload) => ipcRenderer.invoke(IPC.BATCH_GENERATE, payload),
  addJobs: (jobs) => ipcRenderer.invoke(IPC.JOB_ADD, jobs),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_CANCEL, jobId),
  cancelAllJobs: () => ipcRenderer.invoke(IPC.JOB_CANCEL_ALL),
  clearCompletedJobs: () => ipcRenderer.invoke(IPC.JOB_CLEAR_COMPLETED),
  restartJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_RESTART, jobId),
  startJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_START, jobId),
  startAllJobs: () => ipcRenderer.invoke(IPC.JOB_START_ALL),

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),

  openFolderDialog: (discoverJobs = true) => ipcRenderer.invoke(IPC.DIALOG_OPEN_FOLDER, discoverJobs),
  openFileDialog: (filters) => ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, filters),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, targetPath),
  installUpdateAndRestart: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL_AND_RESTART),

  onStatusUpdate: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, data: Parameters<typeof cb>[0]): void => cb(data)
    ipcRenderer.on(IPC.JOB_STATUS_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.JOB_STATUS_UPDATE, handler)
  },

  onLogChunk: (cb) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { jobId: string; text: string }
    ): void => cb(data)
    ipcRenderer.on(IPC.JOB_LOG_CHUNK, handler)
    return () => ipcRenderer.removeListener(IPC.JOB_LOG_CHUNK, handler)
  },

  onUpdateReady: (cb) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { version: string | null }
    ): void => cb(data)
    ipcRenderer.on(IPC.UPDATE_READY, handler)
    return () => ipcRenderer.removeListener(IPC.UPDATE_READY, handler)
  }
}

contextBridge.exposeInMainWorld('mateselAPI', api)
