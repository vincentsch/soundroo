// Runs soundroo-cloud without a shell and reads its JSON contract: results on
// stdout, {"error","code","exit_code",…} on stderr, rungrad exit codes.
import { spawn } from 'node:child_process';
import { CLOUD_PROTOCOL } from './binary.js';
import { ShareError } from './errors.js';

const MAX_OUTPUT = 32 * 1024 * 1024;

export function runCloud(file, args, { input, env = process.env, timeoutMs = 2 * 60_000, inherit = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, { env, shell: false, windowsHide: true, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new ShareError(`Could not start soundroo-cloud: ${error.message}`, { code: 'binary_failed', exitCode: 2 }));
      return;
    }
    const stdout = [], stderr = [];
    let size = 0, settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', abort); fn(value); } };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new ShareError('soundroo-cloud did not finish in time.', { code: 'timeout', exitCode: 2 }));
    }, timeoutMs);
    const abort = () => { child.kill(); finish(reject, new ShareError('Stopped.', { code: 'cancelled', exitCode: 2 })); };
    signal?.addEventListener?.('abort', abort, { once: true });
    const collect = list => chunk => {
      size += chunk.length;
      if (size > MAX_OUTPUT) { child.kill(); finish(reject, new ShareError('soundroo-cloud printed too much output.', { code: 'bad_output', exitCode: 2 })); return; }
      list.push(chunk);
    };
    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));
    child.on('error', error => finish(reject, new ShareError(`Could not start soundroo-cloud: ${error.message}`, { code: 'binary_failed', exitCode: 2 })));
    child.on('close', code => finish(resolve, { code: code ?? 2, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    }
  });
}

// The parsed JSON result, or a ShareError carrying the CLI's own error.
export function cloudResult({ code, stdout, stderr }) {
  if (code === 0) {
    try { return JSON.parse(stdout); } catch { throw new ShareError('soundroo-cloud returned output this toolkit cannot read.', { code: 'bad_output', exitCode: 2 }); }
  }
  let body = null;
  try { body = JSON.parse(stderr); } catch { /* not the JSON error contract */ }
  if (body && typeof body.error === 'string') {
    throw new ShareError(body.error, { code: body.code ?? 'error', exitCode: Number.isInteger(body.exit_code) ? body.exit_code : code, issues: body.issues, hint: body.hint, status: body.status, serviceCode: body.service_code });
  }
  const text = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500);
  throw new ShareError(text || `soundroo-cloud stopped with exit code ${code}.`, { code: 'binary_failed', exitCode: code >= 1 && code <= 6 ? code : 2 });
}

const checked = new Map();
// The binary must speak the JSON protocol this toolkit was written for.
export async function checkProtocol(file, options = {}) {
  if (checked.has(file)) return checked.get(file);
  const info = cloudResult(await runCloud(file, ['version', '--json'], { ...options, timeoutMs: 20_000 }));
  if (info?.name !== 'soundroo-cloud' || info.protocol !== CLOUD_PROTOCOL) {
    throw new ShareError(`${file} speaks soundroo-cloud protocol ${info?.protocol ?? 'unknown'}; this toolkit needs protocol ${CLOUD_PROTOCOL}.`, { code: 'protocol_mismatch', exitCode: 2 });
  }
  checked.set(file, info);
  return info;
}

// A bound runner: soundroo-cloud --service ORIGIN --json --no-prompt ARGS.
export function cloudCommand(file, origin, { env = process.env } = {}) {
  return async (args, { input, timeoutMs, signal } = {}) => cloudResult(await runCloud(file, ['--service', origin, '--json', '--no-prompt', ...args], { input, env, timeoutMs, signal }));
}
