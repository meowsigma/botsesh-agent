#!/usr/bin/env node
// Export only reviewed public artifacts, never application directories/history.
import { readFile, writeFile, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'public/botsesh-agent.mjs',
  'packages/botsesh/package.json', 'packages/botsesh/README.md', 'packages/botsesh/LICENSE', 'packages/botsesh/bin/botsesh.mjs',
  'skills/botsesh/SKILL.md', 'skills/botsesh/README.md',
  'scripts/sync-npm-client.mjs', 'scripts/export-public-client.mjs', 'tests/npm-client.test.mjs',
  'docs/client-distribution.md', 'docs/package-managers.md', 'docs/mcp/server.json.template',
];
let created = false;
let out;
async function safeRead(path) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in public allowlist: ${path}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Allowlisted input is not a regular file: ${path}`);
  return readFile(current);
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) throw new Error('Usage: node scripts/export-public-client.mjs --out ABSOLUTE_NEW_DIRECTORY');
  // Resolve the existing parent to block symlink aliases into the private tree.
  out = join(await realpath(dirname(resolve(args[1]))), resolve(args[1]).split(sep).at(-1));
  const actualRoot = await realpath(root);
  const rel = relative(actualRoot, out);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('Public export must be outside the source repository.');
  // Also forbid an ancestor: an existing root/parent can never be a new export.
  const data = new Map();
  for (const path of files) data.set(path, await safeRead(path));
  if (!data.get('public/botsesh-agent.mjs').equals(data.get('packages/botsesh/bin/botsesh.mjs'))) throw new Error('npm client drift: run scripts/sync-npm-client.mjs before export.');
  // Application stores the inert workflow outside .github; exported mirror owns it.
  let workflow = 'distribution/publish-client.yml';
  try { await lstat(join(root, workflow)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; workflow = '.github/workflows/publish-client.yml'; }
  data.set('.github/workflows/publish-client.yml', await safeRead(workflow));
  data.set('LICENSE', data.get('packages/botsesh/LICENSE'));
  data.set('README.md', data.get('packages/botsesh/README.md'));
  const manifest = JSON.parse(data.get('packages/botsesh/package.json'));
  data.set('package.json', Buffer.from(`${JSON.stringify({
    name: 'botsesh-public-client-source', version: manifest.version, private: true,
    type: 'module', engines: { node: '>=24' }, license: 'MIT',
    scripts: { test: 'node --test --test-concurrency=2 tests/npm-client.test.mjs', 'build:client': 'node scripts/sync-npm-client.mjs', 'check:client': 'node scripts/sync-npm-client.mjs --check' },
  }, null, 2)}\n`));
  // Non-recursive mkdir rejects an existing destination, including a symlink.
  await mkdir(out, { mode: 0o755 });
  created = true;
  const checksums = [];
  for (const [path, bytes] of [...data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), bytes, { flag: 'wx', mode: path.endsWith('.mjs') && !path.startsWith('tests/') ? 0o755 : 0o644 });
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${path}`);
  }
  await writeFile(join(out, 'SHA256SUMS'), `${checksums.join('\n')}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ directory: out, files: data.size + 1, checksumFile: 'SHA256SUMS' }));
} catch (error) {
  if (created) await rm(out, { recursive: true, force: true });
  console.error(`Public export failed: ${error.message}`);
  process.exitCode = 1;
}
