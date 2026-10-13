// Condivisione e piccoli tocchi "fisici" (vibrazione), con ripieghi quando il browser non li ha.

export type ShareOutcome = 'shared' | 'copied' | 'failed'

export async function share(text: string, url?: string): Promise<ShareOutcome> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Tinder Movies', text, url })
      return 'shared'
    }
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text)
    return 'copied'
  } catch (error) {
    // L'utente ha chiuso il pannello di condivisione: non è un errore da mostrare.
    return (error as Error).name === 'AbortError' ? 'shared' : 'failed'
  }
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* non supportato */
  }
}
