# MateSel Job Orchestrator

Electron desktop app for staging and running multiple MateSel batch jobs with a small queue UI, live `Console.txt` streaming, and per-job output folders.

## Requirements

- Windows
- Node.js/npm
- MateSel batch installation
- `RunToken.txt` beside `MateSelBatch.exe`

## Commands

```powershell
npm install
npm run dev
npm run build
npm run package
```

`npm run build` generates Electron output in `out/`. Packaging uses Electron Builder and writes to `dist/`.

## App Flow

1. User adds one or more MateSel job folders.
2. Main process validates each folder and creates `ready` jobs.
3. User starts one job with the play icon, or starts all ready jobs.
4. Started jobs become `queued`; the queue runner starts jobs up to `maxConcurrent`.
5. Each running job gets an output directory unless settings say to save in the input folder.
6. `MateSelBatch.exe` is launched from its own install directory so `RunToken.txt` is found.
7. The app streams MateSel output from stdout/stderr and follows the active `Console.txt`.
8. Finished jobs become `done` or `failed`; active jobs can be cancelled with `MateselBatchStop.exe`.

## Architecture

```text
src/main
  index.ts              Electron main window bootstrap
  store.ts              Persistent app settings
  jobQueue.ts           Queue state, start/stop/restart lifecycle
  processRunner.ts      MateSel process launch, cancellation, console streaming
  fileManager.ts        Job discovery, validation, output folder and data-file prep
  ipc/
    channels.ts         IPC channel constants
    handlers.ts         Main-process IPC handlers

src/preload
  index.ts              Safe renderer API exposed as window.mateselAPI

src/renderer/src
  App.tsx               Top-level UI and event wiring
  store/jobStore.ts     Renderer-side Zustand job state
  components/           Queue, detail panel, settings, dialogs, log viewer
  types/job.ts          Shared renderer job/settings types
```

## Key Functions

- `enqueue(jobFolder)` in `src/main/jobQueue.ts`  
  Adds a validated job as `ready` without starting it.

- `start(jobId)` / `startAll()` in `src/main/jobQueue.ts`  
  Move ready jobs to `queued`, then call `tick()`.

- `tick()` in `src/main/jobQueue.ts`  
  Starts queued jobs while below `maxConcurrent`, creates output directories, sends UI status updates, and calls `prepareAndStart()`.

- `prepareAndStart(...)` in `src/main/processRunner.ts`  
  Copies input files when needed, checks `RunToken.txt`, prepares the data file, and starts MateSel.

- `startJob(...)` in `src/main/processRunner.ts`  
  Spawns `MateSelBatch.exe` with `cwd` set to the executable directory and passes the prepared data file as an absolute path.

- `startConsoleLogStreaming(...)` in `src/main/processRunner.ts`  
  Polls the active `Console.txt` and streams new content to the renderer.

- `findMateSelDataFileName(folderPath)` in `src/main/fileManager.ts`  
  Accepts `Matesel.txt`, `MateselClassicDemo.txt`, `DataFile*.txt`, or `DataFile*.csv`.

- `prepareMateSelDataFile(outputDir)` in `src/main/fileManager.ts`  
  Converts accepted CSV input into `Matesel.txt`; text inputs are passed through unchanged.

## Job Statuses

- `ready`: loaded and waiting for user action
- `queued`: started by the user, waiting for capacity
- `running`: handed to MateSel
- `done`: completed without fatal output
- `failed`: process failed or MateSel reported fatal output
- `cancelled`: cancelled by user

## Settings

Settings are stored with `electron-store` in `src/main/store.ts`.

- `exePath`: path to `MateSelBatch.exe`
- `stopExePath`: path to `MateselBatchStop.exe`
- `outputRootDir`: base folder for generated run output
- `saveToInputFolder`: write output into the source job folder instead
- `maxConcurrent`: number of MateSel jobs allowed to run at once

## Cache

Job history and recent console lines are cached with `electron-store` using the `job-cache` store. The cache is maintained by `src/main/jobQueue.ts` and is hydrated through `getAllJobs()` when the renderer loads. The app keeps the most recent 5000 console lines per job.

## Notes

- `RunToken.txt` must be beside `MateSelBatch.exe`; MateSel resolves licensing from its working directory.
- The app launches MateSel from the executable directory and passes the data file path explicitly.
- `Console.txt` may appear in the output directory or MateSel install directory; the app checks both.
- `out/` and `dist/` are generated build artifacts.

## Disclaimer

This tool is an independent GUI/orchestration utility and is not affiliated with, endorsed by, or sponsored by MateSel. MateSel and all related intellectual property, trademarks, software, documentation, and rights remain the property of MateSel and its respective owners. Users must ensure they have the appropriate rights and licenses to use MateSel.
