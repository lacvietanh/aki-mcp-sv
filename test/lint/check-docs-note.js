import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const EXEMPT_FILES = [
  'docs/plan/ss-session-file.md',
  'docs/plan/per-client-tool-surface.md',
  'docs/plan/IMPORTANT-akimcp-aiobox-contract.md',
  'docs/plan/v4-custom-name.md',
]
const EXEMPT_DIRS = ['docs/plan/done/', 'docs/research/']
const NOTE = /default prefix .aki__|aki__. by default/

let listed
try {
  listed = execFileSync('git', ['grep', '-l', 'aki__', '--', 'README.md', 'docs', 'public', 'CLAUDE.md'], { cwd: repoRoot, encoding: 'utf8' })
} catch (error) {
  if (error.status !== 1) {
    console.error(error.stderr || `git grep failed: ${error.message}`)
    process.exit(2)
  }
  listed = ''
}

const missing = listed
  .split('\n')
  .filter(Boolean)
  .filter((file) => !EXEMPT_FILES.includes(file) && !EXEMPT_DIRS.some((dir) => file.startsWith(dir)))
  .filter((file) => !NOTE.test(readFileSync(resolve(repoRoot, file), 'utf8')))

for (const file of missing) console.log(file)

if (missing.length) {
  console.error(`${missing.length} files above name aki__ without the default-prefix note.`)
  process.exit(1)
}
