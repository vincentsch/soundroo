#!/usr/bin/env node
// A stand-in for soundroo-cloud in toolkit tests. It speaks the same JSON
// contract, records every call in $STUB_DIR/calls.jsonl and answers from
// $STUB_DIR/behavior.json. It never touches the network.
const fs = require('fs');
const path = require('path');

const dir = process.env.STUB_DIR;
const argv = process.argv.slice(2);
const input = argv.includes('-') ? fs.readFileSync(0) : Buffer.alloc(0);
const behavior = JSON.parse(fs.readFileSync(path.join(dir, 'behavior.json'), 'utf8'));
const words = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--service') { i++; continue; }
  if (['--json', '--no-prompt'].includes(argv[i])) continue;
  words.push(argv[i]);
}
const command = words[0] === 'release' || words[0] === 'collection' || words[0] === 'auth' || words[0] === 'track' ? `${words[0]} ${words[1]}` : words[0];
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ argv, command, input: input.toString('utf8'), tokenEnv: Boolean(process.env.SOUNDROO_TOKEN) }) + '\n');
const counts = path.join(dir, 'counts.json');
const seen = fs.existsSync(counts) ? JSON.parse(fs.readFileSync(counts, 'utf8')) : {};
seen[command] = (seen[command] || 0) + 1;
fs.writeFileSync(counts, JSON.stringify(seen));
let answer = behavior[command];
if (Array.isArray(answer)) answer = answer[Math.min(seen[command], answer.length) - 1];
if (command === 'version') answer = answer || { name: 'soundroo-cloud', version: '0.1.0', protocol: 1, os: 'linux', arch: 'amd64' };
if (!answer) { process.stderr.write(JSON.stringify({ error: `stub has no answer for ${command}`, code: 'usage', exit_code: 1 })); process.exit(1); }
if (answer.fail) {
  process.stderr.write(JSON.stringify({ error: answer.fail.error, code: answer.fail.code, exit_code: answer.fail.exit, ...(answer.fail.issues ? { issues: answer.fail.issues } : {}) }, null, 2) + '\n');
  process.exit(answer.fail.exit);
}
if (answer.text) { process.stdout.write(answer.text); process.exit(0); }
process.stdout.write(JSON.stringify(answer, null, 2) + '\n');
