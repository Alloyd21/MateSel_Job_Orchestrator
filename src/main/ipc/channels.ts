export const IPC = {
  JOB_ADD: 'job:add',
  JOB_CANCEL: 'job:cancel',
  JOB_CANCEL_ALL: 'job:cancel-all',
  JOB_CLEAR_COMPLETED: 'job:clear-completed',
  JOB_RESTART: 'job:restart',
  JOB_START: 'job:start',
  JOB_START_ALL: 'job:start-all',
  JOB_STATUS_UPDATE: 'job:status-update',
  JOB_LOG_CHUNK: 'job:log-chunk',
  JOBS_GET_ALL: 'jobs:get-all',
  BATCH_INSPECT_STARTER: 'batch:inspect-starter',
  BATCH_GENERATE: 'batch:generate',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  SHELL_OPEN_PATH: 'shell:open-path'
} as const
