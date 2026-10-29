import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const EXPECTED = [
  'public/panel-client.js:558',
  'scripts/tool-call-log.js:18',
  'scripts/tool-calls-report.js:9',
  'scripts/tool-calls-report.js:15',
  'scripts/tool-calls-report.js:17',
  'scripts/tool-calls-report.js:24',
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
  .map(([, file, line]) => `${file}:${line}`)

for (const entry of left) console.log(entry)

if (left.join('\n') !== EXPECTED.join('\n')) {
  console.error(`residue differs from the expected list (${left.length} left, ${EXPECTED.length} expected)`)
  process.exit(1)
}
