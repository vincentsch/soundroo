import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { score, tempDir } from './fixtures/sharing.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, 'bin', 'soundroo.js');
// --import takes a URL; a bare Windows path would not load.
const preload = pathToFileURL(path.join(root, 'test', 'fixtures', 'no-network.mjs')).href;

function isolatedEnv(home) {
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData'), LOCALAPPDATA: path.join(home, 'AppData'), SOUNDROO_CACHE: path.join(home, '.cache', 'soundroo'), SystemRoot: process.env.SystemRoot };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

test('composing, rendering, the studio and share previews never touch the network or sharing config', async () => {
  const home = tempDir('soundroo-home-');
  const work = tempDir('soundroo-work-');
  const library = path.join(work, 'library', 'my-music');
  const file = path.join(work, 'groove.json');
  fs.writeFileSync(file, JSON.stringify(score('groove', { title: 'Groove' })));
  const env = isolatedEnv(home);
  const run = (...args) => spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: work, env, encoding: 'utf8', timeout: 120_000 });
  const steps = [
    ['doctor'],
    ['init', library, '--title', 'Offline test'],
    ['add', file, '--library', library],
    ['validate', file, '--json'],
    ['render', 'groove', '--library', library, '--json'],
    ['list', library],
    ['share', '--library', library, '--dry-run', '--json'],
    ['share', 'status', '--library', library, '--json'],
    ['share', 'status', '--library', library, '--refresh', '--dry-run', '--json'],
    ['import', 'https://soundroo.com/t/01JTRACK000000000000000009', '--library', library, '--dry-run', '--json'],
    ['whoami', '--dry-run', '--json'],
    ['login', '--dry-run', '--json'],
    ['logout', '--dry-run', '--json'],
  ];
  for (const step of steps) {
    const result = run(...step);
    assert.equal(result.status, 0, `${step.join(' ')}: ${result.stderr}${result.stdout}`);
    assert.ok(!result.stderr.includes('NETWORK ATTEMPT'), `${step.join(' ')} used the network`);
  }
  const preview = JSON.parse(run('share', '--library', library, '--dry-run', '--json').stdout);
  assert.equal(preview.changes, 'none');
  assert.deepEqual(preview.tracks.map(t => t.localId), ['groove']);
  // Real sharing without the rights confirmation stops before any network.
  const refused = run('share', '--library', library, '--json');
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).code, 'rights_not_accepted');
  assert.ok(!refused.stderr.includes('NETWORK ATTEMPT'));
  assert.ok(!fs.existsSync(path.join(library, 'sharing.json')), 'a preview created sharing state');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(library, 'collection.json'), 'utf8')).tracks, ['groove'], 'an import preview added a track');
  assert.ok(!fs.existsSync(path.join(home, '.config', 'soundroo-cloud')), 'sharing configuration was written');
  assert.ok(!fs.existsSync(path.join(home, '.cache', 'soundroo', 'cloud')), 'soundroo-cloud was downloaded');

  // The studio starts, serves the library and opens the Share dialog offline.
  const studio = spawn(process.execPath, ['--import', preload, cli, 'start', library, '--port', '0', '--json', '--no-render'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  studio.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      studio.stdout.on('data', chunk => { out += chunk; try { resolve(JSON.parse(out).url); } catch { /* wait for the whole object */ } });
      studio.on('exit', code => reject(new Error(`studio exited ${code}: ${stderr}`)));
    });
    const share = await (await fetch(url + '/api/share')).json();
    assert.equal(share.available, true);
    const details = await (await fetch(url + '/api/share/account', { headers: { 'x-soundroo-share': share.token } })).json();
    assert.deepEqual(details.tracks.map(t => [t.localId, t.status]), [['groove', 'ready']]);
    assert.equal(details.tool, 'not-installed');
    assert.equal((await fetch(url + '/api/library')).status, 200);
    assert.ok(!stderr.includes('NETWORK ATTEMPT'), stderr);
  } finally {
    studio.kill();
  }
  assert.ok(!fs.existsSync(path.join(home, '.config', 'soundroo-cloud')));
});
