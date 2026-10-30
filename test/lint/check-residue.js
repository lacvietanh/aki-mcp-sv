import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const EXPECTED = [
  { file: 'public/panel-client.js', text: "['Tools', (p) => p.tools.map((n) => n.replace(/^aki__/, '')).join(', ')]," },
]

const EXEMPT_FILES = ['scripts/verify-boundary-b1.sh', 'scripts/mcp-name.js']
const EXEMPT_DIRS = ['public/guide/']

const grep = spawnSync('git', ['grep', '-n', 'aki__', '--', 'scripts', 'public'], { cwd: repoRoot, encoding: 'utf8' })
if (grep.status !== 0 && grep.status !== 1) {
  console.error(grep.stderr || `git grep failed: ${grep.error?.message}`)
  process.exit(2)
}

const left = grep.stdout
  .split('\n')
  .map((line) => line.match(/^([^:]+):(\d+):(.*)$/))
  .filter(Boolean)
  .filter(([, file, , text]) => !EXEMPT_FILES.includes(file) && !EXEMPT_DIRS.some((dir) => file.startsWith(dir)) && !text.trimStart().startsWith('//'))
  .map(([, file, line, text]) => ({ file, line, text: text.trim() }))

for (const entry of left) console.log(`${entry.file}:${entry.line}`)

const keyOf = ({ file, text }) => `${file}\t${text}`
if (left.map(keyOf).join('\n') !== EXPECTED.map(keyOf).join('\n')) {
  console.error(`${left.length} lines above still name aki__. This check passes only when exactly these ${EXPECTED.length} are left: ${EXPECTED.map(({ file, text }) => `${file}: ${text}`).join(', ')}.`)
  process.exit(1)
}
