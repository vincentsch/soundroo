#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { initLibrary, addTrack, getLibrary, trackInfo, readScore, readMix, renderTrack, libraryPath, readRequests, writeJson, VERSION } from '../src/project.js';
import { startServer } from '../src/server.js';
import { createSpeech, transformSpeech } from '../src/voice.js';

const args = process.argv.slice(2);
const command = args.shift() ?? 'start';
const options = {}, positional = [];
const boolean = new Set(['json', 'examples', 'all', 'replace', 'stems', 'help', 'version', 'no-render', 'dry-run', 'rights-accepted', 'no-wait', 'force', 'confirm', 'start', 'wait', 'local-only', 'refresh', 'no-guest', 'add']);
// Optional network sharing; its code loads only for these commands.
const network = new Set(['share', 'publish', 'login', 'logout', 'whoami', 'claim', 'claim-link', 'import', 'cloud']);
try {
// cloud passes its arguments to soundroo-cloud unchanged.
for (let i = 0; command !== 'cloud' && i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const [key, inline] = arg.slice(2).split('=', 2);
    if (boolean.has(key)) options[key] = inline == null ? true : inline === 'true';
    else { const value = inline ?? args[++i]; if (value == null || value.startsWith('--')) throw new Error(`--${key} needs a value.`); options[key] = value; }
  } else positional.push(arg);
}
} catch (error) {
  process.stderr.write('Soundroo: ' + error.message + '\n');
  process.exit(1);
}
const log = message => process.stderr.write(message + '\n');
const print = value => process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value, null, 2) + '\n');
const directory = libraryPath(options.library ?? (['init', 'start', 'demo', 'list'].includes(command) ? positional[0] : undefined));
const number = (key, fallback) => options[key] == null ? fallback : Number(options[key]);
const exampleSeed = () => number('seed', (options.collection ?? 'variety') === 'variety' ? 21 : 1);
function help() {
  print(`Soundroo ${VERSION} — music made with your coding agent\n\nUse Node 22 or newer. No installation is needed: the recorded instruments download once, the first time a track uses them.\n\n  node bin/soundroo.js start [library]       Open the local listening studio; first start loads ten examples\n  node bin/soundroo.js init [library]        Create an empty personal collection\n  node bin/soundroo.js demo [library]        Create and render the original example collection\n  node bin/soundroo.js add score.json        Add an editable composition (--replace revises it)\n  node bin/soundroo.js validate score.json   Check a composition before rendering\n  node bin/soundroo.js render [track-id]     Render a track, or --all; --stems exports its parts; --sound synthesized\n  node bin/soundroo.js inspect [track-id]    Inspect saved music and audio reports\n  node bin/soundroo.js list [library]        List the collection\n  node bin/soundroo.js catalog               Discover instruments and tone controls\n  node bin/soundroo.js example [id]          List the example tracks by genre, or print one to learn from\n  node bin/soundroo.js requests              Read pending musical briefs from the studio\n  node bin/soundroo.js import-midi piece.mid  Turn a MIDI file into a score (--add puts it in the library)
  node bin/soundroo.js samples [--all]       The recorded instruments: status, or download them now
  node bin/soundroo.js doctor                Check the local runtime\n  node bin/soundroo.js version               Show the toolkit version and engine hash\n  node bin/soundroo.js voice create "words" --out library/assets/voice.wav\n  node bin/soundroo.js voice process voice.wav --effect vocoder --out processed.wav\n\nOptional sharing on soundroo.com (apart from that one download, only these commands use the network; see docs/sharing.md):\n  node bin/soundroo.js share --dry-run       Preview what would be uploaded; nothing is sent or saved\n  node bin/soundroo.js share --rights-accepted   Publish the library and print its links\n  node bin/soundroo.js share status          Show this library's shared links\n  node bin/soundroo.js import LINK           Add an open track to the library as a remix\n  node bin/soundroo.js claim --email ADDRESS Email a link that keeps your guest artist page\n  node bin/soundroo.js login | logout | whoami | claim-link\n\nOptions: --library PATH, --json, --port NUMBER, --seed NUMBER, --title TEXT, --collection variety|open-window, --service URL.\nSpeech creation is optional and needs Kokoro; speech effects and bundled voice examples work with Node alone.\nThe studio creates no hidden model calls. Your existing coding agent composes and revises the music.`);
}

try {
  if (options.help || command === 'help' || command === '--help') { help(); }
  else if (options.version || command === '--version' || command === 'version') { const { engineInfo } = await import('../src/headless.js'); const engine = engineInfo(); print({ version: VERSION, engineHash: engine.hash, scoreVersions: engine.scoreVersions }); }
  else if (command === 'doctor') {
    const major = Number(process.versions.node.split('.')[0]);
    const checks = [{ name: 'Node 22+', ok: major >= 22, version: process.version }, { name: 'Studio files', ok: fs.existsSync(new URL('../web/index.html', import.meta.url)) }, { name: 'Score renderer', ok: fs.existsSync(new URL('../src/render.js', import.meta.url)) }];
    const { samples } = await import('../src/headless.js');
    const packs = samples();
    print({ ready: checks.every(c => c.ok), checks, requiredMusicTools: [], recordedInstruments: { installed: packs.filter(p => p.installed).map(p => p.name), missing: packs.filter(p => !p.installed).map(p => p.name), note: 'Missing recordings download by themselves the first time a track needs them (node bin/soundroo.js samples --all gets them all).' }, optionalSpeech: 'Install Kokoro only for creating new spoken phrases.' });
    if (checks.some(c => !c.ok)) process.exitCode = 1;
  } else if (command === 'samples') {
    // The recorded instruments: their status, or download them (all, or the named packs).
    const { samples, installSamples } = await import('../src/headless.js');
    const names = positional.length ? positional : options.all ? undefined : null;
    const packs = names === null ? samples() : await installSamples(names, { log });
    print(options.json ? { packs } : packs.map(p => `${p.installed ? 'installed' : 'missing  '}  ${p.name.padEnd(14)} ${(p.size / 1e6).toFixed(0).padStart(5)} MB  ${p.instruments.join(', ')}`).join('\n') + (names === null && packs.some(p => !p.installed) ? '\n\nThey download by themselves the first time a track needs them. To get them all now: node bin/soundroo.js samples --all' : ''));
  } else if (command === 'init') {
    const collection = await initLibrary(directory, { examples: Boolean(options.examples), exampleSet: options.collection ?? 'variety', seed: exampleSeed(), title: options.title ?? 'Your music', description: options.description ?? '' });
    print({ directory, collection });
  } else if (command === 'start' || command === 'demo') {
    await initLibrary(directory, { examples: true, exampleSet: options.collection ?? 'variety', seed: exampleSeed() });
    if (command === 'demo') {
      const results = [];
      for (const track of getLibrary(directory).tracks) { log(`Rendering ${track.title}`); const result = await renderTrack(directory, track.id, { stems: Boolean(options.stems) }); results.push({ id: track.id, duration: result.duration, revision: result.revision }); }
      print({ directory, tracks: results });
    } else {
      const port = number('port', 4317); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535.');
      let studio;
      try { studio = await startServer(directory, { port, renderMissing: !options['no-render'], log, service: options.service }); }
      catch (error) {
        if (error.code !== 'EADDRINUSE' || options.port != null) throw error;
        log('The usual studio port is busy; opening another local address.');
        studio = await startServer(directory, { port: 0, renderMissing: !options['no-render'], log, service: options.service });
      }
      print(options.json ? { url: studio.url, directory, tracks: getLibrary(directory).tracks.length } : `Soundroo is listening at ${studio.url}\nMusic library: ${directory}\nOpen the link in your browser. Press Ctrl+C to close the studio.`);
      const close = async () => { await studio.close(); process.exit(0); };
      process.once('SIGINT', close); process.once('SIGTERM', close);
    }
  } else if (command === 'add') {
    if (!positional[0]) throw new Error('Choose a JSON score file to add.');
    print({ id: await addTrack(directory, positional[0], { replace: Boolean(options.replace) }), directory });
  } else if (command === 'import-midi') {
    // A MIDI file as an editable version 3 score; --add puts it in the library too.
    if (!positional[0]) throw new Error('Choose a .mid file to import.');
    const { midiToScore } = await import('../src/audio/midi-import.js');
    const { validateScore } = await import('../src/score.js');
    const { score, skipped } = midiToScore(fs.readFileSync(positional[0]), { title: options.title, id: options.id ?? path.basename(positional[0]).replace(/\.midi?$/i, '') });
    const { valid, issues } = validateScore(score);
    if (!valid) throw new Error(`The imported score is not valid: ${issues.slice(0, 5).map(i => `${i.path}: ${i.message}`).join('; ')}`);
    const out = options.out ?? path.join(path.dirname(positional[0]), `${score.id}.json`);
    fs.writeFileSync(out, JSON.stringify(score, null, 2) + '\n');
    const added = options.add ? await addTrack(directory, out, { replace: Boolean(options.replace) }) : null;
    print({ file: out, id: score.id, parts: score.parts.map(p => ({ id: p.id, instrument: p.instrument, notes: p.notes.length, pedal: p.pedal?.length ?? 0 })), tempoChanges: score.tempo?.length ?? 0, skippedDrumNotes: skipped, ...(added ? { added, directory } : {}) });
  } else if (command === 'validate') {
    if (!positional[0]) throw new Error('Choose a JSON score file to validate.');
    const { validateScore } = await import('../src/score.js'); const result = validateScore(JSON.parse(fs.readFileSync(positional[0], 'utf8'))); print(result); if (!result.valid) process.exitCode = 2;
  } else if (command === 'render') {
    const tracks = options.all ? getLibrary(directory).tracks.map(t => t.id) : [positional[0]];
    if (!tracks[0]) throw new Error('Choose a track or use --all.');
    const results = [];
    for (const id of tracks) { log(`Rendering ${id}`); const result = await renderTrack(directory, id, { stems: Boolean(options.stems), sampleRate: number('sample-rate', 44100), sound: options.sound ?? 'recorded', log }); results.push({ id, revision: result.revision, duration: result.duration, file: result.file, report: { peakDb: result.report.peakDb, rmsDb: result.report.rmsDb, limitedFraction: result.report.limitedFraction, warnings: result.report.warnings } }); }
    print({ directory, tracks: results });
  } else if (command === 'inspect') {
    print(positional[0] ? trackInfo(directory, positional[0], { detail: true }) : getLibrary(directory));
  } else if (command === 'list') print(getLibrary(directory));
  else if (command === 'catalog') { const { getCatalog } = await import('../src/catalog.js'); print(getCatalog()); }
  else if (command === 'example') {
    // Working scores to learn from: the default Turn It Up tracks plus the single JSON examples.
    const { buildVarietyCollection } = await import('../examples/variety.js');
    const scores = [...buildVarietyCollection().tracks];
    for (const name of fs.readdirSync(new URL('../examples/', import.meta.url)).filter(file => file.endsWith('.json')).sort()) scores.push(JSON.parse(fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8')));
    if (!positional[0]) print({ examples: scores.map(score => ({ id: score.id, title: score.title, genre: score.genre, bpm: score.bpm })) });
    else {
      const score = scores.find(item => item.id === positional[0]);
      if (!score) throw new Error(`No example called ${positional[0]}. Run "node bin/soundroo.js example" to list them.`);
      print(score);
    }
  }
  else if (command === 'requests') print({ requests: readRequests(directory) });
  else if (command === 'voice') {
    const action = positional[0], source = positional.slice(1).join(' ');
    if (!options.out) throw new Error('Choose an output WAV with --out.');
    if (action === 'create') print(await createSpeech(source, path.resolve(options.out), { voice: options.voice ?? 'af_heart', dtype: options.dtype ?? 'q8', cacheDir: options.cache, log }));
    else if (action === 'process') print(transformSpeech(source, path.resolve(options.out), { effect: options.effect ?? 'dry', semitones: number('semitones', 0), pitch: number('pitch', 57), stretch: number('stretch', 1), bpm: number('bpm', 120) }));
    else throw new Error('Use voice create or voice process.');
  } else if (network.has(command)) {
    const { runNetworkCommand } = await import('../src/cloud/cli.js');
    process.exitCode = await runNetworkCommand(command, { positional, options, raw: args, print, log });
  } else throw new Error(`Unknown command: ${command}. Run --help for the available commands.`);
} catch (error) {
  if (options.json) print({ error: error.message }); else log('Soundroo: ' + error.message);
  process.exitCode = 1;
}
