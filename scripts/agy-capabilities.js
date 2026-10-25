// The one place that knows what the agy CLI offers: it runs `agy --version`, `agy models` and `agy --help`, parses them, and caches the result (docs/plan/audit-tool-drift-oct25.md D1). agy-mcp.js holds no model list, no effort/mode/output-format enum — this module reads them live so a new agy release needs no AkiMCP edit.
// The model list is server-side (`agy models` prints "Fetching available models…"), so it moves without an agy version bump: the cache is keyed by both a 1 h TTL and the version string, and a probe that fails or parses to nothing leaves that field null, which the tool treats as a pass-through.
import { execFile } from 'node:child_process';

const PROBE_TIMEOUT_MS = 15_000;
const TTL_MS = 60 * 60_000;

// Defaults are injectable so the fixture tests exercise the parsers and resolver with recorded CLI text and never spawn agy (docs/plan/audit-tool-drift-oct25.md D7).
function runAgy(args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile('agy', args, { cwd, timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      // agy prints "Fetching available models…" and some notices to stderr while the payload goes to stdout; a non-zero exit with usable stdout is still parsed.
      resolve({ ok: !error || Boolean(stdout?.trim()), stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// `agy models` lines are `id<TAB>label`; the "Fetching…" progress line and anything without a tab are dropped. Empty or unparsable output → null (pass-through), never [].
export function parseModels(text) {
  const rows = String(text).split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.includes('\t'))
    .map((line) => { const i = line.indexOf('\t'); return { id: line.slice(0, i).trim(), label: line.slice(i + 1).trim() }; })
    .filter((m) => /^[\w.-]+$/.test(m.id));
  return rows.length ? rows : null;
}

// `agy --help` lists each enum after its flag as `(a|b|c)` or `(a, b, c)`, e.g. `--effort  Reasoning effort … (low|medium|high|xhigh|max)`. Returns the values for one flag, or null when the line or list is absent.
export function parseHelpEnum(text, flag) {
  const line = String(text).split('\n').find((l) => new RegExp(`(^|\\s)--${flag}(\\s|$)`).test(l));
  if (!line) return null;
  const m = line.match(/\(([^()]*)\)/);
  if (!m) return null;
  const values = m[1].split(/[|,]/).map((v) => v.trim()).filter(Boolean);
  return values.length ? values : null;
}

// D3: the discovery tier is "the newest gemini-<n>-flash-medium". The version is compared field by field as integers, not as a float, so 3.10 (minor 10) beats 3.9 (minor 9) — Number('3.10') would wrongly read 3.1. Pure function of the models array; null when none matches (the tool then omits --model and agy uses its own default).
const versionKey = (v) => v.split('.').map(Number);
function versionGreater(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
export function newestFlashMedium(models) {
  if (!Array.isArray(models)) return null;
  let best = null;
  let bestKey = null;
  for (const m of models) {
    const match = /^gemini-(\d+(?:\.\d+)?)-flash-medium$/.exec(m.id);
    if (!match) continue;
    const key = versionKey(match[1]);
    if (!bestKey || versionGreater(key, bestKey)) { bestKey = key; best = m.id; }
  }
  return best;
}

let cache = null;

// One probe of the three commands; each field is null when its command failed or parsed to nothing. `at` and `version` key the cache.
export async function probe({ spawn = runAgy, cwd } = {}) {
  const ver = await spawn(['--version'], { cwd });
  const version = ver.ok ? ver.stdout.trim() || null : null;
  const [models, help] = await Promise.all([spawn(['models'], { cwd }), spawn(['--help'], { cwd })]);
  const helpText = help.ok ? help.stderr + '\n' + help.stdout : '';
  return {
    version,
    models: models.ok ? parseModels(models.stdout) : null,
    modes: parseHelpEnum(helpText, 'mode'),
    efforts: parseHelpEnum(helpText, 'effort'),
    outputFormats: parseHelpEnum(helpText, 'output-format'),
    at: Date.now(),
  };
}

// Lazily probed and cached (D1): the first list/default/error-refresh pays the probe once; a fresh cache within the TTL and the same version is reused. Never runs at boot — an opt-in provider switched off must not spawn a CLI.
export async function capabilities({ spawn = runAgy, cwd, now = Date.now } = {}) {
  if (cache && now() - cache.at < TTL_MS) return cache;
  cache = await probe({ spawn, cwd });
  return cache;
}

// Forced re-probe, used after a call fails naming a model/effort/output-format: the list may have changed server-side with no version bump.
export async function refresh({ spawn = runAgy, cwd } = {}) {
  cache = await probe({ spawn, cwd });
  return cache;
}

// Test seam: drop the cache so a test starts cold.
export function resetCache() { cache = null; }
