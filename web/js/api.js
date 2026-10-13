// Same-origin HTTP API of the local Soundroo server.

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const OFFLINE = "Soundroo's local server isn't responding. Check that the studio is still running, then try again.";

function statusMessage(status) {
  if (status === 404) return 'That item is no longer in the library.';
  if (status === 409) return 'Soundroo is busy with this track. Try again when the current render finishes.';
  if (status === 413) return 'That is too long to save.';
  if (status >= 500) return 'The studio server ran into a problem.';
  return `The studio server answered with an error (${status}).`;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(OFFLINE, 0);
  }
  const raw = await response.text().catch(() => '');
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  if (!response.ok) {
    const detail = data?.error;
    const message = (typeof detail === 'string' && detail) || detail?.message || data?.message || '';
    // Server messages are shown as written unless they are file-system details.
    const technical = !message || /ENOENT|EACCES|\bat \S+:\d+|(?:^|[\s'"])\/[\w.-]+\/[\w./-]+/.test(message);
    throw new ApiError(technical ? statusMessage(response.status) : message, response.status);
  }
  if (raw && data === null) throw new ApiError('The studio server sent an unexpected response.', response.status);
  return data ?? {};
}

const track = id => `/api/tracks/${encodeURIComponent(id)}`;

export const api = {
  library: options => request('/api/library', options),
  track: (id, options) => request(track(id), options),
  setFavorite: (id, favorite) => request(`${track(id)}/state`, { method: 'POST', body: { favorite } }),
  addFeedback: (id, text, time) => request(`${track(id)}/feedback`, { method: 'POST', body: { text, time } }),
  deleteFeedback: (id, feedbackId) => request(`${track(id)}/feedback/${encodeURIComponent(feedbackId)}`, { method: 'DELETE' }),
  saveMix: (id, mix) => request(`${track(id)}/mix`, { method: 'POST', body: mix }),
  render: id => request(`${track(id)}/render`, { method: 'POST', body: {} }),
  jobs: () => request('/api/jobs'),
  requests: () => request('/api/requests'),
  saveRequest: (brief, count) => request('/api/requests', { method: 'POST', body: { brief, count } }),
};

export const DOWNLOADS = [
  { kind: 'wav', label: 'Audio', format: 'WAV', needsRender: true, detail: 'The finished mix, ready for any player or editor.' },
  { kind: 'midi', label: 'MIDI', format: 'MID', needsRender: false, detail: 'Instrument notes for a music app; speech and noise stay in the audio.' },
  { kind: 'score', label: 'Score', format: 'Source', needsRender: false, detail: 'The editable Soundroo composition your agent works from.' },
  { kind: 'stems', label: 'Stems', format: 'ZIP', needsRender: true, detail: 'One audio file per part, for remixing elsewhere.' },
  { kind: 'share', label: 'Listening page', format: 'ZIP', needsRender: true, detail: 'A standalone page with the audio that opens in any browser.' },
];

export const downloadUrl = (id, kind) => `${track(id)}/download/${kind}`;
