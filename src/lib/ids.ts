import { randomBytes } from 'crypto'

function shortId(prefix: string): string {
  const b = randomBytes(6).toString('hex')
  return `${prefix}_${b}`
}

export const newId = {
  tenant: () => shortId('ten'),
  portfolio: () => shortId('prt'),
  project: () => shortId('prj'),
  asset: () => shortId('ast'),
  fact: () => shortId('fact'),
  capital: () => shortId('cap'),
  importJob: () => shortId('imp'),
  insight: () => shortId('ins'),
}
