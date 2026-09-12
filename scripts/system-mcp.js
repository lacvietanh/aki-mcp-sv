// OS Native System MCP tools (notify_user, clipboard_read, clipboard_write).
// Zero-dependency bridge connecting remote AI clients (Claude Web, ChatGPT) to local OS capabilities:
// Desktop notifications & sound bell, and System Clipboard read/write.
import { z } from 'zod';
import cp from 'node:child_process';
import { ok, fail } from './mcp-tool.js';

// Not `promisify(cp.exec)`: `exec` carries a `util.promisify.custom` symbol that routes straight
// to the real implementation, so a test mocking `cp.exec` never actually intercepts it. This
// manual wrapper calls `cp.exec` through a plain property lookup, which mocks do intercept.
const execAsync = (cmd) => new Promise((resolve, reject) => {
  cp.exec(cmd, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })));
});

export async function notifyUser({ message, title = 'Aki MCP', sound = true } = {}) {
  if (!message) throw new Error('message is required');
  const safeTitle = String(title).replace(/["\\]/g, '');
  const safeMsg = String(message).replace(/["\\]/g, '');

  if (process.platform === 'darwin') {
    const soundClause = sound ? ' sound name "Glass"' : '';
    const script = `display notification "${safeMsg}" with title "${safeTitle}"${soundClause}`;
    await execAsync(`osascript -e '${script}'`);
    return { notified: true, platform: 'darwin', title: safeTitle, message: safeMsg };
  }

  if (process.platform === 'win32') {
    const psScript = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
      $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02;
      $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template);
      $text = $xml.GetElementsByTagName('text');
      $text[0].AppendChild($xml.CreateTextNode('${safeTitle}')) > $null;
      $text[1].AppendChild($xml.CreateTextNode('${safeMsg}')) > $null;
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aki MCP').Show($toast);
    `.replace(/\n\s+/g, ' ');
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`).catch(() => {
      // Fallback to simpler balloon/beep if Toast API fails on older Windows
      return execAsync(`powershell -NoProfile -Command "[console]::beep(800,200)"`);
    });
    return { notified: true, platform: 'win32', title: safeTitle, message: safeMsg };
  }

  // Linux (notify-send)
  await execAsync(`notify-send "${safeTitle}" "${safeMsg}"`).catch(() => {});
  return { notified: true, platform: 'linux', title: safeTitle, message: safeMsg };
}

export async function clipboardRead() {
  if (process.platform === 'darwin') {
    const { stdout } = await execAsync('pbpaste');
    return { text: stdout, length: stdout.length };
  }

  if (process.platform === 'win32') {
    const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Clipboard"');
    return { text: stdout.trimEnd(), length: stdout.length };
  }

  // Linux
  try {
    const { stdout } = await execAsync('wl-paste');
    return { text: stdout, length: stdout.length };
  } catch {
    const { stdout } = await execAsync('xclip -selection clipboard -o');
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

export function register(server) {
  server.registerTool(
    'notify_user',
    {
      title: 'OS Notification & Sound Alert',
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
