import fs from 'fs'
import path from 'path'
import { findMateSelDataFileName, listJobFolderFiles } from './fileManager'

export type BatchWeightingKind = 'trait' | 'marker'
export type BatchValueMode = 'value' | 'range' | 'list'

export interface BatchWeightingRow {
  id: string
  kind: BatchWeightingKind
  name: string
  lineIndex: number
  values: string[]
}

export interface BatchInspectResult {
  valid: boolean
  warnings: string[]
  needsDataFile: boolean
  dataFileName?: string
  weightingFileName?: string
  files: string[]
  endUseCount: number
  traits: BatchWeightingRow[]
  markers: BatchWeightingRow[]
  markerLocusCount: number
}

export interface BatchVariationSpec {
  rowId: string
  endUseIndex: number
  mode: BatchValueMode
  value: string
  increment?: string
}

export interface BatchGenerateRequest {
  starterFolder: string
  destinationParent: string
  selectedDataFileName?: string
  variations: BatchVariationSpec[]
  allowLargeBatch?: boolean
}

export interface BatchGenerateResult {
  batchFolder: string
  generatedFolders: string[]
  dataFileName?: string
}

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

interface ExpandedVariation {
  spec: BatchVariationSpec
  values: string[]
}

interface RunChange {
  row: ParsedLineRow
  endUseIndex: number
  defaultValue: string
  generatedValue: string
}

const MAX_RUNS_WITHOUT_CONFIRM = 500
const numericPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'

function hasFileCaseInsensitive(folderPath: string, fileName: string): boolean {
  try {
    return fs.readdirSync(folderPath).some((entry) => entry.toLowerCase() === fileName.toLowerCase())
  } catch {
    return false
  }
}

function findFileCaseInsensitive(folderPath: string, fileName: string): string | undefined {
  try {
    return fs.readdirSync(folderPath).find((entry) => entry.toLowerCase() === fileName.toLowerCase())
  } catch {
    return undefined
  }
}

function deriveMarkerLocusCount(markerWeightingRowCount: number): number {
  if (markerWeightingRowCount <= 0) return 0
  return markerWeightingRowCount % 5 === 0 ? markerWeightingRowCount / 5 : markerWeightingRowCount
}

function normalizeNumberText(value: string): string {
  return value.replace(/\s+/g, '')
}

function parseFiniteNumber(value: string, label: string): number {
  const normalized = normalizeNumberText(value.trim())
  if (!normalized) throw new Error(`${label} is empty`)
  const number = Number(normalized)
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric`)
  return number
}

function formatGeneratedNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function decimalPlaces(value: string): number {
  const normalized = normalizeNumberText(value).toLowerCase()
  const [mantissa, exponentText] = normalized.split('e')
  const exponent = exponentText == null ? 0 : Number(exponentText)
  const decimalIndex = mantissa.indexOf('.')
  const places = decimalIndex === -1 ? 0 : mantissa.length - decimalIndex - 1
  return Math.max(0, places - exponent)
}

function expandValueSpec(spec: BatchVariationSpec): string[] {
  if (spec.mode === 'value') {
    return [formatGeneratedNumber(parseFiniteNumber(spec.value, 'Value'))]
  }

  if (spec.mode === 'list') {
    const values = spec.value.split(',').map((value) => value.trim()).filter(Boolean)
    if (values.length === 0) throw new Error('List must contain at least one numeric value')
    return values.map((value, index) => formatGeneratedNumber(parseFiniteNumber(value, `List value ${index + 1}`)))
  }

  const rangeRegex = new RegExp(`^\\s*(${numericPattern})\\s*-\\s*(${numericPattern})\\s*$`)
  const match = spec.value.match(rangeRegex)
  if (!match) throw new Error('Range must use the form start-end, such as 1-4')

  const start = parseFiniteNumber(match[1], 'Range start')
  const end = parseFiniteNumber(match[2], 'Range end')
  const increment = parseFiniteNumber(spec.increment ?? '', 'Range increment')
  if (increment <= 0) throw new Error('Range increment must be greater than 0')
  if (end < start) throw new Error('Range end must be greater than or equal to range start')

  const precision = Math.min(
    12,
    Math.max(decimalPlaces(match[1]), decimalPlaces(match[2]), decimalPlaces(spec.increment ?? '')) + 2
  )
  const values: string[] = []
  const epsilon = Math.abs(increment) / 1_000_000
  for (let current = start; current <= end + epsilon; current += increment) {
    values.push(formatGeneratedNumber(Number(current.toFixed(precision))))
    if (values.length > 10000) throw new Error('Range expands to too many values')
  }
  if (values.length === 0) throw new Error('Range produced no values')
  return values
}

export function expandBatchVariationValues(spec: BatchVariationSpec): string[] {
  return expandValueSpec(spec)
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

function toPublicRows(rows: ParsedLineRow[]): BatchWeightingRow[] {
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
    const fileName = findFileCaseInsensitive(starterFolder, candidateName)
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

export function inspectBatchStarter(starterFolder: string): BatchInspectResult {
  const warnings: string[] = []
  const files = fs.existsSync(starterFolder) ? listJobFolderFiles(starterFolder) : []
  const dataFileName = fs.existsSync(starterFolder) ? findMateSelDataFileName(starterFolder) : undefined

  if (!fs.existsSync(starterFolder)) warnings.push('Starter folder does not exist')
  if (!hasFileCaseInsensitive(starterFolder, 'Matesel.ini')) warnings.push('Missing Matesel.ini')

  const needsDataFile = !dataFileName
  if (needsDataFile) warnings.push('No recognised MateSel data file found')

  let endUseCount = 0
  let traits: BatchWeightingRow[] = []
  let markers: BatchWeightingRow[] = []
  let weightingFileName: string | undefined

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
    hasFileCaseInsensitive(starterFolder, 'Matesel.ini') &&
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
    markerLocusCount
  }
}

function ensureDestinationParentAllowed(starterFolder: string, destinationParent: string): void {
  const starter = path.resolve(starterFolder).toLowerCase()
  const destination = path.resolve(destinationParent).toLowerCase()
  if (destination === starter || destination.startsWith(`${starter}${path.sep}`)) {
    throw new Error('Destination parent cannot be inside the starter job folder')
  }
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function createUniqueBatchFolder(destinationParent: string, starterFolder: string): string {
  const baseName = `Batch_${path.basename(starterFolder)}_${makeTimestamp()}`
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

function renderInpOneGroup(parsed: ParsedInpOneGroup, changes: RunChange[]): string {
  const lines = [...parsed.lines]
  const changesByLine = new Map<number, RunChange[]>()
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

function renderBatchChanges(
  jobName: string,
  starterFolder: string,
  weightingFileName: string,
  generatedAt: string,
  changes: RunChange[]
): string {
  const lines = [
    `Job: ${jobName}`,
    'Batch weighting changes compared with starter defaults',
    `Starter folder: ${starterFolder}`,
    `Changed file: ${weightingFileName}`,
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

export function generateBatchJobs(request: BatchGenerateRequest): BatchGenerateResult {
  if (!fs.existsSync(request.starterFolder)) throw new Error('Starter folder does not exist')
  if (!fs.existsSync(request.destinationParent)) throw new Error('Destination parent does not exist')
  ensureDestinationParentAllowed(request.starterFolder, request.destinationParent)

  const dataFileName = request.selectedDataFileName ?? findMateSelDataFileName(request.starterFolder)
  if (!dataFileName) throw new Error('No MateSel data file was selected')
  if (!fs.existsSync(path.join(request.starterFolder, dataFileName))) {
    throw new Error(`Selected data file not found: ${dataFileName}`)
  }
  if (!hasFileCaseInsensitive(request.starterFolder, 'Matesel.ini')) throw new Error('Missing Matesel.ini')

  const weightingFile = readWeightingFile(request.starterFolder)
  const parsed = parseInpOneGroupContent(weightingFile.content, weightingFile.fileName)
  const rowMap = new Map<string, ParsedLineRow>()
  for (const row of [...parsed.traits, ...parsed.markers]) rowMap.set(row.id, row)

  const expanded: Array<ExpandedVariation & { row: ParsedLineRow }> = request.variations.map((spec) => {
    const row = rowMap.get(spec.rowId)
    if (!row) throw new Error(`Unknown weighting row: ${spec.rowId}`)
    if (!Number.isInteger(spec.endUseIndex) || spec.endUseIndex < 0 || spec.endUseIndex >= parsed.endUseCount) {
      throw new Error(`Invalid EndUse index for ${row.name}`)
    }
    return { spec, values: expandValueSpec(spec), row }
  })

  if (expanded.length === 0) throw new Error('Select at least one weighting value to vary')

  const combinationCount = getCombinationCount(expanded)
  if (combinationCount > MAX_RUNS_WITHOUT_CONFIRM && !request.allowLargeBatch) {
    throw new Error(`Batch would create ${combinationCount} runs. Confirm large batch generation to continue.`)
  }

  const batchFolder = createUniqueBatchFolder(request.destinationParent, request.starterFolder)
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

    const runName = paddedRunName(runIndex + 1, combinationCount)
    const runFolder = path.join(batchFolder, runName)
    fs.cpSync(request.starterFolder, runFolder, { recursive: true, force: true })
    fs.writeFileSync(path.join(runFolder, parsed.fileName), renderInpOneGroup(parsed, changes))
    fs.writeFileSync(
      path.join(runFolder, 'BatchChanges.txt'),
      renderBatchChanges(runName, request.starterFolder, parsed.fileName, generatedAt, changes)
    )
    generatedFolders.push(runFolder)
  }

  return { batchFolder, generatedFolders, dataFileName }
}
