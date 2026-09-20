// The single source of truth for the version.
//
// It is displayed in the corner of the running simulation and stamped into the
// generated index.html, so "which version am I looking at" is answered by the
// page itself. `node tools/verify.mjs` also checks it against the git tag when
// HEAD is tagged, so the badge cannot quietly disagree with the tag you would
// roll back to.
//
// Bumping this: see the versioning section of WORKFLOW.md.
export const VERSION = '1.1.0';
