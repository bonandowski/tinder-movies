// Legge l'export dei dati di Letterboxd (ZIP o CSV) direttamente nel browser: il file non viene
// caricato da nessuna parte, al server vanno solo titolo e anno per riconoscere i film.
import { unzipSync } from 'fflate'
import type { FilmRef } from './types'

export class ImportError extends Error {}

export const MAX_FILE_BYTES = 25 * 1024 * 1024

/** CSV con virgolette ("a, b", "dice ""ciao"""), righe CRLF o LF e BOM iniziale. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const char = src[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (src[i + 1] === '"') (field += '"', i++)
      else quoted = false
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) rows.push([...row, field])
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

/** Le colonne si trovano per nome (Name/Title e Year), qualunque sia l'ordine o quante altre ce ne siano. */
export function filmsFromCsv(text: string): FilmRef[] {
  const [header, ...rows] = parseCsv(text)
  const names = (header ?? []).map((cell) => cell.trim().toLowerCase())
  const titleColumn = names.findIndex((name) => name === 'name' || name === 'title')
  const yearColumn = names.indexOf('year')
  if (titleColumn === -1) {
    throw new ImportError('Non riconosco il formato: manca la colonna del titolo (Name). Carica lo ZIP di Letterboxd o il suo watched.csv.')
  }
  return rows.flatMap((cells) => {
    const title = (cells[titleColumn] ?? '').trim()
    if (!title) return []
    const year = yearColumn === -1 ? '' : (cells[yearColumn] ?? '').trim()
    return [{ title, year: /^\d{4}$/.test(year) ? Number(year) : null }]
  })
}

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes)
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"

/** Nello ZIP serve watched.csv; se manca bastano ratings.csv e diary.csv (anch'essi film visti). */
export function filmsFromZip(bytes: Uint8Array): FilmRef[] {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: (file) => /(^|\/)(watched|ratings|diary)\.csv$/i.test(file.name) })
  } catch {
    throw new ImportError('Non riesco ad aprire lo ZIP: è quello scaricato da Letterboxd?')
  }
  const names = Object.keys(entries)
  const watched = names.find((name) => /(^|\/)watched\.csv$/i.test(name))
  const chosen = watched ? [watched] : names
  if (chosen.length === 0) {
    throw new ImportError('Nello ZIP non trovo watched.csv: carica lo ZIP completo che scarichi da Letterboxd.')
  }
  return unique(chosen.flatMap((name) => filmsFromCsv(decode(entries[name]))))
}

export function filmsFromBytes(bytes: Uint8Array): FilmRef[] {
  return unique(isZip(bytes) ? filmsFromZip(bytes) : filmsFromCsv(decode(bytes)))
}

export async function readFilmsFromFile(file: File): Promise<FilmRef[]> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('Il file è troppo grande per essere un export di Letterboxd.')
  return filmsFromBytes(new Uint8Array(await file.arrayBuffer()))
}

function unique(films: FilmRef[]): FilmRef[] {
  const seen = new Set<string>()
  return films.filter(({ title, year }) => {
    const key = `${title}\u0000${year}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
