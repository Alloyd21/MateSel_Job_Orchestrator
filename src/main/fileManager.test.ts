import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverJobFolders,
  deleteOutputFiles,
  findMateSelDataFileName,
  listJobFolderFiles,
  listOutputFiles,
  prepareMateSelDataFile,
  readBatchChanges,
  validateJobFolder
} from './fileManager'

let tempDir: string

function writeFile(fileName: string, content = ''): void {
  fs.writeFileSync(path.join(tempDir, fileName), content)
}

function writeFileIn(folderPath: string, fileName: string, content = ''): void {
  fs.mkdirSync(folderPath, { recursive: true })
  fs.writeFileSync(path.join(folderPath, fileName), content)
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matesel-orchestrator-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('findMateSelDataFileName', () => {
  it('prefers a CSV source over an existing Matesel.txt so it regenerates fresh', () => {
    writeFile('DataFile.csv')
    writeFile('MATESEL.TXT')

    expect(findMateSelDataFileName(tempDir)).toBe('DataFile.csv')
  })

  it('falls back to Matesel.txt when no CSV or DataFile source exists', () => {
    writeFile('Matesel.txt')

    expect(findMateSelDataFileName(tempDir)).toBe('Matesel.txt')
  })

  it('accepts demo files and DataFile text or CSV inputs', () => {
    writeFile('ExampleDemoInput.txt')

    expect(findMateSelDataFileName(tempDir)).toBe('ExampleDemoInput.txt')

    fs.unlinkSync(path.join(tempDir, 'ExampleDemoInput.txt'))
    writeFile('DataFileAnimals.txt')
    expect(findMateSelDataFileName(tempDir)).toBe('DataFileAnimals.txt')

    fs.unlinkSync(path.join(tempDir, 'DataFileAnimals.txt'))
    writeFile('DataFileAnimals.csv')
    expect(findMateSelDataFileName(tempDir)).toBe('DataFileAnimals.csv')
  })

  it('prefers MateselClassicDemo over generic demo and DataFile inputs', () => {
    writeFile('DataFileAnimals.txt')
    writeFile('ExampleDemoInput.txt')
    writeFile('MateselClassicDemo.txt')

    expect(findMateSelDataFileName(tempDir)).toBe('MateselClassicDemo.txt')
  })

  it('ignores non-MateSel-looking CSV and text files during automatic detection', () => {
    writeFile('Animals.csv')
    writeFile('notes.txt')

    expect(findMateSelDataFileName(tempDir)).toBeUndefined()
  })
})

describe('prepareMateSelDataFile', () => {
  it('converts CSV input into Matesel.txt with MateSel blank-value defaults', () => {
    writeFile(
      'DataFile.csv',
      [
        'ID,Sire,Dam,Sex,MatingGroup,g_marker,EBV',
        'Animal1,,,U,,U,1.2300000000',
        'Animal2,Sire1,Dam1,F,2,1,4'
      ].join('\n')
    )

    expect(prepareMateSelDataFile(tempDir)).toBe('Matesel.txt')
    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      [
        'ID Sire Dam Sex MatingGroup g_marker EBV',
        'Animal1 0 0 0 0 0 1.23',
        'Animal2 Sire1 Dam1 F 2 1 4',
        ''
      ].join('\r\n')
    )
  })

  it('parses quoted comma fields without corrupting CSV columns', () => {
    writeFile('DataFile.csv', ['ID,Sex,Trait', '"Animal,One",F,2'].join('\n'))

    prepareMateSelDataFile(tempDir)

    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      ['ID Sex Trait', 'Animal,One F 2', ''].join('\r\n')
    )
  })

  it('parses escaped quotes inside quoted CSV fields', () => {
    writeFile('DataFile.csv', ['ID,Sex,Trait', '"Animal""A""",M,4'].join('\n'))

    prepareMateSelDataFile(tempDir)

    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      ['ID Sex Trait', 'Animal"A" M 4', ''].join('\r\n')
    )
  })

  it('removes a UTF-8 BOM from the first CSV header', () => {
    writeFile('DataFile.csv', ['\ufeffID,Sex,Trait', 'A1,U,3'].join('\n'))

    prepareMateSelDataFile(tempDir)

    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      ['ID Sex Trait', 'A1 0 3', ''].join('\r\n')
    )
  })

  it('keeps existing unquoted CSV normalization with CRLF input and blank trailing records', () => {
    writeFile(
      'DataFile.csv',
      ['ID,Sire,Dam,Sex,MatingGroup,g_marker,EBV', 'Animal1,,,U,,U,1.2300000000', '', ''].join('\r\n')
    )

    prepareMateSelDataFile(tempDir)

    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      ['ID Sire Dam Sex MatingGroup g_marker EBV', 'Animal1 0 0 0 0 0 1.23', ''].join('\r\n')
    )
  })

  it('passes through recognised text inputs without rewriting them', () => {
    writeFile('Matesel.txt', 'existing content')

    expect(prepareMateSelDataFile(tempDir)).toBe('Matesel.txt')
    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe('existing content')
  })

  it('uses an explicitly selected CSV even when it is not auto-detectable', () => {
    writeFile('AnimalsForRun.csv', ['ID,Sex,Trait', 'A1,U,', 'A2,M,2.5000000000'].join('\n'))

    expect(prepareMateSelDataFile(tempDir, 'AnimalsForRun.csv')).toBe('Matesel.txt')
    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      ['ID Sex Trait', 'A1 0 -999999', 'A2 M 2.5', ''].join('\r\n')
    )
  })

  it('uses an explicitly selected text file without renaming it', () => {
    writeFile('AnimalsForRun.txt', 'custom MateSel input')

    expect(prepareMateSelDataFile(tempDir, 'AnimalsForRun.txt')).toBe('AnimalsForRun.txt')
    expect(fs.existsSync(path.join(tempDir, 'Matesel.txt'))).toBe(false)
  })

  it('normalizes blank parent, group, marker, and trait values for CSV inputs', () => {
    writeFile(
      'DataFile.csv',
      [
        'ID,Sire,Dam,MatingGroup,g_a,gp_b,Trait',
        'A1,,,,U,,-12.3400000000',
        'A2,S1,D1,3,1,U,'
      ].join('\n')
    )

    prepareMateSelDataFile(tempDir)

    expect(fs.readFileSync(path.join(tempDir, 'Matesel.txt'), 'utf8')).toBe(
      [
        'ID Sire Dam MatingGroup g_a gp_b Trait',
        'A1 0 0 0 0 0 -12.34',
        'A2 S1 D1 3 1 0 -999999',
        ''
      ].join('\r\n')
    )
  })

  it('throws when the selected data file is missing', () => {
    expect(() => prepareMateSelDataFile(tempDir, 'Missing.csv')).toThrow(
      /Selected data file not found/
    )
  })

  it('throws when the selected CSV data file is empty', () => {
    writeFile('DataFile.csv', '\n\n')

    expect(() => prepareMateSelDataFile(tempDir)).toThrow(/Data file is empty/)
  })
})

describe('validateJobFolder', () => {
  it('reports missing MateSel config before checking data files', () => {
    writeFile('DataFile.csv')

    expect(validateJobFolder(tempDir)).toEqual({
      valid: false,
      warnings: ['Missing Matesel.ini']
    })
  })

  it('asks for a data-file choice when config exists but no recognised data file exists', () => {
    writeFile('Matesel.ini')
    writeFile('UnexpectedInput.csv')

    expect(validateJobFolder(tempDir)).toEqual({
      valid: false,
      warnings: ['No Matesel.txt, MateselClassicDemo.txt, DataFile*.txt, or DataFile*.csv found'],
      needsDataFile: true,
      files: ['Matesel.ini', 'UnexpectedInput.csv']
    })
  })

  it('accepts a configured folder with recognised data and reports optional support-file warnings', () => {
    writeFile('Matesel.ini')
    writeFile('DataFile.csv')

    expect(validateJobFolder(tempDir)).toEqual({
      valid: true,
      warnings: ['Missing EndUses.txt', 'Missing InpOneGroup.txt']
    })
  })

  it('returns no warnings when the expected support files are present', () => {
    writeFile('Matesel.ini')
    writeFile('Matesel.txt')
    writeFile('EndUses.txt')
    writeFile('InpOneGroup.txt')

    expect(validateJobFolder(tempDir)).toEqual({
      valid: true,
      warnings: []
    })
  })
})

describe('readBatchChanges', () => {
  it('returns parsed batch change rows when BatchChanges.txt has the generated table', () => {
    writeFile(
      'BatchChanges.txt',
      [
        'Job: run_0001',
        'Batch weighting changes compared with starter defaults',
        '',
        'Item\tType\tEndUse\tDefault\tThis run',
        'Polled allele N\tmarker\t1\t-2.5\t-3',
        'WT_Birth\ttrait\t2\t0\t1',
        ''
      ].join('\r\n')
    )

    expect(readBatchChanges(tempDir)).toEqual([
      {
        item: 'Polled allele N',
        type: 'marker',
        endUse: '1',
        defaultValue: '-2.5',
        thisRun: '-3'
      },
      {
        item: 'WT_Birth',
        type: 'trait',
        endUse: '2',
        defaultValue: '0',
        thisRun: '1'
      }
    ])
  })

  it('returns no rows when BatchChanges.txt is missing or does not contain the table header', () => {
    expect(readBatchChanges(tempDir)).toEqual([])

    writeFile('BatchChanges.txt', 'Notes only')

    expect(readBatchChanges(tempDir)).toEqual([])
  })
})

describe('discoverJobFolders', () => {
  it('finds nested folders containing Matesel.ini and returns them sorted', () => {
    const runB = path.join(tempDir, 'parent', 'RunB')
    const runA = path.join(tempDir, 'parent', 'RunA')
    const nestedRun = path.join(tempDir, 'parent', 'Group', 'NestedRun')
    writeFileIn(runB, 'Matesel.ini')
    writeFileIn(runA, 'Matesel.ini')
    writeFileIn(nestedRun, 'Matesel.ini')
    writeFileIn(path.join(tempDir, 'parent', 'NoConfig'), 'DataFile.csv')

    expect(discoverJobFolders([path.join(tempDir, 'parent')])).toEqual([nestedRun, runA, runB])
  })

  it('deduplicates folders discovered through overlapping roots', () => {
    const run = path.join(tempDir, 'parent', 'RunA')
    writeFileIn(run, 'Matesel.ini')

    expect(discoverJobFolders([tempDir, path.join(tempDir, 'parent'), run])).toEqual([run])
  })
})

describe('listJobFolderFiles', () => {
  it('returns only files sorted by display name', () => {
    writeFile('z.csv')
    writeFile('a.txt')
    fs.mkdirSync(path.join(tempDir, 'nested'))

    expect(listJobFolderFiles(tempDir)).toEqual(['a.txt', 'z.csv'])
  })
})

describe('output file cleanup', () => {
  it('finds and deletes Out-prefixed files only', () => {
    writeFile('OutResults.txt')
    writeFile('output.log')
    writeFile('About.txt')
    fs.mkdirSync(path.join(tempDir, 'OutFolder'))

    expect(listOutputFiles(tempDir).map((filePath) => path.basename(filePath)).sort()).toEqual([
      'OutResults.txt',
      'output.log'
    ])

    deleteOutputFiles([tempDir])

    expect(fs.readdirSync(tempDir).sort()).toEqual(['About.txt', 'OutFolder'])
  })
})
