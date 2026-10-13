// Waveform of one track with its sections and note markers. Seeks the player.
import { h, icon } from './dom.js';
import { on } from './store.js';
import { formatTime, resampleMax, sectionIndexAt, clamp } from './logic.js';
import * as player from './player.js';

export function momentMap(track, { onMarker } = {}) {
  let notes = [];
  let cursor = 0;
  let dragging = false;
  const current = () => player.isCurrent(track.id);
  const total = () => (current() ? player.duration() : 0) || track.duration;
  const position = () => (current() ? player.currentTime() : cursor);

  const canvas = h('canvas', { class: 'moment-wave', 'aria-hidden': 'true' });
  const hoverLabel = h('span', { class: 'moment-hover-time' });
  const hover = h('div', { class: 'moment-hover', 'aria-hidden': 'true', hidden: true }, hoverLabel);
  const head = h('div', { class: 'moment-head', 'aria-hidden': 'true' });
  const surface = h('div', {
    class: 'moment-surface',
    role: 'slider',
    tabindex: total() > 0 ? '0' : '-1',
    'aria-label': `Position in “${track.title}”`,
    'aria-valuemin': '0',
    'aria-disabled': total() > 0 ? null : 'true',
  }, canvas, head, hover);
  const markers = h('div', { class: 'moment-markers' });
  const sectionList = h('ol', { class: 'moment-sections', 'aria-label': 'Sections' });
  const root = h('div', { class: `moment ${track.waveform.length ? '' : 'moment-empty'}`.trim() }, markers, surface, sectionList);

  function renderSections() {
    const end = total();
    sectionList.replaceChildren(...(end > 0 ? track.sections : []).map((section, i) => {
      const left = clamp(section.start / end, 0, 1) * 100;
      const width = clamp((Math.min(section.end, end) - section.start) / end, 0, 1) * 100;
      return h('li', { style: { left: `${left}%`, width: `${width}%` } },
        h('button', {
          type: 'button',
          class: 'moment-section',
          dataset: { section: String(i) },
          title: `${section.name} · ${formatTime(section.start)}`,
          'aria-label': `${section.name}, starts at ${formatTime(section.start)}`,
          onclick: () => seekTo(section.start, true),
        }, section.name));
    }));
  }

  function renderMarkers() {
    const end = total();
    markers.replaceChildren(...(end > 0 ? notes : []).map(note => h('button', {
      type: 'button',
      class: 'moment-marker',
      style: { left: `${clamp(note.time / end, 0, 1) * 100}%` },
      'aria-label': `Note at ${formatTime(note.time)}: ${note.text.slice(0, 80)}`,
      title: `${formatTime(note.time)} · ${note.text.slice(0, 120)}`,
      onclick: () => {
        seekTo(note.time, true);
        onMarker?.(note);
      },
    }, icon('note'))));
  }

  function seekTo(time, startPlaying) {
    const end = total();
    if (!(end > 0) || !track.rendered) return;
    const target = clamp(time, 0, end);
    if (current()) {
      player.seek(target);
      if (startPlaying && !player.state.playing) player.play();
    } else if (startPlaying) {
      player.playTrack(track.id, { at: target });
    } else {
      cursor = target;
      update();
    }
  }

  function timeAt(clientX) {
    const rect = surface.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * total();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const styles = getComputedStyle(root);
    const base = styles.getPropertyValue('--wave-base').trim() || '#b9b3aa';
    const played = styles.getPropertyValue('--wave-played').trim() || '#e0472b';
    const line = styles.getPropertyValue('--wave-line').trim() || 'rgba(0,0,0,.12)';
    const end = total();
    const progress = end > 0 ? clamp(position() / end, 0, 1) : 0;
    const bar = 2 * dpr;
    const step = 3 * dpr;
    const count = Math.max(1, Math.floor(width / step));
    const values = track.waveform.length ? resampleMax(track.waveform, count) : null;
    const mid = height / 2;
    for (let i = 0; i < count; i++) {
      const value = values ? values[i] ** 0.8 : 0.03;
      const barHeight = Math.max(dpr, value * (height - 2 * dpr));
      const x = i * step;
      ctx.fillStyle = (x + bar / 2) / width <= progress && (current() || cursor > 0) ? played : base;
      ctx.fillRect(x, mid - barHeight / 2, bar, barHeight);
    }
    if (end > 0) {
      ctx.fillStyle = line;
      for (const section of track.sections.slice(1)) ctx.fillRect(Math.round((section.start / end) * width), 0, dpr, height);
    }
  }

  function update() {
    const end = total();
    const now = position();
    surface.setAttribute('aria-valuemax', String(Math.round(end)));
    surface.setAttribute('aria-valuenow', String(Math.round(now)));
    const section = track.sections[sectionIndexAt(track.sections, now)];
    surface.setAttribute('aria-valuetext', `${formatTime(now)} of ${formatTime(end)}${section ? `, ${section.name}` : ''}`);
    head.style.left = `${end > 0 ? clamp(now / end, 0, 1) * 100 : 0}%`;
    head.hidden = !(current() || cursor > 0);
    const active = current() ? sectionIndexAt(track.sections, now) : -1;
    for (const button of sectionList.querySelectorAll('[data-section]')) {
      button.classList.toggle('is-active', Number(button.dataset.section) === active);
    }
    draw();
  }

  surface.addEventListener('pointerdown', event => {
    if (!(total() > 0) || event.button !== 0) return;
    dragging = true;
    surface.setPointerCapture(event.pointerId);
    showHover(event.clientX);
  });
  surface.addEventListener('pointermove', event => showHover(event.clientX));
  surface.addEventListener('pointerup', event => {
    if (!dragging) return;
    dragging = false;
    seekTo(timeAt(event.clientX), true);
  });
  surface.addEventListener('pointercancel', () => { dragging = false; hover.hidden = true; });
  surface.addEventListener('pointerleave', () => { if (!dragging) hover.hidden = true; });

  function showHover(clientX) {
    if (!(total() > 0)) return;
    const rect = surface.getBoundingClientRect();
    hover.hidden = false;
    hover.style.left = `${clamp(clientX - rect.left, 0, rect.width)}px`;
    hoverLabel.textContent = formatTime(timeAt(clientX));
  }

  surface.addEventListener('keydown', event => {
    if (!(total() > 0)) return;
    const steps = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    let target;
    if (event.key in steps) target = position() + steps[event.key];
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = Math.max(0, total() - 1);
    else if ((event.key === 'Enter' || event.key === ' ') && !current()) {
      event.preventDefault();
      seekTo(cursor, true);
      return;
    } else return;
    event.preventDefault();
    seekTo(target, false);
  });

  const unsubscribe = [on('time', () => { if (current()) update(); }), on('player', update)];
  const resize = new ResizeObserver(() => draw());
  resize.observe(surface);
  renderSections();
  update();

  return {
    el: root,
    setNotes(list) {
      notes = list;
      renderMarkers();
    },
    destroy() {
      resize.disconnect();
      unsubscribe.forEach(fn => fn());
    },
  };
}
