// Background Task Runner for aki-mcp-sv.
// Executes allowlist-approved shell commands in detached background processes,
// streams stdout/stderr directly to disk to prevent memory bloating,
// tracks PID/liveness with process-group teardown, and tails logs on demand.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { USER_DIR } from './userdata.js';
import { resolveUnderRoot } from './roots.js';
import { Shell } from './shell-mcp.js';
import { ok, err, fail } from './mcp-tool.js';

export const TASKS_FILE = path.join(USER_DIR, 'tasks.json');
export const TASK_LOGS_DIR = path.join(USER_DIR, 'task-logs');

export function loadTasks() {
  if (!fs.existsSync(TASKS_FILE)) return {};
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTasks(tasks) {
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

export function saveTask(task) {
  const tasks = loadTasks();
  tasks[task.taskId] = task;
  saveTasks(tasks);
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function killProcessGroup(pid, signal = 'SIGTERM') {
  if (!pid || typeof pid !== 'number' || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    } catch {}
  } else {
    try {
      process.kill(-pid, signal);
    } catch (e) {
      if (e.code === 'ESRCH') return;
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }
}

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

  const readLen = Math.min(size, Math.max(1, maxBytes));
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

export async function taskStart({ command, cwd, taskId: requestedId }) {
  if (!command || typeof command !== 'string' || !command.trim()) {
    throw new Error('command is required');
  }

  const taskId = requestedId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    throw new Error('taskId must only contain alphanumeric characters, hyphens, and underscores');
  }

  const tasks = loadTasks();
  if (tasks[taskId] && isProcessAlive(tasks[taskId].pid) && tasks[taskId].status === 'running') {
    throw new Error(`Task "${taskId}" is already running (PID ${tasks[taskId].pid})`);
  }

  const shell = new Shell();
  const { bin, args } = shell.parse(command);
  shell.checkPermission(bin, args);
  const dir = resolveUnderRoot(cwd);

  fs.mkdirSync(TASK_LOGS_DIR, { recursive: true, mode: 0o700 });
  const logFile = path.join(TASK_LOGS_DIR, `${taskId}.log`);
  const outFd = fs.openSync(logFile, 'a');

  let child;
  try {
    child = spawn(bin, args, {
      cwd: dir,
      detached: true,
      stdio: ['ignore', outFd, outFd],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(outFd);
  }

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn background task process');
  }

  child.unref();

  const record = {
    taskId,
    pid,
    command,
    bin,
    args,
    cwd: dir,
    startTime: new Date().toISOString(),
    status: 'running',
    logFile,
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
      fs.appendFileSync(logFile, `\n[error] ${e.message}\n`);
    } catch {}
  });

  child.on('exit', (code, signal) => {
    try {
      const currentTasks = loadTasks();
      if (currentTasks[taskId] && currentTasks[taskId].status === 'running') {
        currentTasks[taskId].status = code === 0 ? 'completed' : 'exited';
        currentTasks[taskId].exitCode = code;
        currentTasks[taskId].exitSignal = signal;
        saveTasks(currentTasks);
      }
    } catch {}
  });

  return {
    taskId,
    pid,
    command,
    cwd: dir,
    logFile,
    status: 'running',
  };
}

export async function taskManage({ action, taskId, maxBytes = 10240, lines = null }) {
  const tasks = loadTasks();

  if (action === 'list') {
    let changed = false;
    const list = Object.values(tasks).map((t) => {
      const alive = t.status === 'running' && isProcessAlive(t.pid);
      if (!alive && t.status === 'running') {
        t.status = 'exited';
        changed = true;
      }
      return {
        taskId: t.taskId,
        pid: t.pid,
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
    const alive = task.status === 'running' && isProcessAlive(task.pid);
    if (!alive && task.status === 'running') {
      task.status = 'exited';
      saveTask(task);
    }
    let logSize = 0;
    try {
      logSize = fs.statSync(task.logFile).size;
    } catch {}

    return {
      ...task,
      alive,
      logSize,
    };
  }

  if (action === 'tail_logs') {
    return readLogTail(task.logFile, maxBytes, lines);
  }

  if (action === 'stop') {
    const alive = task.status === 'running' && isProcessAlive(task.pid);
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
    const alive = task.status === 'running' && isProcessAlive(task.pid);
    if (alive) {
      throw new Error(`Task "${taskId}" is running. Stop it before deleting.`);
    }
    delete tasks[taskId];
    saveTasks(tasks);
    try {
      if (fs.existsSync(task.logFile)) {
        fs.unlinkSync(task.logFile);
      }
    } catch {}
    return {
      taskId,
      deleted: true,
    };
  }

  throw new Error(`Unknown action: ${action}`);
}

export function register(server) {
  server.registerTool(
    'task_start',
    {
      title: 'Start Background Task',
      description: 'Start an allowlist-approved shell command in the background (detached process). Logs are streamed directly to disk with zero-RAM overhead. Returns taskId and pid for tracking with aki__task_manage.',
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
      description: 'Manage background tasks started with aki__task_start: inspect status/liveness, tail logs without loading full files into memory, stop process trees cleanly across platforms, list tasks, or delete finished records.',
      inputSchema: {
        action: z.enum(['status', 'tail_logs', 'stop', 'list', 'delete']).describe('Action: status, tail_logs, stop, list, delete'),
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
