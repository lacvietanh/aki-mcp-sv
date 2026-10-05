// OS Native System MCP tools (notify_user, clipboard_read, clipboard_write).
// Zero-dependency bridge connecting remote AI clients (Claude Web, ChatGPT) to local OS capabilities:
// Desktop notifications & sound bell, and System Clipboard read/write.
import { z } from 'zod';
import cp from 'node:child_process';
import { ok, fail } from './mcp-tool.js';

// Not `promisify(cp.execFile)`: it carries a `util.promisify.custom` symbol that routes straight to the real implementation, so a test mocking `cp.execFile` would never intercept it.
// execFile, never exec: the notification text comes from the model, and no shell may parse it.
const run = (file, args = [], options = {}) => new Promise((resolve, reject) => {
  cp.execFile(file, args, { windowsHide: true, ...options }, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })));
});

const WINDOWS_TOAST = `
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
  $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02;
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template);
  $text = $xml.GetElementsByTagName('text');
  $text[0].AppendChild($xml.CreateTextNode($env:AKI_NOTIFY_TITLE)) > $null;
  $text[1].AppendChild($xml.CreateTextNode($env:AKI_NOTIFY_MESSAGE)) > $null;
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aki MCP').Show($toast);
`.replace(/\n\s+/g, ' ');

// Title and message travel as data on every platform (script arguments, environment, argv), never inside a script or command line.
// notified is true only when a banner was shown: a beep alone or a missing notifier must not read as delivered (A15).
export async function notifyUser({ message, title = 'Aki MCP', sound = true } = {}, platform = process.platform) {
  if (!message) throw new Error('message is required');
  const text = String(message);
  const heading = String(title);
  const result = { notified: true, platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux', title: heading, message: text };

  if (platform === 'darwin') {
    const display = `display notification (item 1 of argv) with title (item 2 of argv)${sound ? ' sound name "Glass"' : ''}`;
    await run('osascript', ['-e', 'on run argv', '-e', display, '-e', 'end run', '--', text, heading]);
    return result;
  }

  if (platform === 'win32') {
    const env = { ...process.env, AKI_NOTIFY_TITLE: heading, AKI_NOTIFY_MESSAGE: text };
    try {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_TOAST], { env });
      return result;
    } catch {
      // Toast API missing on older Windows: a beep still reaches the user, but no text does.
      await run('powershell', ['-NoProfile', '-Command', '[console]::beep(800,200)']);
      return { ...result, notified: false, fallback: 'beep', next: 'only a beep sounded (Windows Toast failed): give the message in chat' };
    }
  }

  try {
    await run('notify-send', ['--', heading, text]);
  } catch (e) {
    throw new Error(`notify-send failed: ${e.message} (no_notifier; next: install libnotify (notify-send) or give the message in chat)`);
  }
  return result;
}

export async function clipboardRead() {
  if (process.platform === 'darwin') {
    const { stdout } = await run('pbpaste');
    return { text: stdout, length: stdout.length };
  }

  if (process.platform === 'win32') {
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', 'Get-Clipboard']);
    return { text: stdout.trimEnd(), length: stdout.length };
  }

  // Linux
  try {
    const { stdout } = await run('wl-paste');
    return { text: stdout, length: stdout.length };
  } catch {
    const { stdout } = await run('xclip', ['-selection', 'clipboard', '-o']);
    return { text: stdout, length: stdout.length };
  }
}

export async function clipboardWrite(text = '') {
  const content = String(text);

  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      const child = cp.spawn('pbcopy');
      child.stdin.write(content);
      child.stdin.end();
      child.on('close', (code) => {
        if (code === 0) resolve({ copied: true, length: content.length });
        else reject(new Error(`pbcopy exited with code ${code}`));
      });
      child.on('error', reject);
    });
  }

  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const child = cp.spawn('powershell', ['-NoProfile', '-Command', '$Input | Set-Clipboard']);
      child.stdin.write(content);
      child.stdin.end();
      child.on('close', (code) => {
        if (code === 0) resolve({ copied: true, length: content.length });
        else reject(new Error(`powershell Set-Clipboard exited with code ${code}`));
      });
      child.on('error', reject);
    });
  }

  // Linux
  return new Promise((resolve, reject) => {
    const child = cp.spawn('xclip', ['-selection', 'clipboard']).on('error', () => {
      const wlChild = cp.spawn('wl-copy');
      wlChild.stdin.write(content);
      wlChild.stdin.end();
      wlChild.on('close', () => resolve({ copied: true, length: content.length }));
      wlChild.on('error', reject);
    });
    child.stdin.write(content);
    child.stdin.end();
    child.on('close', (code) => {
      if (code === 0) resolve({ copied: true, length: content.length });
    });
  });
}

export const provider = { id: 'system', title: 'Notifications & clipboard', register };

export function register(server) {
  server.registerTool(
    'notify_user',
    {
      title: 'OS Notification & Sound Alert',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Display a native OS desktop notification and sound alert (macOS notification banner with Glass chime, Windows Toast, Linux notify-send) to alert the user when a long task completes.',
      inputSchema: {
        message: z.string().describe('notification message to show the user'),
        title: z.string().optional().describe('notification title (default: "Aki MCP")'),
        sound: z.boolean().optional().describe('play alert sound chime (default true)'),
      },
    },
    async ({ message, title, sound }) => {
      try {
        const res = await notifyUser({ message, title, sound: sound ?? true });
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'clipboard_read',
    {
      title: 'Read System Clipboard',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Read the current text content from the operating system clipboard (pbpaste / Get-Clipboard / xclip).',
      inputSchema: {},
    },
    async () => {
      try {
        const res = await clipboardRead();
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'clipboard_write',
    {
      title: 'Write to System Clipboard',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description: 'Copy text into the operating system clipboard so the user can immediately paste it (pbcopy / Set-Clipboard / xclip).',
      inputSchema: {
        text: z.string().describe('text to copy into the clipboard'),
      },
    },
    async ({ text }) => {
      try {
        const res = await clipboardWrite(text);
        return ok(JSON.stringify(res, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

export default { register, notifyUser, clipboardRead, clipboardWrite };
