import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  expandBatchVariationValues,
  generateBatchJobs,
  inspectBatchStarter,
  MAX_GENERATED_BATCH_RUNS,
  parseInpOneGroup
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
      expect(changes).toContain('Changed file: InpOneGroup.txt')
      expect(changes).toContain('Item\tType\tEndUse\tDefault\tThis run')
      expect(changes).toContain('WT_Birth\ttrait\t1\t0\t1')
      expect(changes).toContain('Polled genotype NN\tmarker\t2\t3\t9')
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
