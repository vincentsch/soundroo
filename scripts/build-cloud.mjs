// Builds soundroo-cloud, the optional sharing CLI in cloud-cli/, for every
// platform the toolkit downloads, and writes the manifest the toolkit reads
// from <service>/downloads/cli/manifest.json. Output goes to cloud-cli/dist/,
// which is not tracked. Publish its contents under /downloads/cli/ on the
// service.
//
//   node scripts/build-cloud.mjs            build all platforms
//   node scripts/build-cloud.mjs --verify   build twice and require identical bytes
//   node scripts/build-cloud.mjs --targets linux/amd64,darwin/arm64 --out /tmp/cloud
//
// Needs Go 1.22.2 or newer. Builds are reproducible for one Go version: no
// cgo, no file paths, no VCS stamp and an empty build id.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'cloud-cli');
const TARGETS = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64', 'windows/arm64'];

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const out = path.resolve(option('out') ?? path.join(source, 'dist'));
const targets = (option('targets') ?? TARGETS.join(',')).split(',').map(t => t.trim()).filter(Boolean);
const verify = args.includes('--verify');
for (const target of targets) if (!TARGETS.includes(target)) throw new Error(`Unknown target ${target}. Use ${TARGETS.join(', ')}.`);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed:\n${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

const goVersion = run('go', ['env', 'GOVERSION']);
const app = fs.readFileSync(path.join(source, 'internal', 'commands', 'app.go'), 'utf8');
const version = /var Version = "(\d+\.\d+\.\d+)"/.exec(app)?.[1];
const protocol = Number(/const Protocol = (\d+)/.exec(app)?.[1]);
if (!version || !protocol) throw new Error('Could not read Version and Protocol from cloud-cli/internal/commands/app.go.');

const fileName = target => {
  const [goos, goarch] = target.split('/');
  return `soundroo-cloud_${version}_${goos}_${goarch}${goos === 'windows' ? '.exe' : ''}`;
};

function build(target, dir) {
  const [goos, goarch] = target.split('/');
  const file = path.join(dir, fileName(target));
  const env = { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch, GOFLAGS: '-mod=readonly', GOTOOLCHAIN: 'local' };
  delete env.GOEXPERIMENT;
  if (goarch === 'amd64') env.GOAMD64 = 'v1';
  run('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w -buildid=', '-o', file, '.'], { cwd: source, env });
  const bytes = fs.readFileSync(file);
  return { file, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const release = path.join(out, version);
fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(release, { recursive: true });
const platforms = {};
for (const target of targets) {
  const built = build(target, release);
  if (verify) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-cloud-verify-'));
    try {
      const again = build(target, scratch);
      if (again.sha256 !== built.sha256) throw new Error(`${target} is not reproducible: ${built.sha256} then ${again.sha256}.`);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  platforms[target.replace('/', '-')] = { url: `${version}/${path.basename(built.file)}`, sha256: built.sha256, size: built.size };
  console.log(`${target.padEnd(14)} ${built.sha256}  ${(built.size / 1e6).toFixed(1)} MB`);
}

// The host build must report the version and protocol the manifest claims.
const hostKey = `${{ win32: 'windows' }[process.platform] ?? process.platform}-${{ x64: 'amd64' }[process.arch] ?? process.arch}`;
if (platforms[hostKey]) {
  const info = JSON.parse(run(path.join(out, platforms[hostKey].url), ['version', '--json']));
  if (info.version !== version || info.protocol !== protocol) throw new Error(`The built binary reports ${info.version}/protocol ${info.protocol}.`);
}

const manifest = { name: 'soundroo-cloud', version, protocol, platforms };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(release, 'SHA256SUMS'), Object.values(platforms).map(p => `${p.sha256}  ${path.basename(p.url)}`).join('\n') + '\n');
console.log(`\nsoundroo-cloud ${version} (protocol ${protocol}) built with ${goVersion}${verify ? ', reproducible' : ''}.`);
console.log(`Manifest: ${path.join(out, 'manifest.json')}`);
console.log(`Publish ${out}/manifest.json as /downloads/cli/manifest.json and ${release}/ as /downloads/cli/${version}/ on the service.`);
