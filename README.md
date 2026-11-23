# MateSel Job Orchestrator

MateSel Job Orchestrator is a Windows desktop application. Use it to prepare and start MateSel jobs. The application shows the console output and the status of each job.

![MateSel Job Orchestrator](src/screenshots/Screenshot%202026-06-16%20155407.png)

## Requirements

- Windows
- Node.js and npm for software builds
- A MateSel batch installation
- A `RunToken.txt` file that MateSel accepts, in the same folder as `MateSelBatch.exe`

## Add jobs

1. Select **+ Add Jobs**.
2. In the **Add MateSel Jobs** dialog, select **+ Browse for job folder(s) or parent folder**.
3. Select one or more job folders. You can also select a folder that contains job folders.
4. Select the button that shows the number of jobs to add. For example, select **Add 1 Job**.
5. If the application shows **Select data file**, select a data file for each job in the list.
6. If you select data files in step 5, select **Add selected files**.

For a standard MateSel export, select the project folder or its `commandline` folder. The application uses `MateSel.csv` and `MateSel.ini` in `commandline`. For a standard run, the application can add the job without `EndUses.txt`.

If the application finds files with names that start with `Out`, it shows **Existing output files**. If you select **Delete and add**, the application deletes these files from the job folder.

## Run jobs

1. Set the paths and the job limit in **Settings**. Refer to [Settings](#settings).
2. Use one of these controls to start jobs.
   - To start one job, select **Start job** on its card.
   - To start all jobs with the **Ready** status, select **Start all ready**.
3. Select a job to see its status, console output, and output folder.

The application puts jobs in the queue when you start them. The application starts each job when the number of jobs in operation is less than the limit.

To stop a job, select **Cancel** in the job details. The application uses `MateselBatchStop.exe` to stop an active job when that file is available.

The application makes an output folder for each job unless you select **Save output to input directory**. The application starts `MateSelBatch.exe` in its installation folder. It gives MateSel the full path to the data file.

The application reads `Console.txt` from the output folder if the file is available. If there is no `Console.txt` in the output folder, the application uses the file in the MateSel installation folder.

## Job status

| Status | Meaning |
| --- | --- |
| **Ready** | You can start the job. |
| **Queued** | The job is in the queue. The application starts it when the number of jobs in operation is less than the limit. |
| **Running** | MateSel is in operation for this job. |
| **Done** | MateSel completed the job without a fatal error. |
| **Failed** | An error stopped the job, or MateSel reported a fatal error. |
| **Cancelled** | The application canceled the job. |

If MateSel reports an expired token, replace `RunToken.txt` with a token that MateSel accepts. Select **Restart** in the job details.

## Settings

| Control | Use |
| --- | --- |
| **MateSel Batch Exe** | Set the path to `MateSelBatch.exe`. |
| **MateSel Stop Exe** | Set the path to `MateselBatchStop.exe`. |
| **Output Root Directory** | Select the folder for the output folders of all jobs. |
| **Save output to input directory** | Select this control to save output in each job folder. |
| **Max Parallel Jobs** | Set the maximum number of jobs in operation at the same time. |

Select **Save**.

## Make jobs with the Batch Generator

The Batch Generator is in development. It copies input files from a starter folder to make jobs. For each job, it changes the selected weightings.

### Standard jobs

1. Select **Batch Generator**.
2. Select **Select starter**.
3. Select the standard job folder. For an export, select the project folder or its `commandline` folder.
4. Select a weighting in the `MateSel.ini` list.
5. Enter one value, a range, or a list with commas between values.
6. If the batch has more than 500 jobs, select **Confirm more than 500 runs**.
7. Select **Generate**.
8. Select a destination folder.

The Batch Generator changes the **Weighting** column in `MateSel.ini`. MateSel uses a weighting when the **Invoked** value for that item is active.

### Multiple EndUses

1. Select **Batch Generator**.
2. Select **Select starter**.
3. Select a starter folder.
4. If necessary, enter new weightings for the items from `MateSel.ini`.
5. Select **Next →**.
6. Select the traits or markers for which you want to change the weightings.
7. For each trait or marker, select the applicable EndUses.
8. Enter one value, a range, or a list with commas between values.
9. If the batch has more than 500 jobs, select **Confirm more than 500 runs**.
10. Select **Generate**.
11. Select a destination folder.

The Batch Generator reads weightings from `EndUses.txt` if it can use that file. If necessary, it reads weightings from `InpOneGroup.txt`. It shows the number of EndUses, traits, and marker loci.

Each EndUse has a column of weightings in the input file. When the number of marker rows is a multiple of 5, the Batch Generator counts 5 rows as one locus. You can change the weighting for each allele or genotype.

### Batch output

The limit for one batch is 1,000 jobs.

For each combination of values, the Batch Generator copies the starter folder. It writes the new weightings to the applicable file. It records each change in `BatchChanges.txt`. The application adds each job to the queue with the **Ready** status.

If a job has a `BatchChanges.txt` file, the job details show the columns **Item**, **Type**, **EndUse**, **Default**, and **This run**.

## Build the application

Run each command from the project folder.

1. Install the dependencies.

   ```powershell
   npm install
   ```

2. Start the application for development.

   ```powershell
   npm run dev
   ```

3. Build the application.

   ```powershell
   npm run build
   ```

4. Make the installer.

   ```powershell
   npm run package
   ```

The build puts the application files in `out/`. Electron Builder puts the installer files in `dist/`.

## Source files

| File or folder | Function |
| --- | --- |
| `src/main/index.ts` | Starts the main Electron window. |
| `src/main/store.ts` | Stores the application settings with `electron-store`. |
| `src/main/jobQueue.ts` | Controls the job queue and job status. |
| `src/main/batchGenerator.ts` | Reads files in the starter folder. Makes jobs for different weightings. |
| `src/main/processRunner.ts` | Starts and stops MateSel. Reads the console output. |
| `src/main/fileManager.ts` | Finds job folders and prepares data files. Reads batch changes. |
| `src/main/ipc/channels.ts` | Gives the names of the channels for messages between processes. |
| `src/main/ipc/handlers.ts` | Receives requests in the main process. |
| `src/preload/index.ts` | Makes `window.mateselAPI` available to the renderer. |
| `src/renderer/src/App.tsx` | Shows the primary interface and processes its events. |
| `src/renderer/src/jobState.ts` | Updates job status and log data in the renderer. |
| `src/renderer/src/components/` | Contains the queue, job details, settings, dialogs, and log viewer. |
| `src/shared.ts` | Gives the data types for the main process and the renderer. |

## Main functions

| Function | Operation |
| --- | --- |
| `enqueue()` | Adds a job to the queue with the `ready` status. |
| `start()` and `startAll()` | Set the applicable jobs to `queued`. Then call `tick()`. |
| `tick()` | Starts jobs up to the limit. Sets the output path and sends status data. Calls `prepareAndStart()`. |
| `prepareAndStart()` | Copies the input files when necessary. Makes sure that `RunToken.txt` is available. Prepares the data file and starts MateSel. |
| `startJob()` | Starts `MateSelBatch.exe` in its installation folder with the full path to the data file. |
| `startConsoleLogStreaming()` | Looks for new text in `Console.txt` and sends it to the renderer. |
| `findMateSelDataFileName()` | Finds the data file in the job folder. Refer to the list below. |
| `prepareMateSelDataFile()` | Converts CSV files to `Matesel.txt`. Uses text files directly. |
| `inspectBatchStarter()` | Reads the weightings for the Batch Generator from a starter folder. |
| `generateBatchJobs()` | Makes one job folder for each combination of selected values. Records the changes in `BatchChanges.txt`. |
| `readBatchChanges()` | Reads the table in `BatchChanges.txt` for the job details. |

The application can find these data file names without user input.

- `Matesel.txt`
- `MateselClassicDemo.txt`
- `DataFile*.txt`
- `DataFile*.csv`
- `MateSel.csv`

## Job history and console output

The application saves job history in the `job-cache` store. The renderer calls `getAllJobs()` to get the job history. The application keeps the last 50,000 lines of console output for each job in memory.

To read console output from a completed job, open `Console.txt` in the job folder.

## License

The PolyForm Noncommercial License 1.0.0 applies to MateSel Job Orchestrator. Refer to [LICENSE.md](LICENSE.md).

You can use, fork, change, and share this software for noncommercial purposes such as research and education. For commercial use, resale, or use in a commercial product or service, you must have written permission from the author.

## Citation

If you use the application for research, cite the software with the information in [CITATION.cff](CITATION.cff).

Lloyd, A. (2026). MateSel Job Orchestrator: A desktop application for staging and running MateSel batch jobs. Version 1.0.1. GitHub. <https://github.com/Alloyd21/MateSel_Job_Orchestrator>

## Disclaimer

MateSel Job Orchestrator operates independently of MateSel. MateSel gives the application no endorsement or sponsorship. MateSel and its owners keep all intellectual property and rights to MateSel. These rights include the trademarks, software, and documentation.

You must have the applicable rights and licenses to use MateSel. For MateSel licenses, refer to the [MateSel website](https://www.matesel.com/).
