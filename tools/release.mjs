// Cut a version, in one command.
//
//   node tools/release.mjs 1.1.0               check, confirm, then do it
//   node tools/release.mjs 1.1.0 --dry-run     check and print the plan, change nothing
//   node tools/release.mjs 1.1.0 --yes         no prompt, for scripts
//   node tools/release.mjs 1.1.0 --no-release  stop after pushing the tag
//
// What it does, in order: guard the working tree, bump src/version.js, rebuild
// index.html, run the full verification, commit, tag, push, and publish a GitHub
// release with the generated index.html attached under a versioned name.
//
// The release notes come from CHANGELOG.md, so the changelog entry has to exist
// before you run this. That is deliberate: release notes are writing, not
// something to generate.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--')));
const positional = argv.filter(arg => !arg.startsWith('--'));

const dryRun = flags.has('--dry-run');
const assumeYes = flags.has('--yes');
const publishRelease = !flags.has('--no-release');

const usage = 'usage: node tools/release.mjs <major.minor.patch> [--dry-run] [--yes] [--no-release]';

function fail(message)
{
    console.error('\n' + message + '\n');
    process.exit(1);
}

function note(message)
{
    console.log('  ' + message);
}

function heading(label)
{
    console.log('\n=== ' + label + ' ===');
}

// Whatever git or gh said, so a failure is diagnosable without re-running.
function because(result)
{
    const text = String(result.stderr || result.stdout || '').trim();
    return text ? '\n\n' + text : '';
}

function run(command, commandArgs, options = {})
{
    const inherit = options.stdio === 'inherit';
    const result = spawnSync(command, commandArgs, {
        cwd: root,
        encoding: inherit ? undefined : 'utf8',
        ...options
    });

    return {
        status: result.status,
        ok: result.status === 0 && !result.error,
        stdout: inherit ? '' : String(result.stdout ?? ''),
        stderr: inherit ? '' : String(result.stderr ?? '')
    };
}

const git = (...commandArgs) => run('git', commandArgs);

function compareVersions(a, b)
{
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i])
            return left[i] - right[i];
    }
    return 0;
}

// The release section of CHANGELOG.md, from its heading to the next one.
function changelogSection(text, version)
{
    const lines = text.split(/\r?\n/);
    const pattern = new RegExp('^##\\s+v' + version.replace(/\./g, '\\.') + '\\b');
    const start = lines.findIndex(line => pattern.test(line));
    if (start < 0)
        return null;

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) {
            end = i;
            break;
        }
    }

    const title = lines[start].replace(/^##\s+/, '').trim();
    return {
        title,
        name: title.replace(new RegExp('^v' + version.replace(/\./g, '\\.') + '\\s*[-–—:]?\\s*'), ''),
        body: lines.slice(start + 1, end).join('\n').trim()
    };
}

// gh is installed to Program Files and may not be on the PATH of a shell that
// was already open when it was installed.
function resolveGh()
{
    for (const candidate of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) {
        const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
        if (!result.error && result.status === 0)
            return candidate;
    }
    return null;
}

// --------------------------------------------------------------------- input

const version = positional[0];

if (!version)
    fail(usage);
if (!/^\d+\.\d+\.\d+$/.test(version))
    fail(`"${version}" is not a version number.\n\n${usage}`);

const versionFile = join(root, 'src', 'version.js');
const versionSource = readFileSync(versionFile, 'utf8');
const currentVersion = versionSource.match(/VERSION = '([^']+)'/)?.[1];

if (!currentVersion)
    fail('could not read VERSION from src/version.js');
if (compareVersions(version, currentVersion) <= 0)
    fail(`src/version.js already says ${currentVersion}. Pick a higher version.`);

// -------------------------------------------------------------------- guards

heading('checks');

const status = git('status', '--porcelain').stdout.trim();
if (status)
    fail('the working tree is not clean:\n\n' + status + '\n\nCommit or stash it first, so the release is one reviewable commit.');
note('working tree is clean');

const branch = git('branch', '--show-current').stdout.trim();
if (branch !== 'main')
    fail(`on branch "${branch}". Releases are cut from main.`);
note('on branch main');

const email = git('config', 'user.email').stdout.trim();
if (!email)
    fail('git has no user.email set, so it cannot create the release commit.'
        + '\n\nSet it once, in this repository:'
        + '\n  git config user.name "Your Name"'
        + '\n  git config user.email "you@example.com"');
note(`commits will be authored as ${email}`);

// Best effort: if there is no network, fall back to the refs we already have.
const fetched = git('fetch', '--quiet', 'origin');
note(fetched.ok ? 'fetched origin' : 'could not reach origin, using the local remote ref');

const head = git('rev-parse', 'HEAD').stdout.trim();
const remote = git('rev-parse', 'origin/main').stdout.trim();
if (!head || !remote)
    fail('could not resolve HEAD and origin/main');

// Being ahead is fine: the release pushes the pending commits. Being behind or
// diverged is not, because the release would describe something other than what
// is on GitHub.
if (!git('merge-base', '--is-ancestor', 'origin/main', 'HEAD').ok)
    fail('origin/main is not an ancestor of HEAD: this branch is behind or has diverged.'
        + '\nPull and reconcile first, then release.');

const ahead = git('rev-list', '--count', 'origin/main..HEAD').stdout.trim();
note(ahead === '0'
    ? `up to date with origin/main (${head.slice(0, 7)})`
    : `${ahead} commit(s) ahead of origin/main; the release will push them`);

const changelogPath = join(root, 'CHANGELOG.md');
const section = changelogSection(readFileSync(changelogPath, 'utf8'), version);
if (!section)
    fail(`CHANGELOG.md has no "## v${version}" section.\n\nAdd it first: those lines become the release notes.`);
note(`CHANGELOG.md has v${version}: ${section.name}`);

if (/planned|not started/i.test(section.body))
    note('warning: that changelog entry still reads as planned - update it before publishing');

const docs = existsSync(join(root, 'docs'))
    ? readdirSync(join(root, 'docs')).filter(name => name.startsWith('v' + version))
    : [];
note(docs.length
    ? `version document: docs/${docs[0]}`
    : `note: no docs/v${version}-*.md version document`);

let gh = null;
if (publishRelease) {
    gh = resolveGh();
    if (!gh)
        fail('gh is not installed or not on the PATH. Run `gh auth login`, or use --no-release.');

    const auth = run(gh, ['auth', 'status']);
    if (!auth.ok)
        fail('gh is not authenticated. Run `gh auth login`, or use --no-release.');
    note('gh is installed and authenticated');
}

// ---------------------------------------------------------------------- plan

const tag = 'v' + version;
const title = `v${version} - ${section.name}`;
const subject = `v${version}: ${section.name}`;
const assetName = `flip-fluid-v${version}.html`;
const notes = `**Run it:** download \`${assetName}\` below and open it - one self-contained file,`
    + ' no server, nothing to install.\n\n' + section.body;

console.log('');
console.log('  plan');
console.log('  ' + '-'.repeat(66));
console.log(`  version      ${currentVersion} -> ${version}   (src/version.js)`);
console.log(`  commit       ${subject}`);
console.log(`  tag          ${tag}`);
console.log(`  push         origin main + ${tag}`);
console.log(`  release      ${publishRelease ? `${title}  with ${assetName}` : 'skipped (--no-release)'}`);
console.log(`  notes        ${section.body.split('\n').length} lines from CHANGELOG.md`);

if (dryRun) {
    console.log('');
    console.log('RESULT: DRY RUN - nothing was changed');
    process.exit(0);
}

if (!assumeYes) {
    if (!process.stdin.isTTY)
        fail('stdin is not a terminal. Pass --yes to confirm, or --dry-run to look first.');

    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(`\nCut and publish ${tag}? [y/N] `);
    readline.close();

    if (!/^y(es)?$/i.test(answer.trim()))
        fail('cancelled. Nothing was changed.');
}

// ------------------------------------------------------------------- actions

heading(`bump to ${version}`);
writeFileSync(versionFile, versionSource.replace(/VERSION = '[^']*'/, `VERSION = '${version}'`));
note('src/version.js updated');

heading('verify --full');
const verify = run(process.execPath, [join(root, 'tools', 'verify.mjs'), '--full'], { stdio: 'inherit' });
if (!verify.ok)
    fail('verification failed. src/version.js has been bumped; fix the problem, or restore it with `git checkout src/version.js`.');

heading('commit');
const added = git('add', '-A');
if (!added.ok)
    fail('git add failed' + because(added));

const committed = git('commit', '-m', subject, '-m', section.body);
if (!committed.ok) {
    const staged = git('status', '--porcelain').stdout.trim();
    fail('git commit failed' + because(committed)
        + (staged ? '\n\nworking tree:\n' + staged : '')
        + '\n\nIf nothing was left to commit, the version was already bumped and index.html already rebuilt.');
}
note(subject);

heading('tag');
const existingTag = git('rev-parse', '--verify', '--quiet', 'refs/tags/' + tag);
if (existingTag.ok) {
    const tagged = git('rev-list', '-n', '1', tag).stdout.trim();
    const now = git('rev-parse', 'HEAD').stdout.trim();
    if (tagged !== now)
        fail(`${tag} already points at ${tagged.slice(0, 7)}, not at HEAD. Move it by hand if that is really what you want.`);
    note(`${tag} already points at HEAD`);
} else {
    const tagged = git('tag', '-a', tag, '-m', title);
    if (!tagged.ok)
        fail('git tag failed' + because(tagged));
    note(tag + ' created');
}

heading('push');
const pushedMain = git('push', 'origin', 'main');
if (!pushedMain.ok)
    fail('push failed' + because(pushedMain)
        + '\n\nThe commit and tag exist locally. Push them by hand when the network is back:\n'
        + `  git push origin main && git push origin ${tag}`);

const pushedTag = git('push', 'origin', tag);
if (!pushedTag.ok)
    fail('pushing the tag failed' + because(pushedTag)
        + '\n\nThe commit is on GitHub; the tag is not:\n  git push origin ' + tag);
note('main and ' + tag + ' are on GitHub');

if (publishRelease) {
    heading('release');
    const workspace = mkdtempSync(join(tmpdir(), 'flip-release-'));
    const asset = join(workspace, assetName);
    copyFileSync(join(root, 'index.html'), asset);

    const released = run(gh, ['release', 'create', tag, '--title', title, '--notes', notes, '--verify-tag', asset], { stdio: 'inherit' });
    rmSync(workspace, { recursive: true, force: true });

    if (!released.ok)
        fail('the release was not created. The tag is pushed, so you can publish it by hand, or fix the problem and re-run.');
}

console.log('');
console.log(`RESULT: v${version} is released${publishRelease ? '' : ' (tag only, no GitHub release)'}`);
console.log(`  https://github.com/simonroamingx-coder/flip-fluid/releases/tag/${tag}`);
