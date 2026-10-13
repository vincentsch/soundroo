// Note composer, settings and keyboard help dialogs. Their markup lives in index.html.
import { api } from './api.js';
import { emit, settings, updateSettings, trackById } from './store.js';
import { $, $$, toast, errorMessage } from './dom.js';
import { formatTime, parseTime, clamp } from './logic.js';
import * as player from './player.js';

// Close buttons everywhere; a click on the backdrop only closes dialogs
// without unsaved input.
for (const dialog of $$('dialog.sheet')) {
  let pressedBackdrop = false;
  dialog.addEventListener('pointerdown', event => { pressedBackdrop = event.target === dialog; });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) dialog.close();
    else if (event.target === dialog && pressedBackdrop && dialog.hasAttribute('data-light-dismiss')) dialog.close();
  });
}

// --- notes ----------------------------------------------------------------------

const noteDialog = $('#note-dialog');
const noteForm = $('#note-form');
const noteTime = $('#note-time');
const noteText = $('#note-text');
const noteNow = $('#note-now');
const noteError = $('#note-error');
const noteSave = $('#note-save');
let noteTrackId = null;
let saving = false;

export function openNoteDialog(trackId, time) {
  const track = trackById(trackId);
  if (!track) return;
  noteTrackId = track.id;
  $('#note-track').textContent = track.title;
  noteTime.value = formatTime(Math.max(0, time ?? (player.isCurrent(track.id) ? player.currentTime() : 0)));
  noteText.value = '';
  noteError.hidden = true;
  noteNow.disabled = !player.isCurrent(track.id);
  if (!noteDialog.open) noteDialog.showModal();
  noteText.focus();
}

noteNow.addEventListener('click', () => {
  if (noteTrackId && player.isCurrent(noteTrackId)) noteTime.value = formatTime(player.currentTime());
});

noteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const track = trackById(noteTrackId);
  const text = noteText.value.trim();
  const parsed = parseTime(noteTime.value);
  const showError = (message, field) => {
    noteError.textContent = message;
    noteError.hidden = false;
    field?.focus();
  };
  if (!track) return showError('This track is no longer in the library.');
  if (!text) return showError('Write a few words first.', noteText);
  if (parsed == null) return showError('Use minutes and seconds for the time, like 1:23.', noteTime);
  const time = track.duration > 0 ? clamp(parsed, 0, track.duration) : parsed;
  saving = true;
  noteSave.disabled = true;
  noteError.hidden = true;
  try {
    await api.addFeedback(track.id, text, Math.round(time * 100) / 100);
    noteDialog.close();
    toast(`Note saved at ${formatTime(time)}.`);
    emit('feedback', track.id);
  } catch (error) {
    showError(`Couldn’t save the note. ${errorMessage(error)}`);
  } finally {
    saving = false;
    noteSave.disabled = false;
  }
});

// --- settings -------------------------------------------------------------------

const settingsDialog = $('#settings-dialog');

export function openSettings() {
  for (const input of $$('input[name="theme"]', settingsDialog)) input.checked = input.value === settings.theme;
  for (const input of $$('input[name="visualizer"]', settingsDialog)) input.checked = input.value === settings.visualizer;
  $('#set-motion').checked = settings.reduceMotion;
  $('#set-resume').checked = settings.resume;
  settingsDialog.showModal();
}

settingsDialog.addEventListener('change', event => {
  const input = event.target;
  if (input.name === 'theme') updateSettings({ theme: input.value });
  else if (input.name === 'visualizer') updateSettings({ visualizer: input.value });
  else if (input.id === 'set-motion') updateSettings({ reduceMotion: input.checked });
  else if (input.id === 'set-resume') updateSettings({ resume: input.checked });
});

// --- keyboard help ----------------------------------------------------------------

export function openShortcuts() {
  $('#shortcuts-dialog').showModal();
}
