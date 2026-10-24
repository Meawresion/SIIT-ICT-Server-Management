// File-backed record of jobs this site has handled, keyed by jti (job_id). It makes the worker
// idempotent across redeliveries and restarts: a finished job's result is re-sent instead of
// running it again. It also keeps per-job progress between retries. It never stores secrets.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JobStore {
  #file;
  #jobs;

  constructor(file) {
    this.#file = file;
    this.#jobs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }

  get(jti) {
    return this.#jobs[jti];
  }

  // progress: small non-secret facts a retry needs (e.g. { vpnIsNew: true }).
  setProgress(jti, rid, progress) {
    const prev = this.#jobs[jti];
    this.#jobs[jti] = { rid, status: 'in_progress', progress, startedAt: prev?.startedAt ?? new Date().toISOString() };
    this.#flush();
  }

  // result: the result payload that was (or will be) sent back.
  finish(jti, rid, result) {
    const prev = this.#jobs[jti];
    this.#jobs[jti] = {
      rid, status: 'done', result, startedAt: prev?.startedAt ?? new Date().toISOString(), finishedAt: new Date().toISOString(),
    };
    this.#flush();
  }

  // Write to a temp file, then rename, so a crash never leaves a half-written store.
  #flush() {
    mkdirSync(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#jobs, null, 2), { mode: 0o600 });
    renameSync(tmp, this.#file);
  }
}
