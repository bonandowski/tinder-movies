import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { matchAll, BATCH_SIZE } from './importSeen'
import { ImportError, filmsFromBytes, filmsFromCsv, parseCsv } from './letterboxd'

const WATCHED = `Date,Name,Year,Letterboxd URI
2021-01-02,Dune,2021,https://boxd.it/a
2021-01-03,"Fast, Furious",2001,https://boxd.it/b
2021-01-04,"Dice ""ciao""",1999,https://boxd.it/c
2021-01-05,Amélie,2001,https://boxd.it/d
`

describe('parseCsv', () => {
  it('handles quotes, commas, escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  })

  it('keeps a last line without newline and skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('a\n"riga1\nriga2"\n')).toEqual([['a'], ['riga1\nriga2']])
  })
})

describe('filmsFromCsv', () => {
  it('reads title and year by column name', () => {
    expect(filmsFromCsv(WATCHED)).toEqual([
      { title: 'Dune', year: 2021 },
      { title: 'Fast, Furious', year: 2001 },
      { title: 'Dice "ciao"', year: 1999 },
      { title: 'Amélie', year: 2001 },
    ])
  })

  it('accepts Title instead of Name, any column order, and a missing or odd year', () => {
    expect(filmsFromCsv('Year,Rating,Title\n2010,4,Inception\n,3,Senza anno\nabc,3,Anno strano')).toEqual([
      { title: 'Inception', year: 2010 },
      { title: 'Senza anno', year: null },
      { title: 'Anno strano', year: null },
    ])
  })

  it('refuses a file without a title column, with a message for the user', () => {
    expect(() => filmsFromCsv('a,b\n1,2')).toThrow(ImportError)
    expect(() => filmsFromCsv('')).toThrow(/Name/)
  })
})

describe('filmsFromBytes', () => {
  const zip = (files: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))

  it('reads watched.csv from the Letterboxd ZIP and ignores the other files', () => {
    const bytes = zip({
      'watched.csv': WATCHED,
      'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2021-01-02,Altro,2000,x,4',
      'comments.csv': 'non,serve',
      'lists/mia.csv': 'roba,qualsiasi',
    })
    expect(filmsFromBytes(bytes).map((film) => film.title)).toEqual(['Dune', 'Fast, Furious', 'Dice "ciao"', 'Amélie'])
  })

  it('falls back to ratings and diary when watched.csv is missing, without duplicates', () => {
    const bytes = zip({
      'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2021,Dune,2021,x,4\n2021,Heat,1995,x,5',
      'diary.csv': 'Date,Name,Year,Letterboxd URI\n2021,Dune,2021,x',
    })
    expect(filmsFromBytes(bytes)).toEqual([
      { title: 'Dune', year: 2021 },
      { title: 'Heat', year: 1995 },
    ])
  })

  it('also reads a plain CSV (not zipped) and removes duplicate rows', () => {
    const bytes = strToU8('Name,Year\nDune,2021\nDune,2021\nDune,1984')
    expect(filmsFromBytes(bytes)).toEqual([
      { title: 'Dune', year: 2021 },
      { title: 'Dune', year: 1984 },
    ])
  })

  it('explains a ZIP without the expected files and a broken ZIP', () => {
    expect(() => filmsFromBytes(zip({ 'comments.csv': 'x' }))).toThrow(/watched\.csv/)
    expect(() => filmsFromBytes(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toThrow(ImportError)
  })
})

describe('matchAll', () => {
  const films = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Film ${i}`, year: 2000 }))
  const noWait = () => Promise.resolve()

  it('matches in batches, counts, dedupes ids and reports progress', async () => {
    const match = vi.fn(async (batch: { title: string }[]) =>
      batch.map((film, i) => (film.title === 'Film 3' ? null : i % 2 === 0 ? 7 : 8)),
    )
    const progress = vi.fn()
    const result = await matchAll(films(BATCH_SIZE + 10), match, progress, noWait)
    expect(match).toHaveBeenCalledTimes(2)
    expect(result.total).toBe(BATCH_SIZE + 10)
    expect(result.matched).toBe(BATCH_SIZE + 10 - 1)
    expect(result.ids.sort()).toEqual([7, 8])
    expect(progress.mock.calls).toEqual([
      [BATCH_SIZE, BATCH_SIZE + 10],
      [BATCH_SIZE + 10, BATCH_SIZE + 10],
    ])
  })

  it('retries a failing batch and then succeeds', async () => {
    const match = vi
      .fn<(batch: unknown[]) => Promise<(number | null)[]>>()
      .mockRejectedValueOnce(new Error('rete'))
      .mockRejectedValueOnce(new Error('rete'))
      .mockResolvedValue([1])
    const result = await matchAll(films(1), match, undefined, noWait)
    expect(result.ids).toEqual([1])
    expect(match).toHaveBeenCalledTimes(3)
  })

  it('gives up with the error when a batch keeps failing', async () => {
    const match = vi.fn().mockRejectedValue(new Error('TMDB giù'))
    await expect(matchAll(films(1), match, undefined, noWait)).rejects.toThrow('TMDB giù')
    expect(match).toHaveBeenCalledTimes(3)
  })

  it('handles an empty list', async () => {
    expect(await matchAll([], async () => [], undefined, noWait)).toEqual({ ids: [], total: 0, matched: 0 })
  })
})
