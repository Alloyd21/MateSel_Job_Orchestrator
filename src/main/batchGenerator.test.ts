import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expandBatchVariationValues } from '../shared'
import {
  generateBatchJobs,
  inspectBatchStarter,
  MAX_GENERATED_BATCH_RUNS,
  parseInpOneGroup,
  parseMateselHistogram
} from './batchGenerator'

let tempDir: string

const inpOneGroup = [
  'Number of EndUses',
  '      2',
  'Relative number or proportion of Matings in each EndUse:',
  '    35    10    ',
  'Weightings for Index and/or traits. Only relativity between these matters as each EndUse Index is scaled 0 to 1 in the code ',
  '      1      1              Index       ',
  '      0      0              WT_Birth    ',
  '      0      -1             DM_COARSE   ',
  'Weightings for markers. Magnitude matters as no scaling is applied in the code.',
  '     -2.5     0           Polled allele    N',
  '      0      3           Polled genotype NN',
  '    - 1     -1             CL16 genotype AA',
  'Relative weighting on each EndUse for Genetic Merit on EndUse Index:',
  '   1.00   0.75 ',
  ''
].join('\r\n')

const inpOneGroupWithTenMarkerRows = [
  'Number of EndUses',
  '      2',
  'Relative number or proportion of Matings in each EndUse:',
  '    35    10    ',
  'Weightings for Index and/or traits. Only relativity between these matters as each EndUse Index is scaled 0 to 1 in the code ',
  '      1      1              Index       ',
  'Weightings for markers. Magnitude matters as no scaling is applied in the code.',
  '      0      0           Marker1 allele N',
  '      0      0           Marker1 genotype NN',
  '      0      0           Marker1 genotype NA',
  '      0      0           Marker1 genotype AN',
  '      0      0           Marker1 genotype AA',
  '      0      0           Marker2 allele N',
  '      0      0           Marker2 genotype NN',
  '      0      0           Marker2 genotype NA',
  '      0      0           Marker2 genotype AN',
  '      0      0           Marker2 genotype AA',
  'Relative weighting on each EndUse for Genetic Merit on EndUse Index:',
  '   1.00   0.75 ',
  ''
].join('\r\n')

const mateselIni = [
  'Integer parameters:',
  ' 4                 , Balance Strategy',
  'For a new job leave the rest of this file blank, after this line.',
  ' 16                , Number of traits',
  ' 6                 , Number of marker loci',
  'Parameters to manipulate Inbreeding, Coancestry, Trait and Marker histograms ...',
  'Item         Invoked     ControlType     Weighting        Target1       Target2    Target3',
  'ProgInb        1             8             10            0.131162      0.131162      50 ',
  'SireCoan       0             1             1             0.0741811     0.0741811     50 ',
  'Polled22       0             1             1             0.0003447053                0.0003447053                50 ',
  ''
].join('\r\n')

function writeFile(fileName: string, content = ''): void {
  fs.writeFileSync(path.join(tempDir, fileName), content)
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('parseInpOneGroup', () => {
  it('extracts EndUse count, trait rows, and marker rows', () => {
    const parsed = parseInpOneGroup(inpOneGroup)

    expect(parsed.endUseCount).toBe(2)
    expect(parsed.traits.map((row) => row.name)).toEqual(['Index', 'WT_Birth', 'DM_COARSE'])
    expect(parsed.traits[2].values).toEqual(['0', '-1'])
    expect(parsed.markers.map((row) => row.name)).toEqual([
      'Polled allele N',
      'Polled genotype NN',
      'CL16 genotype AA'
    ])
    expect(parsed.markers[2].values).toEqual(['-1', '-1'])
  })

  it('returns a clear error for missing sections', () => {
    expect(() => parseInpOneGroup('Number of EndUses\n2\n')).toThrow(/trait weighting section/)
  })
})

describe('parseMateselHistogram', () => {
  it('extracts Item names and Weighting values from the histogram table', () => {
    const parsed = parseMateselHistogram(mateselIni)

    expect(parsed.rows.map((row) => row.name)).toEqual(['ProgInb', 'SireCoan', 'Polled22'])
    expect(parsed.rows.map((row) => row.values[0])).toEqual(['10', '1', '1'])
    expect(parsed.rows.every((row) => row.kind === 'ini')).toBe(true)
    // Weighting field offsets land on the third numeric column.
    const progInb = parsed.rows[0]
    const line = parsed.lines[progInb.lineIndex]
    expect(line.slice(progInb.column.start, progInb.column.end)).toBe('10')
  })

  it('throws when the histogram header is missing', () => {
    expect(() => parseMateselHistogram('Integer parameters:\r\n 4 , Balance Strategy\r\n')).toThrow(
      /histogram table/
    )
  })
})

describe('expandBatchVariationValues', () => {
  it('expands value, list, integer range, and decimal range specs', () => {
    expect(
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'value', value: '1' })
    ).toEqual(['1'])
    expect(
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'list', value: '1, 4, 7.5' })
    ).toEqual(['1', '4', '7.5'])
    expect(
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'range', value: '1-3', increment: '1' })
    ).toEqual(['1', '2', '3'])
    expect(
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'range', value: '1-1.3', increment: '0.1' })
    ).toEqual(['1', '1.1', '1.2', '1.3'])
  })

  it('rejects invalid specs', () => {
    expect(() =>
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'value', value: '' })
    ).toThrow(/empty/)
    expect(() =>
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'list', value: '' })
    ).toThrow(/at least one/)
    expect(() =>
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'range', value: '1-2', increment: '0' })
    ).toThrow(/greater than 0/)
    expect(() =>
      expandBatchVariationValues({ rowId: 'trait:1', endUseIndex: 0, mode: 'value', value: 'abc' })
    ).toThrow(/numeric/)
  })
})

describe('inspectBatchStarter', () => {
  it('derives marker loci from five weighting rows per marker', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroupWithTenMarkerRows)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')

    const inspection = inspectBatchStarter(tempDir)

    expect(inspection.markers).toHaveLength(10)
    expect(inspection.markerLocusCount).toBe(2)
  })

  it('exposes Matesel.ini histogram rows when present', () => {
    writeFile('Matesel.ini', mateselIni)
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')

    const inspection = inspectBatchStarter(tempDir)

    expect(inspection.iniRows.map((row) => row.name)).toEqual(['ProgInb', 'SireCoan', 'Polled22'])
    expect(inspection.iniWarning).toBeUndefined()
    expect(inspection.valid).toBe(true)
  })

  it('does not block when Matesel.ini lacks the histogram table', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')

    const inspection = inspectBatchStarter(tempDir)

    expect(inspection.iniRows).toEqual([])
    expect(inspection.iniWarning).toMatch(/histogram table/)
    expect(inspection.valid).toBe(true)
  })
})

describe('generateBatchJobs', () => {
  it('uses EndUses.txt as the weighting file when InpOneGroup.txt is a separate config file', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', 'Max number of backup sires reported per mating\r\n3\r\n')
    writeFile('EndUses.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))

    try {
      const inspection = inspectBatchStarter(tempDir)
      const marker = inspection.markers.find((row) => row.name === 'Polled genotype NN')
      expect(inspection.valid).toBe(true)
      expect(inspection.weightingFileName).toBe('EndUses.txt')
      expect(marker).toBeDefined()

      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        variations: [{ rowId: marker!.id, endUseIndex: 1, mode: 'value', value: '9' }]
      })

      const firstRun = result.generatedFolders[0]
      expect(fs.readFileSync(path.join(firstRun, 'InpOneGroup.txt'), 'utf8')).toBe(
        'Max number of backup sires reported per mating\r\n3\r\n'
      )
      expect(fs.readFileSync(path.join(firstRun, 'EndUses.txt'), 'utf8')).toContain(
        '      0      9           Polled genotype NN'
      )
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('copies starter files, writes only requested weighting cells, and records changes', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    writeFile('Notes.txt', 'keep me')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))

    try {
      const inspection = inspectBatchStarter(tempDir)
      const trait = inspection.traits.find((row) => row.name === 'WT_Birth')
      const marker = inspection.markers.find((row) => row.name === 'Polled genotype NN')
      expect(trait).toBeDefined()
      expect(marker).toBeDefined()

      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        variations: [
          { rowId: trait!.id, endUseIndex: 0, mode: 'list', value: '1,2' },
          { rowId: marker!.id, endUseIndex: 1, mode: 'value', value: '9' }
        ]
      })

      expect(result.generatedFolders).toHaveLength(2)
      const firstRun = result.generatedFolders[0]
      expect(fs.readFileSync(path.join(firstRun, 'Notes.txt'), 'utf8')).toBe('keep me')

      const generatedInp = fs.readFileSync(path.join(firstRun, 'InpOneGroup.txt'), 'utf8')
      expect(generatedInp).toContain('      1      0              WT_Birth')
      expect(generatedInp).toContain('      0      9           Polled genotype NN')
      expect(generatedInp).toContain('      0      -1             DM_COARSE')

      const changes = fs.readFileSync(path.join(firstRun, 'BatchChanges.txt'), 'utf8')
      expect(changes.split(/\r?\n/)[0]).toBe('Job: run_0001')
      expect(changes).toContain('Changed files: InpOneGroup.txt')
      expect(changes).toContain('Item\tType\tEndUse\tDefault\tThis run')
      expect(changes).toContain('WT_Birth\ttrait\t1\t0\t1')
      expect(changes).toContain('Polled genotype NN\tmarker\t2\t3\t9')
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('edits only the requested Matesel.ini weighting and preserves the rest of the file', () => {
    writeFile('Matesel.ini', mateselIni)
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))

    try {
      const inspection = inspectBatchStarter(tempDir)
      const progInb = inspection.iniRows.find((row) => row.name === 'ProgInb')
      expect(progInb).toBeDefined()

      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        variations: [{ rowId: progInb!.id, endUseIndex: 0, mode: 'list', value: '5,25' }]
      })

      expect(result.generatedFolders).toHaveLength(2)
      const sourceLines = mateselIni.split('\r\n')
      const firstIni = fs.readFileSync(path.join(result.generatedFolders[0], 'Matesel.ini'), 'utf8').split('\r\n')
      const secondIni = fs.readFileSync(path.join(result.generatedFolders[1], 'Matesel.ini'), 'utf8').split('\r\n')

      // Only the Weighting column (Invoked=1, ControlType=8) changes; Targets stay aligned.
      expect(firstIni[7]).toMatch(/^ProgInb\s+1\s+8\s+5\s+0\.131162\s+0\.131162\s+50\s*$/)
      expect(secondIni[7]).toMatch(/^ProgInb\s+1\s+8\s+25\s+0\.131162\s+0\.131162\s+50\s*$/)
      // Width is preserved so following columns keep their offsets.
      expect(firstIni[7].length).toBe(sourceLines[7].length)
      expect(secondIni[7].length).toBe(sourceLines[7].length)

      // Every other line is byte-for-byte identical to the source.
      sourceLines.forEach((line, index) => {
        if (index === 7) return
        expect(firstIni[index]).toBe(line)
        expect(secondIni[index]).toBe(line)
      })

      const changes = fs.readFileSync(path.join(result.generatedFolders[0], 'BatchChanges.txt'), 'utf8')
      expect(changes).toContain('Changed files: Matesel.ini')
      expect(changes).toContain('ProgInb\tini\t1\t10\t5')
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('combines Matesel.ini and EndUses variations as a cartesian product', () => {
    writeFile('Matesel.ini', mateselIni)
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))

    try {
      const inspection = inspectBatchStarter(tempDir)
      const progInb = inspection.iniRows.find((row) => row.name === 'ProgInb')!
      const trait = inspection.traits.find((row) => row.name === 'WT_Birth')!

      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        variations: [
          { rowId: progInb.id, endUseIndex: 0, mode: 'list', value: '5,25' },
          { rowId: trait.id, endUseIndex: 0, mode: 'list', value: '1,2,3' }
        ]
      })

      expect(result.generatedFolders).toHaveLength(6)
      const firstRun = result.generatedFolders[0]
      expect(fs.readFileSync(path.join(firstRun, 'Matesel.ini'), 'utf8')).toMatch(
        /ProgInb\s+1\s+8\s+5\s+0\.131162/
      )
      expect(fs.readFileSync(path.join(firstRun, 'InpOneGroup.txt'), 'utf8')).toContain(
        '      1      0              WT_Birth'
      )
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('uses the requested batch name and timestamp for the main batch folder', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        batchName: 'SR_1_F1_2',
        batchTimestamp: '2026-06-19_10-20-30',
        variations: [{ rowId: trait.id, endUseIndex: 0, mode: 'value', value: '2' }]
      })

      expect(path.basename(result.batchFolder)).toBe('Batch_SR_1_F1_2_2026-06-19_10-20-30')
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('omits the job name segment when the requested batch name is empty', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        batchName: '',
        batchTimestamp: '2026-06-19_10-20-30',
        variations: [{ rowId: trait.id, endUseIndex: 0, mode: 'value', value: '2' }]
      })

      expect(path.basename(result.batchFolder)).toBe('Batch_2026-06-19_10-20-30')
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('requires confirmation above the large batch guard', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const valueList = Array.from({ length: 501 }, (_, index) => String(index)).join(',')
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      expect(() =>
        generateBatchJobs({
          starterFolder: tempDir,
          destinationParent,
          variations: [{ rowId: trait.id, endUseIndex: 0, mode: 'list', value: valueList }]
        })
      ).toThrow(/Confirm large batch/)
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('rejects allowLargeBatch runs above the absolute cap', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const valueList = Array.from({ length: MAX_GENERATED_BATCH_RUNS + 1 }, (_, index) => String(index)).join(',')
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      expect(() =>
        generateBatchJobs({
          starterFolder: tempDir,
          destinationParent,
          variations: [{ rowId: trait.id, endUseIndex: 0, mode: 'list', value: valueList }],
          allowLargeBatch: true
        })
      ).toThrow(/absolute limit/)
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('rejects unsafe combination counts before generation', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      expect(() =>
        generateBatchJobs({
          starterFolder: tempDir,
          destinationParent,
          variations: Array.from({ length: 4 }, () => ({
            rowId: trait.id,
            endUseIndex: 0,
            mode: 'range' as const,
            value: '0-9999',
            increment: '1'
          })),
          allowLargeBatch: true
        })
      ).toThrow(/too large to generate safely/)
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  })

  it('generates confirmed batches below the absolute cap', () => {
    writeFile('Matesel.ini', 'config')
    writeFile('InpOneGroup.txt', inpOneGroup)
    writeFile('DataFile.csv', 'ID,Sex\nA,F\n')
    const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-batch-dest-'))
    const valueList = Array.from({ length: 501 }, (_, index) => String(index)).join(',')
    const trait = inspectBatchStarter(tempDir).traits[0]

    try {
      const result = generateBatchJobs({
        starterFolder: tempDir,
        destinationParent,
        variations: [{ rowId: trait.id, endUseIndex: 0, mode: 'list', value: valueList }],
        allowLargeBatch: true
      })

      expect(result.generatedFolders).toHaveLength(501)
      expect(fs.existsSync(path.join(result.generatedFolders[500], 'BatchChanges.txt'))).toBe(true)
    } finally {
      fs.rmSync(destinationParent, { recursive: true, force: true })
    }
  }, 15000)

})
