import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = join(root, 'packages/botsesh');
const run = (args, cwd = root) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 30000 });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'botsesh-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// npm <12 returns an array; npm 12 keys the same records by package name.
// Keep this helper here so the exported standalone test needs no private files.
function parseNpmPack(stdout, expectedName) {
  const parsed = JSON.parse(stdout);
  assert.ok(parsed && typeof parsed === 'object', 'npm pack JSON must be an array or keyed object');
  if (!Array.isArray(parsed)) {
    assert.deepEqual(Object.keys(parsed), [expectedName], 'npm pack must key exactly the expected package');
  }
  const records = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert.equal(records.length, 1, 'npm pack must return exactly one package');
  const [pack] = records;
  assert.ok(pack && typeof pack === 'object' && !Array.isArray(pack), 'npm pack record must be an object');
  assert.equal(pack.name, expectedName, 'npm pack must return the expected package');
  assert.equal(typeof pack.filename, 'string', 'npm pack filename must be a string');
  assert.ok(pack.filename.startsWith(`${expectedName}-`) && pack.filename.endsWith('.tgz') && !/[/\\]/.test(pack.filename), 'npm pack filename must be a local package tarball');
  assert.ok(Array.isArray(pack.files) && pack.files.length > 0, 'npm pack files must be a nonempty array');
  for (const file of pack.files) {
    assert.ok(file && typeof file === 'object' && !Array.isArray(file), 'npm pack file must be an object');
    assert.ok(typeof file.path === 'string' && file.path.length > 0, 'npm pack file path must be a nonempty string');
  }
  assert.equal(new Set(pack.files.map(file => file.path)).size, pack.files.length, 'npm pack file paths must be unique');
  return pack;
}

function packFixture() {
  return {
    name: 'botsesh', version: '1.1.1', filename: 'botsesh-1.1.1.tgz',
    files: ['LICENSE', 'README.md', 'bin/botsesh.mjs', 'package.json'].map(path => ({ path })),
  };
}

for (const shape of ['legacy array', 'npm12 keyed object']) {
  test(`npm pack parser accepts the ${shape} without changing package metadata`, () => {
    const pack = packFixture();
    const input = shape === 'legacy array' ? [pack] : { botsesh: pack };
    assert.deepEqual(parseNpmPack(JSON.stringify(input), 'botsesh'), pack);
  });
}

test('npm pack parser rejects malformed and ambiguous envelopes', () => {
  assert.throws(() => parseNpmPack('{', 'botsesh'), SyntaxError);
  const pack = packFixture();
  for (const input of [null, true, 1, 'botsesh', [], {}, [pack, pack],
    { botsesh: pack, other: pack }, { other: pack }, pack,
    [null], [[]], ['botsesh'], { botsesh: null }, { botsesh: [] }]) {
    assert.throws(() => parseNpmPack(JSON.stringify(input), 'botsesh'), { code: 'ERR_ASSERTION' }, JSON.stringify(input));
  }
});

test('npm pack parser rejects malformed package records in both supported envelopes', () => {
  const pack = packFixture();
  for (const change of [
    { name: 'other' }, { name: undefined }, { filename: undefined }, { filename: 1 },
    { filename: '' }, { filename: 'other-1.1.1.tgz' }, { filename: '../botsesh-1.1.1.tgz' },
    { filename: 'botsesh-../outside.tgz' }, { filename: 'botsesh-..\\outside.tgz' }, { filename: 'botsesh-1.1.1.zip' },
    { files: undefined }, { files: null }, { files: {} }, { files: [] }, { files: [null] },
    { files: [[]] }, { files: ['LICENSE'] }, { files: [{}] }, { files: [{ path: '' }] },
    { files: [{ path: 1 }] }, { files: [{ path: 'LICENSE' }, { path: 'LICENSE' }] },
  ]) {
    const malformed = { ...pack, ...change };
    for (const input of [[malformed], { botsesh: malformed }]) {
      assert.throws(() => parseNpmPack(JSON.stringify(input), 'botsesh'), { code: 'ERR_ASSERTION' }, JSON.stringify(input));
    }
  }
});

test('npm executable is byte-identical to the canonical client; check rejects drift', async t => {
  assert.deepEqual(await readFile(join(pkg, 'bin/botsesh.mjs')), await readFile(join(root, 'public/botsesh-agent.mjs')));
  assert.equal(run(['scripts/sync-npm-client.mjs', '--check']).status, 0);
  const dir = await fixture(t);
  for (const path of ['public/botsesh-agent.mjs', 'packages/botsesh', 'scripts/sync-npm-client.mjs']) {
    await cp(join(root, path), join(dir, path), { recursive: true });
  }
  await writeFile(join(dir, 'packages/botsesh/bin/botsesh.mjs'), '// stale client\n');
  const result = run(['scripts/sync-npm-client.mjs', '--check'], dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /drift/i);
  assert.equal(run(['scripts/sync-npm-client.mjs'], dir).status, 0);
  assert.equal(run(['scripts/sync-npm-client.mjs', '--check'], dir).status, 0);
});

test('npm pack dry run whitelists only the zero-dependency client and public documentation', async () => {
  const manifest = JSON.parse(await readFile(join(pkg, 'package.json')));
  assert.equal(manifest.name, 'botsesh');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.engines.node, '>=24');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.bin.botsesh, 'bin/botsesh.mjs');
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.deepEqual(manifest[key] || {}, {});
  for (const hook of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[hook], undefined);
  assert.match(manifest.repository.url, /github\.com\/meowsigma\/botsesh-agent\.git$/);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json'], { cwd: pkg, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stderr);
  const pack = parseNpmPack(result.stdout, manifest.name);
  // Exercise both envelopes with the real pack metadata on every npm version.
  for (const envelope of [[pack], { [manifest.name]: pack }]) {
    assert.deepEqual(parseNpmPack(JSON.stringify(envelope), manifest.name), pack);
  }
  assert.deepEqual(pack.files.map(f => f.path).sort(), ['LICENSE', 'README.md', 'bin/botsesh.mjs', 'package.json']);
  assert.equal(pack.name, manifest.name);
  const resultHelp = run(['bin/botsesh.mjs', 'help'], pkg);
  assert.equal(resultHelp.status, 0, resultHelp.stderr);
  assert.match(resultHelp.stdout, /catchup.*→.*send or ack/);
  assert.equal(run(['bin/botsesh.mjs', '--version'], pkg).status, 0);
});

test('installed npm bin runs help through the real npm executable shim', async t => {
  const dir = await fixture(t);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const options = { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' };
  const packed = spawnSync(npm, ['pack', '--pack-destination', dir, '--json'], { ...options, cwd: pkg });
  assert.equal(packed.status, 0, packed.stderr);
  const info = parseNpmPack(packed.stdout, 'botsesh');
  const installed = spawnSync(npm, ['install', '--global', '--prefix', join(dir, 'prefix'), '--ignore-scripts', '--no-audit', '--no-fund', join(dir, info.filename)], { ...options, cwd: dir });
  assert.equal(installed.status, 0, installed.stderr);
  const bin = process.platform === 'win32' ? join(dir, 'prefix/botsesh.cmd') : join(dir, 'prefix/bin/botsesh');
  const help = spawnSync(bin, ['help'], { ...options, cwd: dir });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /BotSesh durable agent client/);
  const version = spawnSync(bin, ['--version'], { ...options, cwd: dir });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /BotSesh agent .*sha256:/);
});

test('portable skill has valid Agent Skills frontmatter and accurate CLI/read/schedule guidance', async () => {
  const text = await readFile(join(root, 'skills/botsesh/SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(text);
  assert.ok(match, 'frontmatter must start at byte zero and have a body');
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const field = /^([a-z-]+): (.+)$/.exec(line);
    assert.ok(field, 'portable frontmatter uses flat YAML scalars');
    return [field[1], JSON.parse(field[2])];
  }));
  assert.equal(fields.name, 'botsesh');
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.ok(fields.description.length > 0 && fields.description.length <= 60);
  assert.match(fields.description, /^Use when /);
  assert.match(text, /catchup is not read/i);
  assert.match(text, /send.*ack/);
  assert.match(text, /existing install/i);
  assert.match(text, /check --store/);
  assert.match(text, /--wake poll --interval 5/);
  assert.match(text, /--through-number/);
  assert.doesNotMatch(text, /curl[^\n]*\|\s*(?:sh|bash)/);
  for (const command of ['catchup', 'send', 'ack', 'check', 'status', 'connect']) {
    const result = run(['bin/botsesh.mjs', command, '--help'], pkg);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  }
});

test('public export uses an exact allowlist, checksums every file, and is independently testable', async t => {
  const dir = await fixture(t);
  const out = join(dir, 'mirror');
  const result = run(['scripts/export-public-client.mjs', '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const { readdir } = await import('node:fs/promises');
  async function walk(path, prefix = '') {
    const files = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) files.push(...await walk(join(path, entry.name), `${name}/`));
      else files.push(name);
    }
    return files.sort();
  }
  const files = await walk(out);
  const sums = (await readFile(join(out, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  const checksummed = [];
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match);
    checksummed.push(match[2]);
    assert.equal(createHash('sha256').update(await readFile(join(out, match[2]))).digest('hex'), match[1]);
  }
  assert.deepEqual(checksummed.sort(), files.filter(f => f !== 'SHA256SUMS'));
  assert.deepEqual(files, [
    '.github/workflows/publish-client.yml', 'LICENSE', 'README.md', 'SHA256SUMS',
    'docs/client-distribution.md', 'docs/mcp/server.json.template', 'docs/package-managers.md',
    'package.json', 'packages/botsesh/LICENSE', 'packages/botsesh/README.md',
    'packages/botsesh/bin/botsesh.mjs', 'packages/botsesh/package.json',
    'public/botsesh-agent.mjs', 'scripts/export-public-client.mjs', 'scripts/sync-npm-client.mjs',
    'skills/botsesh/README.md', 'skills/botsesh/SKILL.md', 'tests/npm-client.test.mjs',
  ].sort());
  assert.equal(run(['scripts/sync-npm-client.mjs', '--check'], out).status, 0);
  assert.deepEqual(await readFile(join(out, 'LICENSE')), await readFile(join(pkg, 'LICENSE')));
  assert.notEqual(run(['scripts/export-public-client.mjs', '--out', out]).status, 0, 'must never overwrite a prior export');
  assert.notEqual(run(['scripts/export-public-client.mjs', '--out', join(root, 'export-unsafe')]).status, 0, 'must not export into private source tree');
  // Unlisted files stay private even when exporting from an existing mirror.
  await writeFile(join(out, '.env'), 'TEST_ONLY_PRIVATE_SENTINEL');
  await writeFile(join(out, 'server.js'), 'TEST_ONLY_SERVER_SENTINEL');
  const second = join(dir, 'second-mirror');
  assert.equal(run(['scripts/export-public-client.mjs', '--out', second], out).status, 0);
  assert.deepEqual(await walk(second), files);
  await writeFile(join(out, 'packages/botsesh/bin/botsesh.mjs'), '// drift');
  const drift = run(['scripts/export-public-client.mjs', '--out', join(dir, 'drift-export')], out);
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /drift/);
  if (process.platform !== 'win32') {
    const { symlink } = await import('node:fs/promises');
    await rm(join(out, 'public/botsesh-agent.mjs'));
    await symlink(join(pkg, 'bin/botsesh.mjs'), join(out, 'public/botsesh-agent.mjs'));
    const linked = run(['scripts/export-public-client.mjs', '--out', join(dir, 'linked-export')], out);
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /symlink/);
  }
});
