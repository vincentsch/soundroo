// Make music: prepares a brief for the user's own coding agent. Nothing here
// composes music or calls a model; it copies text or stores a request file.
import { api } from '../api.js';
import { data, loadDraft, saveDraft } from '../store.js';
import { h, icon, toast, copyText, errorMessage } from '../dom.js';
import { FEELS, LENGTHS, VOICES, buildPrompt, composeBrief, followUpPrompt, normalizeRequest, trackCount, formatDate, plural } from '../logic.js';

const STARTERS = [
  ['Rock and roll', 'Guitar-led rock and roll: boogie bass, crunchy riffs, strong backbeats, drum fills and hooks that arrive quickly. Give each piece a big chorus and its own identity.'],
  ['Modern pop', 'Modern pop instrumentals with memorable lead hooks, moving bass, punchy drums and a clear verse-to-chorus lift. Vary dance-pop, indie guitar pop and soul/funk grooves.'],
  ['Work grooves', 'Rhythmic music for working: UK garage, understated house, funk and liquid breakbeats. Keep a steady pulse and fewer foreground notes, with slow changes that hold interest.'],
  ['Surprise me', 'A varied record with guitar-led rock, hook-driven pop, dance and funk, plus a few stylish work grooves. Distinct riffs and melodies, quick hooks and strong chorus contrasts.'],
];

export function makeView() {
  const saved = loadDraft();
  const draft = {
    brief: typeof saved?.brief === 'string' ? saved.brief : '',
    count: trackCount(saved?.count ?? 10),
    feel: Array.isArray(saved?.feel) ? saved.feel.filter(f => FEELS.includes(f)) : [],
    length: saved?.length in LENGTHS ? saved.length : '',
    voice: saved?.voice in VOICES ? saved.voice : 'auto',
  };
  let requests = null;
  let requestsError = null;
  let destroyed = false;
  let persistTimer = 0;
  let promptEl;
  let errorEl;
  let resultEl;
  let requestsEl;
  let saveButton;
  let briefInput;

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => saveDraft(draft.brief || draft.feel.length ? draft : null), 300);
  }

  function changed() {
    promptEl.textContent = buildPrompt({ ...draft, library: data.directory });
    errorEl.hidden = true;
    persist();
  }

  function render(main) {
    briefInput = h('textarea', {
      id: 'brief',
      rows: '7',
      maxlength: '4000',
      required: true,
      'aria-describedby': 'brief-hint brief-error',
      placeholder: 'Crunchy guitars, fast backbeats and huge hooks. Mix in some modern pop, disco and a few steady grooves for work…',
      value: draft.brief,
      oninput: event => {
        draft.brief = event.target.value;
        changed();
      },
    });
    const chips = FEELS.map(feel => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': draft.feel.includes(feel),
      onclick: event => {
        const on = !draft.feel.includes(feel);
        draft.feel = on ? [...draft.feel, feel] : draft.feel.filter(f => f !== feel);
        event.currentTarget.setAttribute('aria-pressed', String(on));
        changed();
      },
    }, feel));
    const count = h('input', {
      id: 'brief-count',
      type: 'number',
      min: '1',
      max: '20',
      step: '1',
      inputmode: 'numeric',
      value: String(draft.count),
      onchange: event => {
        draft.count = trackCount(event.target.value);
        event.target.value = String(draft.count);
        changed();
      },
    });
    const choice = (id, options, key) => h('span', { class: 'select' },
      h('select', {
        id,
        onchange: event => {
          draft[key] = event.target.value;
          changed();
        },
      }, Object.entries(options).map(([value, text]) => h('option', { value, selected: draft[key] === value }, text))),
      icon('chevron-down'));

    promptEl = h('pre', { class: 'prompt', id: 'prompt-preview', tabindex: '0', 'aria-label': 'Prompt preview' }, buildPrompt({ ...draft, library: data.directory }));
    errorEl = h('p', { class: 'form-error', id: 'brief-error', role: 'alert', hidden: true });
    resultEl = h('div', { class: 'saved-request', hidden: true, tabindex: '-1' });
    saveButton = h('button', { type: 'button', class: 'btn btn-tinted', onclick: saveRequest }, icon('save'), 'Save request for your agent');
    requestsEl = h('div', { class: 'requests' }, h('p', { class: 'panel-loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading saved requests…'));

    main.append(
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Make music'),
        h('h1', { tabindex: '-1', dataset: { pageTitle: '' } }, 'Make a collection'),
        h('p', { class: 'lede' }, 'Describe what you want to hear. Copy the prompt to your coding agent, then come back to listen.')),
      h('ol', { class: 'steps' },
        step('1', 'Describe it', 'A mood, a place, instruments, tempo, or how you’ll listen.'),
        step('2', 'Copy or save', 'Copy the full prompt, or save the brief as a request file your agent can open.'),
        step('3', 'Paste into your agent', 'It makes your collection and sends you a studio link to listen.')),
      h('div', { class: 'make-grid' },
        h('form', { class: 'make-form', novalidate: true, onsubmit: event => event.preventDefault() },
          h('div', { class: 'field' },
            h('label', { for: 'brief' }, 'Describe the music'),
            briefInput,
            h('p', { class: 'hint', id: 'brief-hint' }, 'Give it a place, a feeling, or a sound. A few words are enough.')),
          h('div', { class: 'field' },
            h('p', { class: 'hint' }, 'Start with a sound'),
            h('div', { class: 'chips' }, STARTERS.map(([label, brief]) => h('button', { type: 'button', class: 'chip', onclick: () => {
              const current = draft.brief.trim();
              const replace = !current || STARTERS.some(([, text]) => text === current);
              const next = replace ? brief : current.includes(brief) ? draft.brief : `${draft.brief.trimEnd()}\n\n${brief}`;
              if (next.length > 4000) { toast('Your brief is full. Shorten it to add a direction.'); return; }
              draft.brief = next;
              briefInput.value = draft.brief;
              if (replace) { draft.feel = []; chips.forEach(chip => chip.setAttribute('aria-pressed', 'false')); }
              changed();
            } }, label)))),
          h('fieldset', { class: 'field' },
            h('legend', {}, 'Feel ', h('span', { class: 'optional' }, 'optional')),
            h('div', { class: 'chips' }, chips)),
          h('div', { class: 'field-row' },
            h('div', { class: 'field field-small' }, h('label', { for: 'brief-count' }, 'Tracks'), count),
            h('div', { class: 'field' }, h('label', { for: 'brief-length' }, 'Length'), choice('brief-length', LENGTHS, 'length')),
            h('div', { class: 'field' }, h('label', { for: 'brief-voice' }, 'Voice'), choice('brief-voice', VOICES, 'voice')))),
        h('aside', { class: 'prompt-card', 'aria-labelledby': 'prompt-heading' },
          h('h2', { id: 'prompt-heading' }, 'Prompt for your agent'),
          promptEl,
          errorEl,
          h('div', { class: 'prompt-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: copyPrompt }, icon('copy'), 'Copy prompt'),
            saveButton),
          resultEl)),
      h('section', { class: 'shelf', 'aria-labelledby': 'requests-heading' },
        h('div', { class: 'shelf-head' }, h('h2', { id: 'requests-heading' }, 'Saved requests')),
        requestsEl));
    loadRequests();
  }

  function step(n, title, text) {
    return h('li', { class: 'step' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, n), h('div', {}, h('strong', {}, title), h('p', {}, text)));
  }

  function requireBrief() {
    if (draft.brief.trim().length >= 3) return true;
    errorEl.textContent = 'Describe the music first. A sentence or two is plenty.';
    errorEl.hidden = false;
    briefInput.focus();
    return false;
  }

  async function copyPrompt() {
    if (!requireBrief()) return;
    toast((await copyText(buildPrompt({ ...draft, library: data.directory }))) ? 'Prompt copied. Paste it into your coding agent.' : 'Couldn’t copy automatically. Select the prompt text and copy it.');
  }

  async function saveRequest() {
    if (!requireBrief()) return;
    saveButton.disabled = true;
    try {
      const result = await api.saveRequest(composeBrief(draft), draft.count);
      if (destroyed) return;
      const request = normalizeRequest(result?.request);
      if (!request) throw new Error('The server didn’t confirm the saved request.');
      showSaved(request);
      loadRequests();
    } catch (error) {
      if (destroyed) return;
      errorEl.textContent = `Couldn’t save the request. ${errorMessage(error)}`;
      errorEl.hidden = false;
    } finally {
      if (!destroyed) saveButton.disabled = false;
    }
  }

  function showSaved(request) {
    const text = followUpPrompt(request);
    resultEl.replaceChildren(
      h('p', { class: 'saved-title' }, icon('check'), h('strong', {}, 'Saved. Nothing has started yet.')),
      request.path ? h('p', {}, 'Stored at ', h('code', {}, request.path), '. Paste this into your coding agent:') : h('p', {}, 'Paste this into your coding agent:'),
      h('pre', { class: 'prompt prompt-small', tabindex: '0', 'aria-label': 'Follow-up for your agent' }, text),
      h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: async () => toast((await copyText(text)) ? 'Copied. Paste it into your coding agent.' : 'Couldn’t copy automatically. Select the text and copy it.') }, icon('copy'), 'Copy follow-up'));
    resultEl.hidden = false;
    resultEl.focus();
  }

  async function loadRequests() {
    try {
      const result = await api.requests();
      requests = (Array.isArray(result?.requests) ? result.requests : []).map(normalizeRequest).filter(Boolean);
      requests.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      requestsError = null;
    } catch (error) {
      requestsError = error;
    }
    if (!destroyed) renderRequests();
  }

  function renderRequests() {
    if (requestsError) {
      requestsEl.replaceChildren(h('div', { class: 'panel-error', role: 'alert' },
        h('p', {}, `Couldn’t load saved requests. ${errorMessage(requestsError)}`),
        h('button', { type: 'button', class: 'btn btn-tinted btn-small', onclick: loadRequests }, icon('render'), 'Try again')));
      return;
    }
    if (!requests.length) {
      requestsEl.replaceChildren(h('p', { class: 'panel-empty' }, 'No saved requests yet. Saved briefs wait here until your agent composes them.'));
      return;
    }
    requestsEl.replaceChildren(h('ol', { class: 'request-list' }, requests.map(request => h('li', { class: 'request' },
      h('p', { class: 'request-brief' }, request.brief || 'Untitled request'),
      h('p', { class: 'request-meta' }, [plural(request.count, 'track'), formatDate(request.date), request.status].filter(Boolean).join(' · ')),
      request.path ? h('code', { class: 'request-path' }, request.path) : null,
      h('button', {
        type: 'button',
        class: 'btn btn-quiet btn-small',
        onclick: async () => toast((await copyText(followUpPrompt(request))) ? 'Follow-up copied. Paste it into your coding agent.' : 'Couldn’t copy automatically.'),
      }, icon('copy'), 'Copy follow-up')))));
  }

  return {
    key: 'make',
    title: () => 'Make music',
    nav: 'make',
    render,
    update: () => true,
    destroy() {
      destroyed = true;
      clearTimeout(persistTimer);
      saveDraft(draft.brief || draft.feel.length ? draft : null);
    },
  };
}
