// One track: the listening header and waveform first, deeper tools in tabs.
import { api, DOWNLOADS, downloadUrl } from '../api.js';
import { data, trackLabel, trackById, activeJob, failedJob, emit, on } from '../store.js';
import { h, icon, artwork, nodes, toast, errorMessage, preserveFocus, copyText } from '../dom.js';
import {
  formatTime, formatDate, formatDb, formatPan, normalizeFeedback, normalizeMix, sameMix, audibleParts,
  arrangementLanes, trackFacts, instrumentName, VOLUME_MAX, clamp,
} from '../logic.js';
import { playButton, favButton, moreButton, statusBadge } from '../actions.js';
import { addJob, refreshJobsSoon, requestRender } from '../jobs.js';
import { openNoteDialog } from '../dialogs.js';
import { momentMap } from '../wave.js';
import * as player from '../player.js';

const TABS = [
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'mix', label: 'Mix', icon: 'sliders' },
  { id: 'arrangement', label: 'Arrangement', icon: 'layers' },
  { id: 'versions', label: 'Versions', icon: 'history' },
  { id: 'export', label: 'Export', icon: 'download' },
];

// Unsaved mixer settings survive leaving the page, per track revision.
const mixDrafts = new Map();

export function trackView({ id, tab }) {
  let track = trackById(id);
  let detail = null;
  let detailError = null;
  let activeTab = TABS.some(t => t.id === tab) ? tab : 'notes';
  let main = null;
  let panelEl = null;
  let statusEl = null;
  let moment = null;
  let arrangement = null;
  let mix = null;
  let mixUi = null;
  let saving = false;
  let ticket = 0;
  let destroyed = false;
  const offs = [];
  const draftKey = () => `${track?.id}@${track?.revision ?? ''}`;
  const notePosition = () => (player.isCurrent(track.id) ? player.currentTime() : 0);

  const restored = track ? mixDrafts.get(draftKey()) : null;
  if (restored) mix = restored;

  function render(container) {
    main = container;
    paint();
    loadDetail();
    offs.push(on('time', () => arrangement?.update()));
  }

  function paint() {
    moment?.destroy();
    arrangement?.destroy();
    moment = null;
    arrangement = null;
    main.replaceChildren();
    if (!track) {
      main.append(notFound());
      return;
    }
    moment = momentMap(track, { onMarker: note => focusNote(note.id) });
    moment.setNotes(detail?.feedback ?? []);
    panelEl = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'track-panel', tabindex: '-1', 'aria-labelledby': `tab-${activeTab}` });
    main.append(
      h('a', { class: 'back-link', href: '#/' }, icon('chevron-left'), data.collection?.title ?? 'Listen'),
      header(),
      h('section', { class: 'moment-wrap', 'aria-label': 'Waveform, sections and notes' }, moment.el),
      tabs(),
      panelEl);
    renderPanel();
  }

  // --- header -------------------------------------------------------------------

  function header() {
    const facts = trackFacts(track);
    if (track.duration) facts.push(formatTime(track.duration));
    const play = playButton(track, {
      className: 'btn btn-primary',
      content: [icon('play', 'when-paused'), icon('pause', 'when-playing'), h('span', { class: 'when-paused' }, 'Play'), h('span', { class: 'when-playing' }, 'Pause')],
    });
    play.dataset.key = 'track-play';
    play.disabled = !track.rendered;
    statusEl = h('div', { class: 'track-status' });
    fillStatus();
    return h('header', { class: 'track-hero' },
      artwork(track, { className: 'track-art', eager: true }),
      h('div', { class: 'track-hero-text' },
        h('p', { class: 'eyebrow' }, `${trackLabel(track)} · Track ${track.index + 1} of ${data.tracks.length}`),
        h('h1', { class: 'track-title', tabindex: '-1', dataset: { pageTitle: '' } }, track.title),
        track.description ? h('p', { class: 'track-desc' }, track.description) : null,
        facts.length ? h('ul', { class: 'facts', 'aria-label': 'About this track' }, facts.map(fact => h('li', {}, fact))) : null,
        h('div', { class: 'track-actions' },
          play,
          favButton(track, { className: 'round-btn' }),
          h('button', {
            type: 'button',
            class: 'btn btn-tinted',
            disabled: !track.rendered,
            dataset: { key: 'note-moment' },
            onclick: () => openNoteDialog(track.id, notePosition()),
          }, icon('note'), 'Note this moment'),
          moreButton(track, { detail: false, className: 'round-btn' })),
        statusEl));
  }

  function fillStatus() {
    if (!statusEl) return;
    const skipped = skippedNotice();
    const failed = activeJob(track.id) ? null : failedJob(track.id);
    statusEl.replaceChildren(...nodes(
      statusBadge(track),
      track.error ? h('p', { class: 'notice notice-warn' }, icon('alert'), `This track’s score can’t be read: ${track.error}`) : null,
      failed ? h('div', { class: 'notice notice-warn' }, icon('alert'),
        h('span', {}, `The last render didn’t finish${failed.error ? `: ${failed.error}` : '.'} `,
          h('button', { type: 'button', class: 'link-btn', onclick: () => requestRender(track.id) }, 'Try again'))) : null,
      skipped ? h('p', { class: 'notice' }, icon('info'), skipped) : null));
  }

  // A part (usually the optional spoken voice) left out of the render.
  function skippedNotice() {
    const warnings = Array.isArray(detail?.report?.warnings) ? detail.report.warnings : [];
    const voice = warnings.find(w => /voice|speech|kokoro/i.test(`${w?.code ?? ''} ${typeof w === 'string' ? w : w?.message ?? ''}`));
    if (voice) return typeof voice === 'string' ? voice : voice.message || 'The voice part was skipped in this render. The rest plays normally.';
    const missing = track.parts.filter(p => !p.available).map(p => p.name);
    if (missing.length) return `Not in this render: ${missing.join(', ')}. Everything else plays normally.`;
    return '';
  }

  // --- tabs ---------------------------------------------------------------------

  function tabs() {
    const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Track tools' },
      TABS.map(t => h('button', {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        class: 'tab',
        'aria-selected': t.id === activeTab,
        'aria-controls': 'track-panel',
        tabindex: t.id === activeTab ? '0' : '-1',
        dataset: { tab: t.id, key: `tab-${t.id}` },
        onclick: () => selectTab(t.id),
      }, icon(t.icon), h('span', {}, t.label))));
    list.addEventListener('keydown', event => {
      const ids = TABS.map(t => t.id);
      let index = ids.indexOf(activeTab);
      if (event.key === 'ArrowRight') index = (index + 1) % ids.length;
      else if (event.key === 'ArrowLeft') index = (index - 1 + ids.length) % ids.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = ids.length - 1;
      else return;
      event.preventDefault();
      selectTab(ids[index]);
      list.querySelector(`[data-tab="${ids[index]}"]`)?.focus();
    });
    return list;
  }

  function selectTab(tabId) {
    if (!track || !TABS.some(t => t.id === tabId)) return;
    if (tabId !== activeTab) {
      activeTab = tabId;
      for (const button of main.querySelectorAll('[role="tab"]')) {
        const selected = button.dataset.tab === tabId;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
      panelEl.setAttribute('aria-labelledby', `tab-${tabId}`);
      renderPanel();
    }
    const hash = `#/track/${encodeURIComponent(track.id)}/${tabId}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function renderPanel() {
    if (!panelEl) return;
    arrangement?.destroy();
    arrangement = null;
    mixUi = null;
    const build = { notes: notesPanel, mix: mixPanel, arrangement: arrangementPanel, versions: versionsPanel, export: exportPanel }[activeTab];
    panelEl.replaceChildren(build());
  }

  const panel = (...children) => h('div', { class: 'panel' }, children);
  const panelHead = (title, extra) => h('div', { class: 'panel-head' }, h('h2', {}, title), extra ?? null);

  function pending() {
    if (detailError) {
      return h('div', { class: 'panel-error', role: 'alert' },
        h('p', {}, `Couldn’t load the details for this track. ${errorMessage(detailError)}`),
        h('button', { type: 'button', class: 'btn btn-tinted btn-small', onclick: () => loadDetail() }, icon('render'), 'Try again'));
    }
    return h('p', { class: 'panel-loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading…');
  }

  // --- notes --------------------------------------------------------------------

  function notesPanel() {
    const add = h('button', {
      type: 'button',
      class: 'btn btn-tinted btn-small',
      disabled: !track.rendered,
      dataset: { key: 'add-note' },
      onclick: () => openNoteDialog(track.id, notePosition()),
    }, icon('plus'), 'Add note');
    const intro = h('p', { class: 'panel-intro' }, 'Pin thoughts to exact moments while you listen. Notes stay with this track, and your coding agent can read them when you ask it for a revision.');
    if (!detail) return panel(panelHead('Notes', add), intro, pending());
    if (!detail.feedback.length) {
      return panel(panelHead('Notes', add), intro, h('p', { class: 'panel-empty' }, 'No notes yet. While listening, press N or use “Note this moment”.'));
    }
    return panel(panelHead('Notes', add), intro, h('ol', { class: 'notes' }, detail.feedback.map(noteItem)));
  }

  function noteItem(note) {
    return h('li', { class: 'note', dataset: { note: note.id } },
      h('button', {
        type: 'button',
        class: 'note-time',
        dataset: { key: `note:${note.id}` },
        'aria-label': `Play from ${formatTime(note.time)}`,
        onclick: () => player.playTrack(track.id, { at: note.time }),
      }, icon('play'), formatTime(note.time)),
      h('div', { class: 'note-body' },
        h('p', { class: 'note-text' }, note.text),
        note.date ? h('span', { class: 'note-date' }, formatDate(note.date)) : null),
      h('button', {
        type: 'button',
        class: 'icon-btn note-delete',
        'aria-label': `Delete note at ${formatTime(note.time)}`,
        title: 'Delete note',
        onclick: () => deleteNote(note),
      }, icon('trash')));
  }

  async function deleteNote(note) {
    const trackId = track.id;
    try {
      await api.deleteFeedback(trackId, note.id);
    } catch (error) {
      toast(`Couldn’t delete the note. ${errorMessage(error)}`, { tone: 'error' });
      return;
    }
    if (!destroyed && detail && track?.id === trackId) {
      detail.feedback = detail.feedback.filter(n => n.id !== note.id);
      moment?.setNotes(detail.feedback);
      if (activeTab === 'notes') {
        renderPanel();
        panelEl.focus();
      }
    }
    toast('Note deleted.', {
      action: {
        label: 'Undo',
        run: async () => {
          try {
            await api.addFeedback(trackId, note.text, note.time);
            emit('feedback', trackId);
          } catch (error) {
            toast(`Couldn’t restore the note. ${errorMessage(error)}`, { tone: 'error' });
          }
        },
      },
    });
  }

  function focusNote(noteId) {
    if (activeTab !== 'notes') selectTab('notes');
    const item = panelEl.querySelector(`[data-note="${CSS.escape(noteId)}"]`);
    if (!item) return;
    item.classList.add('is-flash');
    setTimeout(() => item.classList.remove('is-flash'), 1400);
    item.querySelector('.note-time')?.focus({ preventScroll: true });
    item.scrollIntoView({ block: 'nearest' });
  }

  // --- mix ----------------------------------------------------------------------

  function mixPanel() {
    const status = h('span', { class: 'mix-status', role: 'status' });
    const intro = h('p', { class: 'panel-intro' }, 'Balance the parts, then render. Soundroo renders the track again with your mix, so the player and every export use it. Earlier takes stay under Versions.');
    if (!track.parts.length) return panel(panelHead('Mix'), h('p', { class: 'panel-empty' }, 'This track doesn’t list separate parts, so there’s nothing to mix.'));
    if (!detail) return panel(panelHead('Mix'), intro, pending());
    if (!mix) {
      const saved = normalizeMix(detail.mix, track.parts);
      mix = { saved, draft: structuredClone(saved) };
    }
    const revert = h('button', {
      type: 'button',
      class: 'btn btn-quiet',
      dataset: { key: 'mix-revert' },
      onclick: () => {
        mix.draft = structuredClone(mix.saved);
        mixDrafts.delete(draftKey());
        preserveFocus(renderPanel);
      },
    }, 'Revert');
    const save = h('button', { type: 'button', class: 'btn btn-primary', dataset: { key: 'mix-save' }, onclick: saveMix }, icon('render'), 'Save and render');
    const warning = h('p', { class: 'notice notice-warn', hidden: true }, icon('alert'), 'Every part is muted, so the render would be silent.');
    mixUi = { status, revert, save, warning };
    const mixer = h('div', { class: 'mixer', role: 'group', 'aria-label': 'Mixer' }, track.parts.map(strip), masterStrip());
    const view = panel(panelHead('Mix', status), intro, mixer, warning, h('div', { class: 'mix-actions' }, revert, save));
    updateMixState(view);
    return view;
  }

  function slider({ min, max, step, value, label: name, key, text, className = '' }) {
    const input = h('input', { type: 'range', class: className, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': name, dataset: { key } });
    input.setAttribute('aria-valuetext', text(value));
    setFill(input);
    return input;
  }

  function strip(part) {
    mix.draft.parts[part.id] ??= { volume: part.volume, pan: part.pan, mute: part.mute, solo: part.solo };
    const values = mix.draft.parts[part.id];
    const dbOut = h('output', { class: 'strip-value' }, formatDb(values.volume));
    const panOut = h('output', { class: 'strip-value' }, formatPan(values.pan));
    const volume = slider({ min: 0, max: VOLUME_MAX, step: 0.01, value: values.volume, label: `Volume, ${part.name}`, key: `vol:${part.id}`, text: formatDb, className: 'fader' });
    const pan = slider({ min: -1, max: 1, step: 0.05, value: values.pan, label: `Pan, ${part.name}`, key: `pan:${part.id}`, text: v => formatPan(v, true), className: 'panner' });
    volume.addEventListener('input', () => {
      values.volume = Number(volume.value);
      dbOut.textContent = formatDb(values.volume);
      volume.setAttribute('aria-valuetext', formatDb(values.volume));
      setFill(volume);
      updateMixState();
    });
    pan.addEventListener('input', () => {
      values.pan = Number(pan.value);
      panOut.textContent = formatPan(values.pan);
      pan.setAttribute('aria-valuetext', formatPan(values.pan, true));
      setFill(pan);
      updateMixState();
    });
    // Double-click returns a control to its neutral position.
    volume.addEventListener('dblclick', () => { volume.value = '1'; volume.dispatchEvent(new Event('input')); });
    pan.addEventListener('dblclick', () => { pan.value = '0'; pan.dispatchEvent(new Event('input')); });
    const pad = (key, letter, word) => {
      const button = h('button', {
        type: 'button',
        class: `pad pad-${key}`,
        'aria-pressed': values[key],
        'aria-label': `${word} ${part.name}`,
        title: word,
        dataset: { key: `${key}:${part.id}` },
      }, letter);
      button.addEventListener('click', () => {
        values[key] = !values[key];
        button.setAttribute('aria-pressed', String(values[key]));
        updateMixState();
      });
      return button;
    };
    return h('div', { class: 'strip', dataset: { part: part.id }, style: { '--part': part.color } },
      h('div', { class: 'strip-name' },
        h('span', { class: 'swatch', 'aria-hidden': 'true' }),
        h('span', { class: 'strip-label' }, h('span', {}, part.name), part.instrument && instrumentName(part.instrument) !== part.name ? h('small', {}, instrumentName(part.instrument)) : null),
        part.available ? null : h('span', { class: 'tag', title: 'This part was left out of the current render.' }, 'Not rendered')),
      h('div', { class: 'pads' }, pad('mute', 'M', 'Mute'), pad('solo', 'S', 'Solo')),
      h('div', { class: 'strip-control' }, h('span', { class: 'strip-caption', 'aria-hidden': 'true' }, 'Level'), volume, dbOut),
      h('div', { class: 'strip-control strip-control-pan' }, h('span', { class: 'strip-caption', 'aria-hidden': 'true' }, 'Pan'), pan, panOut));
  }

  function masterStrip() {
    const master = mix.draft.master;
    const out = h('output', { class: 'strip-value' }, formatDb(master.volume));
    const volume = slider({ min: 0, max: VOLUME_MAX, step: 0.01, value: master.volume, label: 'Master volume', key: 'vol:master', text: formatDb, className: 'fader' });
    volume.addEventListener('input', () => {
      master.volume = Number(volume.value);
      out.textContent = formatDb(master.volume);
      volume.setAttribute('aria-valuetext', formatDb(master.volume));
      setFill(volume);
      updateMixState();
    });
    volume.addEventListener('dblclick', () => { volume.value = '1'; volume.dispatchEvent(new Event('input')); });
    return h('div', { class: 'strip strip-master' },
      h('div', { class: 'strip-name' }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), h('span', { class: 'strip-label' }, 'Master')),
      h('div', { class: 'pads' }),
      h('div', { class: 'strip-control' }, h('span', { class: 'strip-caption', 'aria-hidden': 'true' }, 'Level'), volume, out),
      h('div', { class: 'strip-control strip-control-pan' }));
  }

  function updateMixState(root = panelEl) {
    if (!mix || !mixUi) return;
    const dirty = !sameMix(mix.saved, mix.draft);
    if (dirty) mixDrafts.set(draftKey(), mix);
    else mixDrafts.delete(draftKey());
    const job = activeJob(track.id);
    const audible = audibleParts(mix.draft);
    for (const el of root.querySelectorAll('.strip[data-part]')) el.classList.toggle('is-silent', !audible.has(el.dataset.part));
    const pct = job?.progress == null ? '' : ` ${Math.round(job.progress * 100)}%`;
    mixUi.status.textContent = job ? (job.status === 'queued' ? 'Waiting to render…' : `Rendering${pct}…`) : saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved';
    mixUi.status.dataset.state = job || saving ? 'busy' : dirty ? 'dirty' : 'saved';
    mixUi.warning.hidden = audible.size > 0 || !track.parts.length;
    mixUi.save.disabled = !dirty || saving || Boolean(job);
    mixUi.revert.disabled = !dirty || saving;
  }

  async function saveMix() {
    if (!mix || saving) return;
    saving = true;
    updateMixState();
    const payload = structuredClone(mix.draft);
    const trackId = track.id;
    try {
      const result = await api.saveMix(trackId, payload);
      if (mix) mix.saved = structuredClone(payload);
      if (detail) detail.mix = structuredClone(payload);
      mixDrafts.delete(draftKey());
      if (!addJob(result?.job, trackId)) refreshJobsSoon();
      toast('Mix saved. Rendering it now; the player switches to it when it’s ready.');
    } catch (error) {
      toast(`Couldn’t save the mix. ${errorMessage(error)}`, { tone: 'error' });
    } finally {
      saving = false;
      if (!destroyed) updateMixState();
    }
  }

  // --- arrangement --------------------------------------------------------------

  function arrangementPanel() {
    if (!detail) return panel(panelHead('Arrangement'), pending());
    if (!track.sections.length && !track.parts.length) {
      return panel(panelHead('Arrangement'), h('p', { class: 'panel-empty' }, 'This track doesn’t describe its sections or parts yet.'));
    }
    arrangement = arrangementView(track, detail, mix?.saved ?? normalizeMix(detail.mix, track.parts));
    return panel(
      panelHead('Arrangement'),
      h('p', { class: 'panel-intro' }, 'Sections across the top, parts below. Click anywhere to listen from there.'),
      arrangement.el,
      arrangement.hasNotes ? null : h('p', { class: 'hint' }, 'This score doesn’t include note timing, so the lanes show the parts without notes.'));
  }

  // --- versions -----------------------------------------------------------------

  function versionsPanel() {
    const rows = [
      { id: null, label: 'Current version', meta: [track.currentLabel, formatDate(track.currentDate)].filter(Boolean).join(' · ') || 'Latest render', available: track.rendered },
      ...track.versions.map(v => ({ id: v.id, label: v.label, meta: formatDate(v.date), available: true })),
    ];
    return panel(
      panelHead('Versions'),
      h('p', { class: 'panel-intro' }, 'Switching versions keeps your place in the song, so you hear exactly what changed.'),
      h('ol', { class: 'versions' }, rows.map(versionRow)),
      track.versions.length ? null : h('p', { class: 'panel-empty' }, 'No earlier versions yet. When this track is rendered again with a new mix or a revised score, earlier takes appear here for comparison.'));
  }

  function versionRow(version) {
    const listening = player.isCurrent(track.id) && player.state.versionId === version.id;
    const playing = listening && player.state.playing;
    return h('li', { class: `version ${listening ? 'is-listening' : ''}`.trim() },
      h('span', { class: 'version-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'version-text' },
        h('strong', {}, version.label),
        h('span', {}, [version.meta, listening ? (playing ? 'Playing now' : 'Paused') : ''].filter(Boolean).join(' · '))),
      h('button', {
        type: 'button',
        class: `btn btn-small ${listening ? 'btn-primary' : 'btn-tinted'}`,
        disabled: !version.available,
        dataset: { key: `version:${version.id ?? 'current'}` },
        'aria-label': `${playing ? 'Pause' : 'Listen to'} ${version.label}`,
        onclick: () => player.playVersion(track.id, version.id),
      }, icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Listen'));
  }

  // --- export -------------------------------------------------------------------

  function exportPanel() {
    const dirty = mix && !sameMix(mix.saved, mix.draft);
    const glyph = { wav: 'wave', midi: 'piano', score: 'file', stems: 'layers', share: 'globe' };
    const busy = Boolean(activeJob(track.id));
    return panel(
      panelHead('Export'),
      h('p', { class: 'panel-intro' }, 'Files use the saved mix.', dirty ? ' You have unsaved mixer changes; save and render them to include them.' : ''),
      h('ul', { class: 'downloads', role: 'list' }, DOWNLOADS.map(d => {
        const available = !d.needsRender || track.rendered;
        const inner = [
          h('span', { class: 'download-icon', 'aria-hidden': 'true' }, icon(glyph[d.kind] ?? 'file')),
          h('span', { class: 'download-text' },
            h('span', { class: 'download-name' }, h('strong', {}, d.label), h('span', { class: 'download-format' }, d.format)),
            h('span', { class: 'download-detail' }, available ? d.detail : 'Available once the track is rendered.')),
          icon('download', 'download-arrow'),
        ];
        // Audio downloads may make the studio render first; show that work.
        return h('li', {}, available
          ? h('a', { class: 'download', href: downloadUrl(track.id, d.kind), download: '', onclick: d.needsRender ? () => setTimeout(refreshJobsSoon, 400) : null }, inner)
          : h('div', { class: 'download is-disabled' }, inner));
      })),
      h('div', { class: 'render-again' },
        h('p', {}, 'Changed the score? Render again to refresh the audio and every export.'),
        h('button', { type: 'button', class: 'btn btn-tinted btn-small', disabled: busy, dataset: { key: 'render-again' }, onclick: () => requestRender(track.id) }, icon('render'), busy ? 'Rendering…' : track.rendered ? 'Render again' : 'Render now')),
      technical());
  }

  function technical() {
    if (!detail) return pending();
    const report = detail.report && typeof detail.report === 'object' ? detail.report : null;
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const stats = report ? [
      ['Length', finite(report.duration) ? formatTime(report.duration) : null],
      ['Sample rate', finite(report.sampleRate) ? `${(report.sampleRate / 1000).toFixed(1)} kHz` : null],
      ['Channels', report.channels === 2 ? 'Stereo' : report.channels === 1 ? 'Mono' : null],
      ['Peak', finite(report.peakDb) ? `${report.peakDb.toFixed(1)} dBFS` : null],
      ['Average level', finite(report.rmsDb) ? `${report.rmsDb.toFixed(1)} dBFS RMS` : null],
      ['Clipped samples', finite(report.clipped) ? String(report.clipped) : null],
      ['Safety ceiling', finite(report.limitedFraction) ? `${(report.limitedFraction * 100).toFixed(3)}% of samples` : null],
    ].filter(([, value]) => value) : [];
    const warnings = (Array.isArray(report?.warnings) ? report.warnings : []).map(w => (typeof w === 'string' ? w : w?.message)).filter(Boolean);
    const score = detail.score;
    const scoreText = score == null ? '' : typeof score === 'string' ? score : JSON.stringify(score, null, 2);
    const limit = 200000;
    return h('details', { class: 'tech' },
      h('summary', {}, 'Technical details'),
      stats.length
        ? h('dl', { class: 'tech-stats' }, stats.map(([name, value]) => h('div', {}, h('dt', {}, name), h('dd', {}, value))))
        : h('p', { class: 'panel-empty' }, 'No render report yet.'),
      warnings.length ? h('ul', { class: 'tech-warnings' }, warnings.map(w => h('li', {}, icon('alert'), w))) : null,
      scoreText ? h('div', { class: 'tech-score' },
        h('div', { class: 'tech-score-head' },
          h('strong', {}, 'Score source'),
          h('button', {
            type: 'button',
            class: 'btn btn-quiet btn-small',
            onclick: async () => toast((await copyText(scoreText)) ? 'Score copied.' : 'Couldn’t copy. Select the text instead.'),
          }, icon('copy'), 'Copy')),
        h('pre', { tabindex: '0', 'aria-label': 'Score source' }, scoreText.length > limit ? `${scoreText.slice(0, limit)}\n…` : scoreText)) : null);
  }

  // --- data ---------------------------------------------------------------------

  async function loadDetail() {
    if (!track) return;
    const mine = ++ticket;
    const trackId = track.id;
    try {
      const result = await api.track(trackId);
      if (destroyed || mine !== ticket) return;
      const raw = result?.track && typeof result.track === 'object' ? { ...result.track, ...result } : result ?? {};
      detail = {
        feedback: normalizeFeedback(raw.feedback),
        mix: raw.mix ?? null,
        score: raw.score ?? null,
        report: raw.report ?? null,
        arrangement: raw.arrangement ?? null,
      };
      detailError = null;
      if (mix && sameMix(mix.saved, mix.draft)) mix = null;
    } catch (error) {
      if (destroyed || mine !== ticket) return;
      detailError = error;
    }
    moment?.setNotes(detail?.feedback ?? []);
    fillStatus();
    preserveFocus(renderPanel);
  }

  function notFound() {
    return h('section', { class: 'empty-state' },
      h('h1', { tabindex: '-1', dataset: { pageTitle: '' } }, 'Track not found'),
      h('p', {}, 'It may have been removed from the library.'),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Back to listening'));
  }

  return {
    key: `track:${id}`,
    title: () => track?.title ?? 'Track',
    nav: '',
    render,
    setTab: tabId => selectTab(TABS.some(t => t.id === tabId) ? tabId : 'notes'),
    update(type, payload) {
      if (type === 'library') {
        const fresh = trackById(id);
        const changed = !fresh || !track || fresh.revision !== track.revision || fresh.audioUrl !== track.audioUrl || fresh.rendered !== track.rendered;
        if (changed && mix && !sameMix(mix.saved, mix.draft)) mixDrafts.set(`${fresh?.id}@${fresh?.revision ?? ''}`, mix);
        track = fresh;
        preserveFocus(paint);
        if (changed && track) loadDetail();
      } else if (type === 'jobs') {
        if (activeTab === 'mix') updateMixState();
        if (activeTab === 'export') preserveFocus(renderPanel);
      } else if (type === 'player') {
        if (activeTab === 'versions') preserveFocus(renderPanel);
      } else if (type === 'feedback' && payload === id) {
        loadDetail();
      }
      return true;
    },
    destroy() {
      destroyed = true;
      offs.forEach(off => off());
      moment?.destroy();
      arrangement?.destroy();
    },
  };
}

export function setFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

// --- arrangement view -------------------------------------------------------------

function arrangementView(track, detail, savedMix) {
  const { lanes, hasNotes } = arrangementLanes(track, detail);
  let noteEnd = 0;
  for (const lane of lanes) for (const n of lane.notes) noteEnd = Math.max(noteEnd, n.start + n.length);
  const sectionEnd = track.sections.at(-1)?.end ?? 0;
  const end = () => (player.isCurrent(track.id) ? player.duration() : 0) || track.duration || Math.max(noteEnd, sectionEnd);
  const audible = audibleParts(savedMix);
  const canvas = h('canvas', { class: 'arr-canvas', 'aria-hidden': 'true' });
  const playhead = h('div', { class: 'arr-playhead', 'aria-hidden': 'true', hidden: true });
  const timeline = h('div', { class: 'arr-timeline', 'aria-hidden': 'true', style: { '--lanes': String(Math.max(1, lanes.length)) } }, canvas, playhead);
  const total = end();
  const sections = h('ol', { class: 'arr-sections', 'aria-label': 'Sections' }, total > 0 ? track.sections.map(section => h('li', {
    style: { left: `${clamp(section.start / total, 0, 1) * 100}%`, width: `${clamp((Math.min(section.end, total) - section.start) / total, 0, 1) * 100}%` },
  }, h('button', {
    type: 'button',
    class: 'arr-section',
    title: `${section.name} · ${formatTime(section.start)}`,
    'aria-label': `Play ${section.name}, from ${formatTime(section.start)}`,
    disabled: !track.rendered,
    onclick: () => player.playTrack(track.id, { at: section.start }),
  }, section.name))) : []);
  const names = h('ul', { class: 'arr-names', 'aria-label': 'Parts' }, lanes.map(lane => h('li', {
    class: audible.has(lane.id) || !savedMix.parts[lane.id] ? '' : 'is-muted',
    style: { '--part': lane.color },
  }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), h('span', { class: 'arr-name' }, h('span', {}, lane.name), lane.instrument && instrumentName(lane.instrument) !== lane.name ? h('small', {}, instrumentName(lane.instrument)) : null),
  audible.has(lane.id) || !savedMix.parts[lane.id] ? null : h('span', { class: 'visually-hidden' }, ' (muted in the saved mix)'))));
  const ticks = total > 0 ? [0, 0.25, 0.5, 0.75, 1].map(f => h('span', { style: { left: `${f * 100}%` } }, formatTime(f * total))) : [];
  const ruler = h('div', { class: 'arr-ruler', 'aria-hidden': 'true' }, ticks);

  timeline.addEventListener('click', event => {
    const length = end();
    if (!(length > 0) || !track.rendered) return;
    const rect = timeline.getBoundingClientRect();
    player.playTrack(track.id, { at: clamp((event.clientX - rect.left) / rect.width, 0, 1) * length });
  });

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const length = end();
    if (!(length > 0) || !lanes.length) return;
    const styles = getComputedStyle(timeline);
    const laneA = styles.getPropertyValue('--lane-a').trim() || 'rgba(0,0,0,.03)';
    const laneB = styles.getPropertyValue('--lane-b').trim() || 'rgba(0,0,0,.06)';
    const line = styles.getPropertyValue('--wave-line').trim() || 'rgba(0,0,0,.12)';
    const laneHeight = height / lanes.length;
    lanes.forEach((lane, i) => {
      const top = i * laneHeight;
      ctx.globalAlpha = 1;
      ctx.fillStyle = i % 2 ? laneB : laneA;
      ctx.fillRect(0, top, width, laneHeight);
      const muted = savedMix.parts[lane.id] && !audible.has(lane.id);
      ctx.fillStyle = lane.color;
      if (!lane.notes.length) {
        ctx.globalAlpha = muted ? 0.12 : 0.28;
        ctx.fillRect(0, top + laneHeight / 2 - dpr, width, 2 * dpr);
        return;
      }
      const pad = 5 * dpr;
      const range = lane.high - lane.low;
      const noteHeight = Math.max(2 * dpr, Math.min(6 * dpr, (laneHeight - 2 * pad) / Math.max(4, range + 1)));
      for (const note of lane.notes) {
        const x = (note.start / length) * width;
        if (x > width) continue;
        const w = Math.max(1.5 * dpr, (note.length / length) * width - dpr * 0.5);
        const y = range > 0 && note.pitch != null
          ? top + pad + (1 - (note.pitch - lane.low) / range) * (laneHeight - 2 * pad - noteHeight)
          : top + laneHeight / 2 - noteHeight / 2;
        ctx.globalAlpha = (muted ? 0.22 : 1) * (0.5 + note.velocity * 0.5);
        ctx.fillRect(x, y, w, noteHeight);
      }
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = line;
    for (const section of track.sections.slice(1)) ctx.fillRect(Math.round((section.start / length) * width), 0, dpr, height);
  }

  function update() {
    const length = end();
    const current = player.isCurrent(track.id);
    playhead.hidden = !current || !(length > 0);
    if (!playhead.hidden) playhead.style.left = `${clamp(player.currentTime() / length, 0, 1) * 100}%`;
  }

  const observer = new ResizeObserver(draw);
  observer.observe(timeline);
  update();

  const el = h('div', { class: 'arr' },
    h('div', { class: 'arr-row arr-row-top' }, h('span', { class: 'arr-corner' }), sections),
    h('div', { class: 'arr-row' }, names, timeline),
    h('div', { class: 'arr-row' }, h('span', { class: 'arr-corner' }), ruler));
  return { el, hasNotes, update, destroy: () => observer.disconnect() };
}
