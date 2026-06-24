import fs from 'fs'
import path from 'path'
import {
  expandBatchVariationValues,
  makeBatchTimestamp,
  sanitizeFolderSegment,
  type BatchGeneratePayload,
  type BatchGenerateResult,
  type BatchInspectResult,
  type BatchVariationSpec,
  type BatchWeightingKind,
  type BatchWeightingRow
} from '../shared'
import { findFileNameCaseInsensitive, findMateSelDataFileName, listJobFolderFiles } from './fileManager'

interface NumericColumn {
  start: number
  end: number
  raw: string
}

interface ParsedLineRow extends BatchWeightingRow {
  columns: NumericColumn[]
}

interface ParsedInpOneGroup {
  fileName: string
  endUseCount: number
  traits: ParsedLineRow[]
  markers: ParsedLineRow[]
  lineEnding: string
  lines: string[]
}

interface ParsedIniRow extends BatchWeightingRow {
  column: NumericColumn
  nextColumnStart: number
}

interface ParsedMateselIni {
  fileName: string
  rows: ParsedIniRow[]
  lineEnding: string
  lines: string[]
}

interface ExpandedVariation {
  spec: BatchVariationSpec
  values: string[]
}

type ParsedRow = ParsedLineRow | ParsedIniRow

interface RunChange {
  row: ParsedRow
  endUseIndex: number
  defaultValue: string
  generatedValue: string
}

function isIniRow(row: ParsedRow): row is ParsedIniRow {
  return row.kind === 'ini'
}

const MAX_RUNS_WITHOUT_CONFIRM = 500
export const MAX_GENERATED_BATCH_RUNS = 1000

function deriveMarkerLocusCount(markerWeightingRowCount: number): number {
  if (markerWeightingRowCount <= 0) return 0
  return markerWeightingRowCount % 5 === 0 ? markerWeightingRowCount / 5 : markerWeightingRowCount
}

function normalizeNumberText(value: string): string {
  return value.replace(/\s+/g, '')
}

function parseLeadingNumericColumns(line: string, count: number): { columns: NumericColumn[]; rest: string } | null {
  const columns: NumericColumn[] = []
  let position = 0

  for (let index = 0; index < count; index += 1) {
    while (position < line.length && /\s/.test(line[position])) position += 1
    const start = position
    const match = line.slice(position).match(new RegExp(`^[+-]?\\s*(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?`))
    if (!match) return null

    position += match[0].length
    columns.push({ start, end: position, raw: match[0] })
  }

  return { columns, rest: line.slice(position) }
}

function findRequiredLine(lines: string[], pattern: RegExp, errorMessage: string): number {
  const index = lines.findIndex((line) => pattern.test(line))
  if (index === -1) throw new Error(errorMessage)
  return index
}

function parseRows(
  lines: string[],
  startIndex: number,
  endIndex: number,
  endUseCount: number,
  kind: BatchWeightingKind
): ParsedLineRow[] {
  const rows: ParsedLineRow[] = []
  for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
    const parsed = parseLeadingNumericColumns(lines[lineIndex], endUseCount)
    if (!parsed) continue

    const name = parsed.rest.trim().replace(/\s+/g, ' ')
    if (!name) continue

    rows.push({
      id: `${kind}:${lineIndex}`,
      kind,
      name,
      lineIndex,
      values: parsed.columns.map((column) => normalizeNumberText(column.raw)),
      columns: parsed.columns
    })
  }
  return rows
}

function toPublicRows(rows: BatchWeightingRow[]): BatchWeightingRow[] {
  return rows.map(({ id, kind, name, lineIndex, values }) => ({ id, kind, name, lineIndex, values }))
}

function parseInpOneGroupContent(content: string, fileName = 'InpOneGroup.txt'): ParsedInpOneGroup {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const endUseHeaderIndex = findRequiredLine(lines, /^Number of EndUses\s*$/i, `${fileName} is missing Number of EndUses`)
  const endUseCountLine = lines.slice(endUseHeaderIndex + 1).find((line) => line.trim())
  const endUseCount = Number(endUseCountLine?.trim())
  if (!Number.isInteger(endUseCount) || endUseCount <= 0) {
    throw new Error(`${fileName} has an invalid Number of EndUses value`)
  }

  const traitHeadingIndex = findRequiredLine(
    lines,
    /Weightings for Index and\/or traits/i,
    `${fileName} is missing the trait weighting section`
  )
  const markerHeadingIndex = findRequiredLine(
    lines,
    /Weightings for markers/i,
    `${fileName} is missing the marker weighting section`
  )
  if (markerHeadingIndex <= traitHeadingIndex) {
    throw new Error(`${fileName} marker weighting section must appear after trait weightings`)
  }

  const afterMarkerHeading = markerHeadingIndex + 1
  const markerEndIndex = lines.findIndex(
    (line, index) => index > markerHeadingIndex && /Relative weighting on each EndUse for Genetic Merit/i.test(line)
  )
  if (markerEndIndex === -1) {
    throw new Error(`${fileName} is missing the section after marker weightings`)
  }

  const traits = parseRows(lines, traitHeadingIndex + 1, markerHeadingIndex, endUseCount, 'trait')
  const markers = parseRows(lines, afterMarkerHeading, markerEndIndex, endUseCount, 'marker')
  if (traits.length === 0) throw new Error(`No trait weighting rows were found in ${fileName}`)
  if (markers.length === 0) throw new Error(`No marker weighting rows were found in ${fileName}`)

  return { fileName, endUseCount, traits, markers, lineEnding, lines }
}

const MATESEL_HISTOGRAM_HEADER =
  /^\s*Item\s+Invoked\s+ControlType\s+Weighting\s+Target1\s+Target2\s+Target3/i

export function parseMateselHistogram(content: string, fileName = 'Matesel.ini'): ParsedMateselIni {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => MATESEL_HISTOGRAM_HEADER.test(line))
  if (headerIndex === -1) {
    throw new Error(`${fileName} is missing the Item/Invoked/ControlType/Weighting histogram table`)
  }

  const rows: ParsedIniRow[] = []
  for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line.trim()) continue

    // Item name is the leading non-whitespace token, followed by numeric columns.
    const nameMatch = line.match(/^\s*(\S+)/)
    if (!nameMatch) continue
    const nameEnd = nameMatch[0].length
    // Need Invoked, ControlType, Weighting, Target1 to locate the Weighting field.
    const parsed = parseLeadingNumericColumns(line.slice(nameEnd), 4)
    if (!parsed) continue

    const columns = parsed.columns.map((column) => ({
      start: column.start + nameEnd,
      end: column.end + nameEnd,
      raw: column.raw
    }))
    const weighting = columns[2]
    const nextColumnStart = columns[3].start

    rows.push({
      id: `ini:${lineIndex}`,
      kind: 'ini',
      name: nameMatch[1],
      lineIndex,
      values: [normalizeNumberText(weighting.raw)],
      column: weighting,
      nextColumnStart
    })
  }

  if (rows.length === 0) throw new Error(`No histogram rows were found in ${fileName}`)

  return { fileName, rows, lineEnding, lines }
}

export function parseInpOneGroup(content: string): {
  endUseCount: number
  traits: BatchWeightingRow[]
  markers: BatchWeightingRow[]
} {
  const parsed = parseInpOneGroupContent(content)
  return {
    endUseCount: parsed.endUseCount,
    traits: toPublicRows(parsed.traits),
    markers: toPublicRows(parsed.markers)
  }
}

function readWeightingFile(starterFolder: string): { fileName: string; content: string } {
  const candidateNames = ['EndUses.txt', 'InpOneGroup.txt']
  const errors: string[] = []

  for (const candidateName of candidateNames) {
    const fileName = findFileNameCaseInsensitive(starterFolder, candidateName)
    if (!fileName) continue

    const content = fs.readFileSync(path.join(starterFolder, fileName), 'utf8')
    try {
      parseInpOneGroupContent(content, fileName)
      return { fileName, content }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  throw new Error(errors[0] ?? 'Missing EndUses.txt or InpOneGroup.txt with trait and marker weightings')
}

function readMateselIni(starterFolder: string): { fileName: string; content: string } | null {
  const fileName = findFileNameCaseInsensitive(starterFolder, 'Matesel.ini')
  if (!fileName) return null
  return { fileName, content: fs.readFileSync(path.join(starterFolder, fileName), 'utf8') }
}

export function inspectBatchStarter(starterFolder: string): BatchInspectResult {
  const warnings: string[] = []
  const files = fs.existsSync(starterFolder) ? listJobFolderFiles(starterFolder) : []
  const dataFileName = fs.existsSync(starterFolder) ? findMateSelDataFileName(starterFolder) : undefined

  if (!fs.existsSync(starterFolder)) warnings.push('Starter folder does not exist')
  if (!findFileNameCaseInsensitive(starterFolder, 'Matesel.ini')) warnings.push('Missing Matesel.ini')

  const needsDataFile = !dataFileName
  if (needsDataFile) warnings.push('No recognised MateSel data file found')

  let endUseCount = 0
  let traits: BatchWeightingRow[] = []
  let markers: BatchWeightingRow[] = []
  let weightingFileName: string | undefined
  let iniRows: BatchWeightingRow[] = []
  let iniWarning: string | undefined

  const iniFile = readMateselIni(starterFolder)
  if (iniFile) {
    try {
      iniRows = toPublicRows(parseMateselHistogram(iniFile.content, iniFile.fileName).rows)
    } catch (err: unknown) {
      // Surface separately (shown in the Matesel.ini step) rather than as a
      // blocking warning — a starter without the histogram is still usable.
      iniWarning = err instanceof Error ? err.message : String(err)
    }
  }

  try {
    const weightingFile = readWeightingFile(starterFolder)
    const parsed = parseInpOneGroupContent(weightingFile.content, weightingFile.fileName)
    weightingFileName = weightingFile.fileName
    endUseCount = parsed.endUseCount
    traits = toPublicRows(parsed.traits)
    markers = toPublicRows(parsed.markers)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    warnings.push(message)
  }

  const markerLocusCount = deriveMarkerLocusCount(markers.length)
  const valid =
    fs.existsSync(starterFolder) &&
    Boolean(findFileNameCaseInsensitive(starterFolder, 'Matesel.ini')) &&
    Boolean(weightingFileName) &&
    endUseCount > 0 &&
    traits.length > 0 &&
    markers.length > 0 &&
    !needsDataFile

  return {
    valid,
    warnings,
    needsDataFile,
    dataFileName,
    weightingFileName,
    files,
    endUseCount,
    traits,
    markers,
    markerLocusCount,
    iniRows,
    iniWarning
  }
}

function ensureDestinationParentAllowed(starterFolder: string, destinationParent: string): void {
  const starter = path.resolve(starterFolder).toLowerCase()
  const destination = path.resolve(destinationParent).toLowerCase()
  if (destination === starter || destination.startsWith(`${starter}${path.sep}`)) {
    throw new Error('Destination parent cannot be inside the starter job folder')
  }
}

function normalizeBatchTimestamp(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(value)) return value
  return makeBatchTimestamp()
}

function createUniqueBatchFolder(
  destinationParent: string,
  starterFolder: string,
  batchName?: string,
  batchTimestamp?: string
): string {
  const requestedName = batchName == null ? undefined : sanitizeFolderSegment(batchName)
  const fallbackName = batchName == null ? sanitizeFolderSegment(path.basename(starterFolder)) : ''
  const jobName = requestedName ?? fallbackName
  const timestamp = normalizeBatchTimestamp(batchTimestamp)
  const baseName = jobName ? `Batch_${jobName}_${timestamp}` : `Batch_${timestamp}`
  let candidate = path.join(destinationParent, baseName)
  let suffix = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(destinationParent, `${baseName}_${suffix}`)
    suffix += 1
  }
  fs.mkdirSync(candidate, { recursive: true })
  return candidate
}

function paddedRunName(index: number, total: number): string {
  const width = Math.max(4, String(total).length)
  return `run_${String(index).padStart(width, '0')}`
}

function replaceColumn(line: string, column: NumericColumn, value: string): string {
  const width = column.end - column.start
  const replacement = value.length < width ? value.padStart(width) : value
  return `${line.slice(0, column.start)}${replacement}${line.slice(column.end)}`
}

interface InpRunChange extends RunChange {
  row: ParsedLineRow
}

function renderInpOneGroup(parsed: ParsedInpOneGroup, changes: InpRunChange[]): string {
  const lines = [...parsed.lines]
  const changesByLine = new Map<number, InpRunChange[]>()
  for (const change of changes) {
    const existing = changesByLine.get(change.row.lineIndex) ?? []
    existing.push(change)
    changesByLine.set(change.row.lineIndex, existing)
  }

  for (const [lineIndex, lineChanges] of changesByLine.entries()) {
    let line = lines[lineIndex]
    for (const change of lineChanges.sort((a, b) => b.row.columns[b.endUseIndex].start - a.row.columns[a.endUseIndex].start)) {
      line = replaceColumn(line, change.row.columns[change.endUseIndex], change.generatedValue)
    }
    lines[lineIndex] = line
  }

  return lines.join(parsed.lineEnding)
}

function replaceIniWeighting(line: string, row: ParsedIniRow, value: string): string {
  // Left-align the new value within the original Weighting field so every
  // following column keeps its offset (and unchanged lines stay byte-identical).
  const fieldWidth = row.nextColumnStart - row.column.start
  const padded = value.length >= fieldWidth ? `${value} ` : value.padEnd(fieldWidth, ' ')
  return `${line.slice(0, row.column.start)}${padded}${line.slice(row.nextColumnStart)}`
}

function renderMateselIni(parsed: ParsedMateselIni, changes: RunChange[]): string {
  const lines = [...parsed.lines]
  for (const change of changes) {
    if (!isIniRow(change.row)) continue
    lines[change.row.lineIndex] = replaceIniWeighting(
      lines[change.row.lineIndex],
      change.row,
      change.generatedValue
    )
  }
  return lines.join(parsed.lineEnding)
}

function renderBatchChanges(
  jobName: string,
  starterFolder: string,
  weightingFileName: string,
  iniFileName: string,
  generatedAt: string,
  changes: RunChange[]
): string {
  const changedFiles = Array.from(
    new Set(changes.map((change) => (isIniRow(change.row) ? iniFileName : weightingFileName)))
  )
  const lines = [
    `Job: ${jobName}`,
    'Batch weighting changes compared with starter defaults',
    `Starter folder: ${starterFolder}`,
    `Changed files: ${changedFiles.join(', ')}`,
    `Generated at: ${generatedAt}`,
    '',
    'Item\tType\tEndUse\tDefault\tThis run'
  ]

  for (const change of changes) {
    lines.push(
      `${change.row.name}\t${change.row.kind}\t${change.endUseIndex + 1}\t${change.defaultValue}\t${change.generatedValue}`
    )
  }

  return `${lines.join('\r\n')}\r\n`
}

function getCombinationCount(expanded: ExpandedVariation[]): number {
  return expanded.reduce((total, variation) => total * variation.values.length, 1)
}

function validateCombinationCount(combinationCount: number): void {
  if (!Number.isFinite(combinationCount) || !Number.isSafeInteger(combinationCount)) {
    throw new Error('Batch combination count is too large to generate safely.')
  }
  if (combinationCount > MAX_GENERATED_BATCH_RUNS) {
    throw new Error(`Batch would create ${combinationCount} runs, exceeding the absolute limit of ${MAX_GENERATED_BATCH_RUNS}.`)
  }
}

export function generateBatchJobs(request: BatchGeneratePayload): BatchGenerateResult {
  if (!fs.existsSync(request.starterFolder)) throw new Error('Starter folder does not exist')
  if (!fs.existsSync(request.destinationParent)) throw new Error('Destination parent does not exist')
  ensureDestinationParentAllowed(request.starterFolder, request.destinationParent)

  const dataFileName = request.selectedDataFileName ?? findMateSelDataFileName(request.starterFolder)
  if (!dataFileName) throw new Error('No MateSel data file was selected')
  if (!fs.existsSync(path.join(request.starterFolder, dataFileName))) {
    throw new Error(`Selected data file not found: ${dataFileName}`)
  }
  if (!findFileNameCaseInsensitive(request.starterFolder, 'Matesel.ini')) throw new Error('Missing Matesel.ini')

  const weightingFile = readWeightingFile(request.starterFolder)
  const parsed = parseInpOneGroupContent(weightingFile.content, weightingFile.fileName)

  const needsIni = request.variations.some((spec) => spec.rowId.startsWith('ini:'))
  const iniFile = needsIni ? readMateselIni(request.starterFolder) : null
  if (needsIni && !iniFile) throw new Error('Missing Matesel.ini')
  const parsedIni = iniFile ? parseMateselHistogram(iniFile.content, iniFile.fileName) : null

  const rowMap = new Map<string, ParsedRow>()
  for (const row of [...parsed.traits, ...parsed.markers]) rowMap.set(row.id, row)
  for (const row of parsedIni?.rows ?? []) rowMap.set(row.id, row)

  const expanded: Array<ExpandedVariation & { row: ParsedRow }> = request.variations.map((spec) => {
    const row = rowMap.get(spec.rowId)
    if (!row) throw new Error(`Unknown weighting row: ${spec.rowId}`)
    if (isIniRow(row)) {
      if (spec.endUseIndex !== 0) throw new Error(`Invalid EndUse index for ${row.name}`)
    } else if (!Number.isInteger(spec.endUseIndex) || spec.endUseIndex < 0 || spec.endUseIndex >= parsed.endUseCount) {
      throw new Error(`Invalid EndUse index for ${row.name}`)
    }
    return { spec, values: expandBatchVariationValues(spec), row }
  })

  if (expanded.length === 0) throw new Error('Select at least one weighting value to vary')

  const combinationCount = getCombinationCount(expanded)
  validateCombinationCount(combinationCount)
  if (combinationCount > MAX_RUNS_WITHOUT_CONFIRM && !request.allowLargeBatch) {
    throw new Error(`Batch would create ${combinationCount} runs. Confirm large batch generation to continue.`)
  }

  const batchFolder = createUniqueBatchFolder(
    request.destinationParent,
    request.starterFolder,
    request.batchName,
    request.batchTimestamp
  )
  const generatedFolders: string[] = []
  const generatedAt = new Date().toISOString()

  for (let runIndex = 0; runIndex < combinationCount; runIndex += 1) {
    const changes: RunChange[] = []
    let divisor = 1
    for (const variation of expanded) {
      const valueIndex = Math.floor(runIndex / divisor) % variation.values.length
      const generatedValue = variation.values[valueIndex]
      changes.push({
        row: variation.row,
        endUseIndex: variation.spec.endUseIndex,
        defaultValue: variation.row.values[variation.spec.endUseIndex],
        generatedValue
      })
      divisor *= variation.values.length
    }

    const inpChanges = changes.filter((change): change is InpRunChange => !isIniRow(change.row))
    const iniChanges = changes.filter((change) => isIniRow(change.row))

    const runName = paddedRunName(runIndex + 1, combinationCount)
    const runFolder = path.join(batchFolder, runName)
    fs.cpSync(request.starterFolder, runFolder, { recursive: true, force: true })
    fs.writeFileSync(path.join(runFolder, parsed.fileName), renderInpOneGroup(parsed, inpChanges))
    if (parsedIni && iniChanges.length > 0) {
      fs.writeFileSync(path.join(runFolder, parsedIni.fileName), renderMateselIni(parsedIni, iniChanges))
    }
    fs.writeFileSync(
      path.join(runFolder, 'BatchChanges.txt'),
      renderBatchChanges(
        runName,
        request.starterFolder,
        parsed.fileName,
        parsedIni?.fileName ?? 'Matesel.ini',
        generatedAt,
        changes
      )
    )
    generatedFolders.push(runFolder)
  }

  return { batchFolder, generatedFolders, dataFileName }
}
