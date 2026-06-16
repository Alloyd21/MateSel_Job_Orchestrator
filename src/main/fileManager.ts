import fs from 'fs'
import path from 'path'

export interface BatchChangeRow {
  item: string
  type: string
  endUse: string
  defaultValue: string
  thisRun: string
}

export function createOutputDir(outputRoot: string, jobName: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const dirName = `${jobName}_${timestamp}`
  const fullPath = path.join(outputRoot, dirName)
  fs.mkdirSync(fullPath, { recursive: true })
  return fullPath
}

function findFileNameCaseInsensitive(folderPath: string, fileName: string): string | undefined {
  try {
    return fs.readdirSync(folderPath).find((entry) => entry.toLowerCase() === fileName.toLowerCase())
  } catch {
    return undefined
  }
}

export function readBatchChanges(folderPath: string): BatchChangeRow[] {
  const fileName = findFileNameCaseInsensitive(folderPath, 'BatchChanges.txt')
  if (!fileName) return []

  const content = fs.readFileSync(path.join(folderPath, fileName), 'utf8')
  const lines = content.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim() === 'Item\tType\tEndUse\tDefault\tThis run')
  if (headerIndex === -1) return []

  return lines
    .slice(headerIndex + 1)
    .map((line) => line.split('\t'))
    .filter((columns) => columns.length >= 5 && columns.some((column) => column.trim()))
    .map(([item, type, endUse, defaultValue, thisRun]) => ({
      item: item.trim(),
      type: type.trim(),
      endUse: endUse.trim(),
      defaultValue: defaultValue.trim(),
      thisRun: thisRun.trim()
    }))
}

export function copyInputFiles(jobFolder: string, outputDir: string): void {
  // force: true so existing files in the destination are overwritten, never left stale.
  fs.cpSync(jobFolder, outputDir, { recursive: true, force: true })
}

export function findMateSelDataFileName(folderPath: string): string | undefined {
  const files = fs.readdirSync(folderPath)

  const mateSelClassicDemoTxt = files.find((fileName) => fileName.toLowerCase() === 'mateselclassicdemo.txt')
  if (mateSelClassicDemoTxt) return mateSelClassicDemoTxt

  const demoFile = files.find((fileName) => /demo/i.test(fileName))
  if (demoFile) return demoFile

  const dataFileTxt = files.find((fileName) => /^DataFile.*\.txt$/i.test(fileName))
  if (dataFileTxt) return dataFileTxt

  // Prefer the CSV source over an existing Matesel.txt. Matesel.txt is the file
  // we *generate* from the CSV, so when both are present the CSV is the real
  // input — picking it forces a fresh regeneration and stops a stale Matesel.txt
  // from a previous run shadowing edited data.
  const dataFileCsv = files.find((fileName) => /^DataFile.*\.csv$/i.test(fileName))
  if (dataFileCsv) return dataFileCsv

  return files.find((fileName) => fileName.toLowerCase() === 'matesel.txt')
}

function formatNumeric(value: string): string {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return value
  if (Number.isInteger(numericValue)) return String(numericValue)
  return numericValue.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
}

function normalizeMateSelValue(header: string, value: string): string {
  const trimmed = value.trim()
  const isMarker = /^(g|gp)_/i.test(header)

  if (!trimmed) {
    if (isMarker || header === 'MatingGroup') return '0'
    if (['Sire', 'Dam'].includes(header)) return '0'
    return '-999999'
  }

  if (header === 'Sex' && trimmed.toUpperCase() === 'U') return '0'
  if (isMarker && trimmed.toUpperCase() === 'U') return '0'

  return formatNumeric(trimmed)
}

interface CsvRecord {
  fields: string[]
  hasContent: boolean
}

function parseCsvRecords(content: string): CsvRecord[] {
  const csv = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const records: CsvRecord[] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let recordStarted = false
  let recordHasContent = false

  const finishRecord = (): void => {
    record.push(field)
    records.push({ fields: record, hasContent: recordHasContent })
    record = []
    field = ''
    recordStarted = false
    recordHasContent = false
  }

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    recordStarted = true

    if (inQuotes) {
      if (char.trim()) recordHasContent = true
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      recordHasContent = true
      inQuotes = true
    } else if (char === ',') {
      recordHasContent = true
      record.push(field)
      field = ''
    } else if (char === '\r') {
      if (csv[index + 1] === '\n') index += 1
      finishRecord()
    } else if (char === '\n') {
      finishRecord()
    } else {
      if (char.trim()) recordHasContent = true
      field += char
    }
  }

  if (inQuotes) throw new Error('CSV data file contains an unterminated quoted field')
  if (recordStarted || record.length > 0 || field) finishRecord()

  return records
}

export function prepareMateSelDataFile(
  outputDir: string,
  selectedDataFileName?: string,
  onLog?: (text: string) => void
): string {
  const dataFileName = selectedDataFileName ?? findMateSelDataFileName(outputDir)
  if (!dataFileName) {
    throw new Error(`No Matesel.txt, MateselClassicDemo.txt, DataFile*.txt, or DataFile*.csv found in ${outputDir}`)
  }

  const sourcePath = path.join(outputDir, dataFileName)
  if (!fs.existsSync(sourcePath)) throw new Error(`Selected data file not found: ${sourcePath}`)

  if (!/\.csv$/i.test(dataFileName)) return dataFileName

  const records = parseCsvRecords(fs.readFileSync(sourcePath, 'utf8'))
    .filter((record) => record.hasContent)
    .map((record) => record.fields)
  if (records.length === 0) throw new Error(`Data file is empty: ${sourcePath}`)

  const headers = records[0].map((header) => header.trim())
  const normalizedLines = [
    headers.join(' '),
    ...records.slice(1).map((values) => {
      return headers.map((header, index) => normalizeMateSelValue(header, values[index] ?? '')).join(' ')
    })
  ]

  const destinationName = 'Matesel.txt'
  fs.writeFileSync(path.join(outputDir, destinationName), `${normalizedLines.join('\r\n')}\r\n`)
  onLog?.(`[Orchestrator] ${destinationName} re-generated from ${dataFileName}\n`)
  return destinationName
}

function hasMateSelConfig(folderPath: string): boolean {
  try {
    return fs.readdirSync(folderPath).some((fileName) => fileName.toLowerCase() === 'matesel.ini')
  } catch {
    return false
  }
}

export function discoverJobFolders(folderPaths: string[]): string[] {
  const discovered = new Set<string>()

  const walk = (folderPath: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folderPath, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.name.toLowerCase() === 'matesel.ini')) {
      discovered.add(folderPath)
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      walk(path.join(folderPath, entry.name))
    }
  }

  for (const folderPath of folderPaths) {
    walk(folderPath)
  }

  return [...discovered].sort((a, b) => a.localeCompare(b))
}

export function validateJobFolder(
  folderPath: string
): { valid: boolean; warnings: string[]; needsDataFile?: boolean; files?: string[] } {
  const warnings: string[] = []
  const files = fs.readdirSync(folderPath)

  if (!hasMateSelConfig(folderPath)) {
    return { valid: false, warnings: ['Missing Matesel.ini'] }
  }

  if (!findMateSelDataFileName(folderPath)) {
    return {
      valid: false,
      warnings: ['No Matesel.txt, MateselClassicDemo.txt, DataFile*.txt, or DataFile*.csv found'],
      needsDataFile: true,
      files: listJobFolderFiles(folderPath)
    }
  }
  if (!files.includes('EndUses.txt')) warnings.push('Missing EndUses.txt')
  if (!files.includes('InpOneGroup.txt')) warnings.push('Missing InpOneGroup.txt')

  return { valid: true, warnings }
}

export function listJobFolderFiles(folderPath: string): string[] {
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}
