import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const p = path.join(__dirname, '..', 'src', 'http', 'router.ts')
let lines = fs.readFileSync(p, 'utf8').split('\n')
lines = lines.map(line => {
  const t = line.trimEnd()
  if (t.includes('finalizeAudit(ctx, event, json(')) {
    if (t.endsWith('))')) return line
    if (t.endsWith(')')) return line.replace(/\)\s*$/, '))')
  }
  return line
})
fs.writeFileSync(p, lines.join('\n'))
console.log('fixed finalizeAudit closing parens')
