// Nomi buffi a tema cinema, per chi non ha voglia di scriverne uno (max 20 caratteri, come il server).

export const FUNNY_NAMES = [
  'Popcorn Ribelle',
  'Regista Distratto',
  'Critico Affamato',
  'Spoiler Vivente',
  'Re del Divano',
  'Telecomando Conteso',
  'Sequel Inatteso',
  'Titoli di Coda',
  'Comparsa Timida',
  'Trailer Infinito',
  'Ciak Si Gira',
  'Doppiatore Stonato',
  'Pausa Pipì',
  'Plaid Gigante',
  'Colpo di Scena',
  'Cinefilo Pigro',
]

export function funnyName(random: () => number = Math.random, avoid?: string): string {
  const pool = FUNNY_NAMES.filter((n) => n !== avoid)
  return pool[Math.floor(random() * pool.length)]
}
