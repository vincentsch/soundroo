// What a library remembers about sharing, in <library>/sharing.json: a stable
// library id, and per service origin the links of the last share and an
// unfinished request's idempotency key. It never holds keys or claim links;
// soundroo-cloud keeps those in its owner-only config.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { libraryPath, readJson, writeJson } from '../project.js';

export const SHARING_FILE = 'sharing.json';

export function sharingPath(directory) {
  return path.join(libraryPath(directory), SHARING_FILE);
}

export function readSharing(directory) {
  const file = sharingPath(directory);
  if (!fs.existsSync(file)) return { version: 1, services: {} };
  const state = readJson(file);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error(`${SHARING_FILE} is not a sharing record. Move it aside to share this library again.`);
  return { version: 1, ...state, services: state.services && typeof state.services === 'object' ? state.services : {} };
}

export const LIBRARY_UID = /^[a-zA-Z0-9._-]{1,100}$/;
export const newLibraryUid = () => 'sr-' + crypto.randomBytes(16).toString('hex');

export function serviceState(state, origin) {
  return state.services?.[origin] ?? {};
}

function save(directory, state) {
  writeJson(sharingPath(directory), { ...state, version: 1 });
}

// The id is created once, on the first real share, and never changes, so
// later shares update the same collection.
export function ensureLibraryUid(directory) {
  const state = readSharing(directory);
  if (LIBRARY_UID.test(state.libraryUid ?? '')) return state.libraryUid;
  state.libraryUid = newLibraryUid();
  save(directory, state);
  return state.libraryUid;
}

export function updateService(directory, origin, change) {
  const state = readSharing(directory);
  state.services = { ...state.services, [origin]: change({ ...serviceState(state, origin) }) };
  save(directory, state);
  return state.services[origin];
}

// A retry of the same release reuses its key, so a lost answer cannot publish
// twice; changed music gets a new key.
export function idempotencyFor(state, origin, payloadSha256) {
  const pending = serviceState(state, origin).pending;
  if (pending?.payloadSha256 === payloadSha256 && /^[a-zA-Z0-9._:-]{8,128}$/.test(pending.idempotencyKey ?? '')) return { key: pending.idempotencyKey, reused: true };
  return { key: `sr1-${payloadSha256.slice(0, 24)}-${crypto.randomBytes(6).toString('hex')}`, reused: false };
}
