import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This login service is for the Personal Mac. Elsewhere use npm run preview.');
const root = fileURLToPath(new URL('..', import.meta.url));
const label = 'com.jim.fsl-practice';
const domain = `gui/${process.getuid()}`;
const target = `${domain}/${label}`;
const destination = resolve(homedir(), 'Library/LaunchAgents', label + '.plist');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
try {
  const existing = await readFile(destination, 'utf8');
  if (!existing.includes(escape(root))) throw new Error('An unrelated service already uses this label; refusing to overwrite it.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const run = args => execFileSync('/bin/launchctl', args, { stdio: 'pipe' });
let loaded = false;
try { run(['print', target]); loaded = true; } catch (_error) { /* Service has not been bootstrapped. */ }
if (process.argv[2] === 'stop') {
  if (loaded) run(['bootout', target]);
  console.log('FSL stopped for this login. The service starts again at the next login.');
} else {
  await mkdir(resolve(root, '.tools'), { recursive: true });
  await mkdir(resolve(homedir(), 'Library/LaunchAgents'), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(resolve(root, 'scripts/serve-local.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${escape(resolve(root, '.tools/local-server.log'))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(root, '.tools/local-server.log'))}</string>
</dict></plist>\n`;
  await writeFile(destination, plist, { mode: 0o600 });
  if (!loaded) run(['bootstrap', domain, destination]);
  run(['kickstart', '-k', target]);
  console.log('Personal Mac login service installed and started: http://localhost:5173');
}
