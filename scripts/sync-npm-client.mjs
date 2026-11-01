#!/usr/bin/env node
// The public standalone client is the only source; never hand-edit the npm bin.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = new URL('../public/botsesh-agent.mjs', import.meta.url);
const target = new URL('../packages/botsesh/bin/botsesh.mjs', import.meta.url);
try {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/sync-npm-client.mjs [--check]');
  const canonical = await readFile(source);
  if (process.argv.includes('--check')) {
    const packaged = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!packaged?.equals(canonical)) throw new Error('npm client drift: run node scripts/sync-npm-client.mjs and commit the generated bin.');
    console.error('npm client matches public/botsesh-agent.mjs byte for byte.');
  } else {
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await writeFile(target, canonical);
    await chmod(target, 0o755);
    console.error('Generated packages/botsesh/bin/botsesh.mjs from the public client.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
