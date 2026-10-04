// `--version` and `--help` answer and exit here, imported first by start.js: ES modules evaluate in import order, so oauth.js (which prunes clients and logs at import) never runs and stdout holds only the answer AIObox reads.
import { VERSION } from './version.js';

if (process.argv.includes('-v') || process.argv.includes('--version')) {
  console.log(VERSION);
  process.exit(0);
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`@akinet/akimcp - Self-hosted remote MCP server for local filesystem & shell

Usage:
  akimcp [options]

Options:
  -v, --version            Show version number
  -h, --help               Show help
  --dev                    Run in development mode (isolated data dir & dev ports)
  --port <port>            Gatekeeper port (default: 9999, dev: 9997)
  --panel-port <port>      Control panel port (default: 9998, dev: 9996)
  --tunnel <cred.json>     Path to Cloudflare Tunnel credentials JSON
  --origin <url>           Public origin URL (required with --tunnel, e.g. https://mcp.yourdomain.com)
  --no-browser             Do not automatically open the web panel in browser
`);
  process.exit(0);
}
