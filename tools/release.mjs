// Cut a version.
//
//   node tools/release.mjs 1.2.0 --prepare   the half that needs no network:
//                                            bump, rebuild, verify, commit, tag
//   node tools/release.mjs --publish         the half that does: push, release
//   node tools/release.mjs 1.2.0             both, in that order
//
// The split exists because the two halves fail for different reasons. Preparing is
// local and repeatable. Publishing needs the network, and a push that fails used to
// leave the tool unusable: the tag existed, so the version checks refused to run
// again, and nothing could finish the job. Now the local half can be run, retried
// and looked at for as long as it takes, and the publish half is a named operation
// that can be re-run after a network drop without preparing anything twice.
//
// Flags:
//   --prepare     the local half only
//   --publish     the network half only; the version may be left out, and the most
//                 recent version tag is published
//   --dry-run     print the plan and change nothing
//   --yes         no confirmation prompt
//   --no-release  with the publish half: push, but do not create the GitHub release
//
// What it will not do: invent release notes. The `## vX.Y.Z` section of
// CHANGELOG.md has to exist first, because those lines are the release notes and
// release notes are writing.

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

const usage = 'usage: node tools/release.mjs [version] [--prepare | --publish] [--dry-run] [--yes] [--no-release]';

if (flags.has('--prepare') && flags.has('--publish'))
    fail('--prepare and --publish are the two halves of one release. Run one, or neither for both.');

const mode = flags.has('--publish') ? 'publish' : flags.has('--prepare') ? 'prepare' : 'both';
const isPreparing = mode !== 'publish';
const isPublishing = mode !== 'prepare';

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

// gh is installed to Program Files and may not be on the PATH of a shell that was
// already open when it was installed.
function resolveGh()
{
    for (const candidate of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) {
        const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
        if (!result.error && result.status === 0)
            return candidate;
    }
    return null;
}

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

// --------------------------------------------------------------- which version

const versionFile = join(root, 'src', 'version.js');
const versionSource = readFileSync(versionFile, 'utf8');
const currentVersion = versionSource.match(/VERSION = '([^']+)'/)?.[1];

if (!currentVersion)
    fail('could not read VERSION from src/version.js');

function latestVersionTag()
{
    const result = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*');
    const tag = result.stdout.trim();

    if (!result.ok || !/^v\d+\.\d+\.\d+$/.test(tag)) {
        fail('no version tag to publish. Pass one explicitly: node tools/release.mjs 1.2.0 --publish');
    }

    return tag.slice(1);
}

// Publishing without a version means the most recent tag, which is what you want
// after a --prepare whose push failed: one command, nothing to remember.
const version = positional[0] ?? (isPublishing && !isPreparing ? latestVersionTag() : null);

if (!version)
    fail(usage);
if (!/^\d+\.\d+\.\d+$/.test(version))
    fail(`"${version}" is not a version number.\n\n${usage}`);

const tag = 'v' + version;
const comparison = compareVersions(version, currentVersion);
const tagExists = git('rev-parse', '--verify', '--quiet', 'refs/tags/' + tag).ok;

if (isPreparing) {
    // Three cases, and the middle one is why this is not a simple comparison: the
    // version may already be set in the code with no tag for it yet, because it was
    // bumped when the work started rather than when it finished. That is a release
    // waiting to happen rather than a mistake, so the bump becomes a no-op.
    if (comparison < 0)
        fail(`src/version.js says ${currentVersion}, which is ahead of ${version}. Nothing to release.`);
    if (comparison === 0 && tagExists)
        fail(`${tag} is already tagged. Pick a higher version.`);
} else if (!tagExists) {
    fail(`there is no ${tag} to publish.\n\nRun the local half first:\n  node tools/release.mjs ${version} --prepare`);
}

// ------------------------------------------------------------------ the checks

heading(`checks${mode === 'both' ? '' : ' for ' + mode}`);

if (isPreparing) {
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
}

// Best effort: if there is no network, fall back to the refs we already have.
const fetched = git('fetch', '--quiet', 'origin');
note(fetched.ok ? 'fetched origin' : 'could not reach origin, using the local remote ref');

const head = git('rev-parse', 'HEAD').stdout.trim();
const remote = git('rev-parse', 'origin/main').stdout.trim();
if (!head || !remote)
    fail('could not resolve HEAD and origin/main');

// Being ahead is fine: publishing pushes the pending commits. Being behind or
// diverged is not, because the release would describe something other than what is
// on GitHub.
if (!git('merge-base', '--is-ancestor', 'origin/main', 'HEAD').ok)
    fail('origin/main is not an ancestor of HEAD: this branch is behind or has diverged.'
        + '\nPull and reconcile first, then release.');

const ahead = git('rev-list', '--count', 'origin/main..HEAD').stdout.trim();
note(ahead === '0'
    ? `up to date with origin/main (${head.slice(0, 7)})`
    : `${ahead} commit(s) ahead of origin/main`);

if (isPreparing && comparison === 0)
    note(`src/version.js already says ${version} and has no tag yet, so this tags and prepares it`);

const section = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
if (!section)
    fail(`CHANGELOG.md has no "## v${version}" section.\n\nAdd it first: those lines become the release notes.`);
note(`CHANGELOG.md has ${tag}: ${section.name}`);

if (/planned|not started|in progress|not released/i.test(section.body))
    note('warning: that changelog entry still reads as unfinished - update it before publishing');

const docs = existsSync(join(root, 'docs'))
    ? readdirSync(join(root, 'docs')).filter(name => name.startsWith('v' + version))
    : [];
note(docs.length
    ? `version document: docs/${docs[0]}`
    : `note: no docs/v${version}-*.md version document`);

let gh = null;
if (isPublishing && publishRelease) {
    gh = resolveGh();
    if (!gh)
        fail('gh is not installed or not on the PATH. Run `gh auth login`, or use --no-release.');

    if (!run(gh, ['auth', 'status']).ok)
        fail('gh is not authenticated. Run `gh auth login`, or use --no-release.');
    note('gh is installed and authenticated');
} else if (isPublishing) {
    note('no GitHub release will be created (--no-release)');
} else {
    note('gh will be checked when you publish');
}

// -------------------------------------------------------------------- the plan

const title = `v${version} - ${section.name}`;
const subject = `v${version}: ${section.name}`;
const assetName = `flip-fluid-v${version}.html`;
const notes = `**Run it:** download \`${assetName}\` below and open it - one self-contained file,`
    + ' no server, nothing to build.\n\n' + section.body;

console.log('');
console.log(`  plan (${mode})`);
console.log('  ' + '-'.repeat(66));

if (isPreparing) {
    console.log('  version      '
        + (comparison === 0 ? `${version} (already set, no tag yet)` : `${currentVersion} -> ${version}`)
        + '   (src/version.js)');
    console.log(`  commit       ${subject}`);
    console.log(`  tag          ${tag}`);
}
if (isPublishing) {
    console.log(`  push         origin main + ${tag}`);
    console.log(`  release      ${publishRelease ? `${title}  with ${assetName}` : 'skipped (--no-release)'}`);
    console.log(`  notes        ${section.body.split('\n').length} lines from CHANGELOG.md`);
}

if (dryRun) {
    console.log('');
    console.log('RESULT: DRY RUN - nothing was changed');
    process.exit(0);
}

if (!assumeYes) {
    if (!process.stdin.isTTY)
        fail('stdin is not a terminal. Pass --yes to confirm, or --dry-run to look first.');

    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(`\n${mode === 'publish' ? 'Publish' : 'Prepare'} ${tag}? [y/N] `);
    readline.close();

    if (!/^y(es)?$/i.test(answer.trim()))
        fail('cancelled. Nothing was changed.');
}

// ----------------------------------------------------------------- the local half

if (isPreparing) {
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

    // When the version was bumped ahead of time and index.html is already current,
    // there is nothing to commit - that is the prepared case, not a failure.
    if (!git('status', '--porcelain').stdout.trim()) {
        note('nothing to commit: the version was already set and index.html already current');
    } else {
        const committed = git('commit', '-m', subject, '-m', section.body);
        if (!committed.ok) {
            const staged = git('status', '--porcelain').stdout.trim();
            fail('git commit failed' + because(committed)
                + (staged ? '\n\nworking tree:\n' + staged : ''));
        }
        note(subject);
    }

    heading('tag');
    if (tagExists) {
        const tagged = git('rev-list', '-n', '1', tag).stdout.trim();
        const now = git('rev-parse', 'HEAD').stdout.trim();
        if (tagged !== now)
            fail(`${tag} already points at ${tagged.slice(0, 7)}, not at HEAD. Move it by hand if that is really what you want.`);
        note(`${tag} already points at HEAD`);
    } else if (!git('tag', '-a', tag, '-m', title).ok) {
        fail('git tag failed');
    } else {
        note(tag + ' created');
    }
}

// --------------------------------------------------------------- the network half

if (isPublishing) {
    heading('push');

    if (ahead !== '0') {
        const pushedMain = git('push', 'origin', 'main');
        if (!pushedMain.ok)
            fail('push failed' + because(pushedMain)
                + '\n\nNothing is half-published: the commits and the tag are local. When the network is back:\n'
                + `  node tools/release.mjs ${version} --publish`);
        note(`main pushed (${ahead} commit(s))`);
    } else {
        note('main is already up to date');
    }

    const pushedTag = git('push', 'origin', tag);
    if (!pushedTag.ok)
        fail('pushing the tag failed' + because(pushedTag)
            + '\n\nThe commits are on GitHub; the tag is not. When the network is back:\n'
            + `  node tools/release.mjs ${version} --publish`);
    note(tag + ' pushed');

    if (publishRelease) {
        heading('release');
        const workspace = mkdtempSync(join(tmpdir(), 'flip-release-'));
        const asset = join(workspace, assetName);
        copyFileSync(join(root, 'index.html'), asset);

        const released = run(gh, ['release', 'create', tag, '--title', title, '--notes', notes, '--verify-tag', asset], { stdio: 'inherit' });
        rmSync(workspace, { recursive: true, force: true });

        if (!released.ok)
            fail('the release was not created. The tag is pushed, so nothing is half-done:\n'
                + `  node tools/release.mjs ${version} --publish`);
    }
}

console.log('');
console.log(`RESULT: ${tag} ${isPublishing ? 'is published' : 'is prepared'}${isPublishing && !publishRelease ? ' (tag only, no GitHub release)' : ''}`);
if (isPreparing && !isPublishing)
    console.log(`  next: push, then run  node tools/release.mjs ${version} --publish`);
if (isPublishing && publishRelease)
    console.log(`  https://github.com/simonroamingx-coder/flip-fluid/releases/tag/${tag}`);
