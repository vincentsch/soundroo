// Render jobs. Polls /api/jobs only while something is queued or running.
import { api } from './api.js';
import { data, emit, setJobList, trackById } from './store.js';
import { isActiveJob, normalizeJob } from './logic.js';
import { toast, errorMessage } from './dom.js';

let timer = 0;
let failures = 0;
let inFlight = false;

// Jobs seen active during this session, so finishing ones can be announced.
const watching = new Map();

export function applyJobs(list) {
  setJobList(list);
  const finished = [];
  const failed = [];
  for (const [id, before] of watching) {
    const now = data.jobs.find(job => job.id === id);
    if (now && isActiveJob(now)) continue;
    watching.delete(id);
    if (now?.status === 'error') failed.push(now);
    else finished.push(now ?? { ...before, status: 'done' });
  }
  for (const job of data.jobs) if (isActiveJob(job)) watching.set(job.id, job);
  emit('jobs');
  if (finished.length || failed.length) emit('jobs-settled', { finished, failed });
  schedule();
}

// A job returned from a POST, which does not repeat the track id.
export function addJob(raw, trackId) {
  const job = normalizeJob({ ...raw, trackId: raw?.trackId ?? trackId });
  if (!job) return null;
  const others = data.jobs.filter(existing => existing.id !== job.id);
  applyJobs([...others, job]);
  return job;
}

export async function requestRender(trackId) {
  const track = trackById(trackId);
  try {
    const result = await api.render(trackId);
    const job = addJob(result?.job, trackId);
    toast(`Rendering “${track?.title ?? 'track'}”. It plays here when it’s ready.`);
    if (!job) refreshJobsSoon();
    return job;
  } catch (error) {
    toast(`Couldn’t start rendering “${track?.title ?? 'this track'}”. ${errorMessage(error)}`, { tone: 'error' });
    return null;
  }
}

function schedule(delay) {
  clearTimeout(timer);
  timer = 0;
  if (!data.jobs.some(isActiveJob)) return;
  timer = setTimeout(poll, delay ?? (document.hidden ? 5000 : 1200));
}

export function refreshJobsSoon() {
  clearTimeout(timer);
  timer = setTimeout(poll, 400);
}

async function poll() {
  timer = 0;
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await api.jobs();
    failures = 0;
    applyJobs(result?.jobs ?? []);
  } catch (error) {
    failures++;
    if (failures === 3) toast(`Lost touch with the studio server while rendering. Still trying. ${errorMessage(error)}`, { tone: 'error' });
    clearTimeout(timer);
    timer = setTimeout(poll, Math.min(15000, 1500 * 2 ** Math.min(failures, 4)));
  } finally {
    inFlight = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && data.jobs.some(isActiveJob)) schedule(200);
});
