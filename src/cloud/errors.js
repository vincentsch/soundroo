// One error type for sharing. code is a stable slug for scripts and agents,
// exitCode follows the rungrad exit codes soundroo-cloud uses:
// 1 usage or invalid music, 2 service or network, 3 key, 4 not allowed,
// 5 not found, 6 slow down.
// claimUrl carries a saved private claim link when it is the way out of the
// error; it goes only to the person on this computer, like a share's own.
export class ShareError extends Error {
  constructor(message, { code = 'error', exitCode = 1, issues, hint, details, status, claimUrl } = {}) {
    super(message);
    this.name = 'ShareError';
    this.code = code;
    this.exitCode = exitCode;
    if (issues?.length) this.issues = issues;
    if (hint) this.hint = hint;
    if (details) this.details = details;
    if (status) this.status = status;
    if (claimUrl) this.claimUrl = claimUrl;
  }

  toJSON() {
    return { error: this.message, code: this.code, exitCode: this.exitCode, ...(this.status ? { status: this.status } : {}), ...(this.issues ? { issues: this.issues } : {}), ...(this.hint ? { hint: this.hint } : {}), ...(this.claimUrl ? { claimUrl: this.claimUrl } : {}) };
  }
}

export function asShareError(error) {
  if (error instanceof ShareError) return error;
  return new ShareError(error?.message ?? String(error), { code: 'error', exitCode: 1 });
}
