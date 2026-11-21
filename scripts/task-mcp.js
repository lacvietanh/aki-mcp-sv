// Background Task Runner for aki-mcp-sv.
// Executes allowlist-approved shell commands and long-running CLI tasks in detached background processes,
// streams stdout/stderr directly to disk to prevent memory bloating,
// tracks PID/liveness with process-group teardown, and tails logs on demand.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { USER_DIR } from './userdata.js';
import { resolveUnderRoot, refuseCredentialArgs, redactText } from './roots.js';
import { Shell } from './shell-mcp.js';
import { ok, fail } from './mcp-tool.js';
import { pidAlive } from './pid-alive.js';
import { served } from './mcp-name.js';
import { launchOf } from './find-on-path.js';

const TASKS_FILE = path.join(USER_DIR, 'tasks.json');
const TASK_LOGS_DIR = path.join(USER_DIR, 'task-logs');
const MAX_AGY_SUMMARY_BYTES = 4 * 1024 * 1024;
const MAX_ERR_TAIL_BYTES = 2048;

function loadTasks() {
  if (!fs.existsSync(TASKS_FILE)) return {};
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveTasks(tasks) {
  fs.mkdirSync(USER_DIR, { recursive: true, mode: 0o700 });
  // Prune completed/stopped tasks if total exceeds 100 to prevent unbounded growth
  const entries = Object.entries(tasks);
  if (entries.length > 100) {
    entries.sort((a, b) => new Date(b[1].startTime || 0) - new Date(a[1].startTime || 0));
    const pruned = Object.fromEntries(entries.slice(0, 100));
    fs.writeFileSync(TASKS_FILE, JSON.stringify(pruned, null, 2), 'utf8');
    return;
  }
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

function saveTask(task) {
  const tasks = loadTasks();
  tasks[task.taskId] = task;
  saveTasks(tasks);
}

// Platform teardown table: keeps process-group killing OS-agnostic with no inline platform branches.
const KILL_PROCESS_GROUP = {
  win32: (pid) => {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    } catch {}
  },
  posix: (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch (e) {
      if (e.code === 'ESRCH') return;
      try {
        process.kill(pid, signal);
      } catch {}
    }
  },
};

const DETACHED_PROCESS_GROUP = {
  win32: false,
};

export const supportsDetachedProcessGroup = () => DETACHED_PROCESS_GROUP[process.platform] ?? true;

export function killProcessGroup(pid, signal = 'SIGTERM') {
  if (!pid || typeof pid !== 'number' || pid <= 0) return;
  const killer = KILL_PROCESS_GROUP[process.platform] || KILL_PROCESS_GROUP.posix;
  killer(pid, signal);
}

const MAX_TAIL_BYTES = 1024 * 1024; // the tail goes to the model; a larger ask is cut here rather than buffered whole

export function readLogTail(logPath, maxBytes = 10240, maxLines = null) {
  if (!fs.existsSync(logPath)) return '(no logs yet)';
  let stat;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return '(log file inaccessible)';
  }
  const size = stat.size;
  if (size === 0) return '(log empty)';

  const readLen = Math.min(size, MAX_TAIL_BYTES, Math.max(1, maxBytes));
  const buffer = Buffer.alloc(readLen);
  const fd = fs.openSync(logPath, 'r');
  try {
    fs.readSync(fd, buffer, 0, readLen, Math.max(0, size - readLen));
  } finally {
    fs.closeSync(fd);
  }

  let text = buffer.toString('utf8');
  if (maxLines && maxLines > 0) {
    const hasTrailingNewline = text.endsWith('\n');
    const content = hasTrailingNewline ? text.slice(0, -1) : text;
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      text = lines.slice(-maxLines).join('\n') + (hasTrailingNewline ? '\n' : '');
    }
  }
  if (size > readLen) {
    text = `... [truncated, showing last ${readLen} bytes of ${size} total bytes] ...\n` + text;
  }
  return text;
}

// Idempotent summary extractor for finished background agy tasks (docs/plan/agy-run-tier-and-long-run.md B4a).
// Runs on exit and lazily in status() after a server restart or after list() flipped status to exited.
export function applyAgySummary(task) {
  if (!task || task.kind !== 'agy' || task.agySummaryExtracted) return false;
  task.agySummaryExtracted = true;

  let size = 0;
  try {
    size = fs.statSync(task.logFile).size;
  } catch {
    size = 0;
  }

  if (size === 0) {
    task.emptyOutput = true;
    task.agySummary = null;
    if (task.status === 'completed') task.status = 'failed';
    task.emptyOutputHint = 'agy returned no stdout — the call may have been silently denied rather than a clean empty result. Re-check errTail and prompt/scope.';
    return true;
  }

  if (size > MAX_AGY_SUMMARY_BYTES) {
    task.emptyOutput = false;
    task.agySummary = { parseSkipped: `stdout log exceeds ${MAX_AGY_SUMMARY_BYTES} bytes`, logBytes: size };
    return true;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(task.logFile, 'utf8');
  } catch {
    task.agySummary = { parseError: 'unable to read stdout log' };
    return true;
  }

  if (!raw.trim()) {
    task.emptyOutput = true;
    task.agySummary = null;
    if (task.status === 'completed') task.status = 'failed';
    task.emptyOutputHint = 'agy returned no stdout — the call may have been silently denied rather than a clean empty result. Re-check errTail and prompt/scope.';
    return true;
  }

  if (task.outputFormat !== 'json') {
    task.emptyOutput = false;
    task.agySummary = { responseChars: raw.length };
    return true;
  }

  try {
    const parsed = JSON.parse(raw);
    const responseText = typeof parsed?.response === 'string' ? parsed.response : null;
    const isEmptyResponse = responseText !== null && !responseText.trim();
    task.emptyOutput = isEmptyResponse;
    if (isEmptyResponse && task.status === 'completed') {
      task.emptyOutputHint = 'agy JSON response field is empty — possible silent denial; inspect errTail and tail_logs.';
    }
    task.agySummary = {
      status: typeof parsed?.status === 'string' ? parsed.status : null,
      durationSeconds: typeof parsed?.duration_seconds === 'number' ? parsed.duration_seconds : null,
      numTurns: typeof parsed?.num_turns === 'number' ? parsed.num_turns : null,
      usage: parsed?.usage && typeof parsed.usage === 'object' ? parsed.usage : null,
      responseChars: responseText !== null ? responseText.length : 0,
    };
  } catch {
    task.emptyOutput = false;
    task.agySummary = { parseError: 'stdout is not valid JSON', responseChars: raw.length };
  }
  return true;
}

// Shared detached background process launcher for task_start and background CLI runners (e.g. agy_run).
export async function startBackgroundProcess({
  bin,
  args,
  cwd,
  command,
  taskId: requestedId,
  kind = null,
  meta = {},
  storeArgs = true,
  separateStderr = false,
  maxConcurrentKind = null,
}) {
  const prefix = kind ? `${kind}_` : 'task_';
  const taskId = requestedId || `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    throw new Error('taskId must only contain alphanumeric characters, hyphens, and underscores');
  }

  const tasks = loadTasks();
  if (tasks[taskId] && pidAlive(tasks[taskId].pid) && tasks[taskId].status === 'running') {
    throw new Error(`Task "${taskId}" is already running (PID ${tasks[taskId].pid})`);
  }

  if (kind && typeof maxConcurrentKind === 'number' && maxConcurrentKind > 0) {
    let prunedStale = false;
    const active = [];
    for (const t of Object.values(tasks)) {
      if (t.kind !== kind || t.status !== 'running') continue;
      if (pidAlive(t.pid)) {
        active.push(t.taskId);
      } else {
        t.status = 'exited';
        prunedStale = true;
      }
    }
    if (prunedStale) saveTasks(tasks);
    if (active.length >= maxConcurrentKind) {
      throw new Error(`At concurrency limit (${maxConcurrentKind} active ${kind} background tasks: ${active.join(', ')}). Wait for one to finish or stop one with ${served('task_manage')}.`);
    }
  }

  fs.mkdirSync(TASK_LOGS_DIR, { recursive: true, mode: 0o700 });
  const logFile = path.join(TASK_LOGS_DIR, `${taskId}.log`);
  const errLogFile = separateStderr ? path.join(TASK_LOGS_DIR, `${taskId}.err.log`) : null;
  // 'w', not 'a': Git for Windows' Unix tools cannot write to an append-only handle and exit at once with an empty log.
  const outFd = fs.openSync(logFile, 'w');
  const errFd = errLogFile ? fs.openSync(errLogFile, 'w') : outFd;

  let child;
  try {
    child = spawn(...launchOf(bin, args), {
      cwd,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(outFd);
    if (errFd !== outFd) fs.closeSync(errFd);
  }

  const pid = child.pid;
  if (!pid) {
    // A failed spawn emits 'error' on the next tick and, with no listener (the one below exists only on success), exits the whole process; so wait for it.
    const reason = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1000);
      child.once('error', (e) => {
        clearTimeout(timer);
        resolve(e);
      });
    });
    const detail = reason ? `: ${reason.code || reason.message}` : '';
    throw new Error(`Failed to spawn background task process${detail}`);
  }

  child.unref();

  const record = {
    taskId,
    pid,
    command,
    bin,
    ...(storeArgs ? { args } : {}),
    cwd,
    startTime: new Date().toISOString(),
    status: 'running',
    logFile,
    ...(errLogFile ? { errLogFile } : {}),
    ...(kind ? { kind } : {}),
    ...meta,
  };

  saveTask(record);

  child.on('error', (e) => {
    try {
      const currentTasks = loadTasks();
      if (currentTasks[taskId]) {
        currentTasks[taskId].status = 'failed';
        currentTasks[taskId].error = e.message;
        saveTasks(currentTasks);
      }
      fs.appendFileSync(errLogFile || logFile, `\n[error] ${e.message}\n`);
    } catch {}
  });

  child.on('exit', (code, signal) => {
    try {
      const currentTasks = loadTasks();
      const current = currentTasks[taskId];
      if (current && current.status === 'running') {
        current.status = code === 0 ? 'completed' : 'exited';
        current.exitCode = code;
        current.exitSignal = signal;
        if (current.kind === 'agy' && !current.agySummaryExtracted) {
          applyAgySummary(current);
        }
        saveTasks(currentTasks);
      }
    } catch {}
  });

  return {
    taskId,
    pid,
    command,
    cwd,
    logFile,
    ...(errLogFile ? { errLogFile } : {}),
    status: 'running',
  };
}

export async function taskStart({ command, cwd, taskId: requestedId }) {
  if (!command || typeof command !== 'string' || !command.trim()) {
    throw new Error('command is required');
  }

  const shell = new Shell();
  const { bin, args } = shell.parse(command);
  shell.checkPermission(bin, args);
  const dir = resolveUnderRoot(cwd);
  refuseCredentialArgs(args, dir);

  return startBackgroundProcess({ bin, args, cwd: dir, command, taskId: requestedId });
}

export async function taskManage({ action, taskId, maxBytes = 10240, lines = null }) {
  const tasks = loadTasks();

  if (action === 'list') {
    let changed = false;
    const list = Object.values(tasks).map((t) => {
      const alive = t.status === 'running' && pidAlive(t.pid);
      if (!alive && t.status === 'running') {
        t.status = 'exited';
        changed = true;
      }
      return {
        taskId: t.taskId,
        pid: t.pid,
        ...(t.kind ? { kind: t.kind } : {}),
        command: t.command,
        cwd: t.cwd,
        startTime: t.startTime,
        status: t.status,
        alive,
      };
    }).sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

    if (changed) saveTasks(tasks);
    return list;
  }

  if (!taskId || typeof taskId !== 'string') {
    throw new Error(`taskId is required for action "${action}"`);
  }

  const task = tasks[taskId];
  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }

  if (action === 'status') {
    const alive = task.status === 'running' && pidAlive(task.pid);
    let dirty = false;
    if (!alive && task.status === 'running') {
      task.status = 'exited';
      dirty = true;
    }
    if (task.kind === 'agy' && !alive && !task.agySummaryExtracted) {
      applyAgySummary(task);
      dirty = true;
    }
    if (dirty) saveTask(task);

    let logSize = 0;
    try {
      logSize = fs.statSync(task.logFile).size;
    } catch {}

    const extra = {};
    if (task.errLogFile) {
      let errLogSize = 0;
      try {
        errLogSize = fs.statSync(task.errLogFile).size;
      } catch {}
      extra.errLogSize = errLogSize;
      if (errLogSize > 0) {
        extra.errTail = redactText(readLogTail(task.errLogFile, MAX_ERR_TAIL_BYTES));
      }
    }

    return {
      ...task,
      alive,
      logSize,
      ...extra,
    };
  }

  if (action === 'tail_logs') {
    return readLogTail(task.logFile, maxBytes, lines);
  }

  if (action === 'stop') {
    const alive = task.status === 'running' && pidAlive(task.pid);
    if (alive) {
      killProcessGroup(task.pid);
    }
    task.status = 'stopped';
    saveTask(task);
    return {
      taskId,
      pid: task.pid,
      stopped: true,
      wasAlive: alive,
    };
  }

  if (action === 'delete') {
    const alive = task.status === 'running' && pidAlive(task.pid);
    if (alive) {
      throw new Error(`Task "${taskId}" is running. Stop it before deleting.`);
    }
    delete tasks[taskId];
    saveTasks(tasks);
    for (const file of [task.logFile, task.errLogFile]) {
      if (!file) continue;
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {}
    }
    return {
      taskId,
      deleted: true,
    };
  }
}

export const provider = { id: 'task', title: 'Background tasks', register };

export function register(server) {
  server.registerTool(
    'task_start',
    {
      title: 'Start Background Task',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description: 'Start an allowlist-approved shell command in the background (detached process). Logs are streamed directly to disk. Returns taskId and pid for tracking with ' + served('task_manage') + '.',
      inputSchema: {
        command: z.string().describe('The shell command to run in background (e.g. "npm test", "git status")'),
        cwd: z.string().optional().describe('Working directory under allowed roots'),
        taskId: z.string().optional().describe('Optional unique identifier for the task (letters, numbers, _, -)'),
      },
    },
    async ({ command, cwd, taskId }) => {
      try {
        const result = await taskStart({ command, cwd, taskId });
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'task_manage',
    {
      title: 'Manage Background Tasks',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Manage background tasks started with ' + served('task_start') + ' or ' + served('agy_run') + ': inspect status/liveness (with stderr tail and agy JSON summary), tail logs without loading full files into memory, stop process trees cleanly, list tasks, or delete finished records.',
      inputSchema: {
        action: z.enum(['status', 'tail_logs', 'stop', 'list', 'delete']).describe('Task action'),
        taskId: z.string().optional().describe('Task ID (required for status, tail_logs, stop, delete)'),
        maxBytes: z.number().optional().describe('Max bytes to tail from log file (default: 10240)'),
        lines: z.number().optional().describe('Max lines from end of log to return'),
      },
    },
    async ({ action, taskId, maxBytes, lines }) => {
      try {
        const result = await taskManage({ action, taskId, maxBytes, lines });
        if (action === 'tail_logs') {
          return ok(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        }
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
