import { describe, expect, it } from 'vitest'
import { FUNNY_NAMES, funnyName } from './names'

describe('funnyName', () => {
  it('fits the 20 characters the server accepts', () => {
    for (const name of FUNNY_NAMES) expect(name.length).toBeLessThanOrEqual(20)
  })

  it('picks from the list and can avoid the current one', () => {
    expect(FUNNY_NAMES).toContain(funnyName())
    expect(funnyName(() => 0, FUNNY_NAMES[0])).toBe(FUNNY_NAMES[1])
  })
})
