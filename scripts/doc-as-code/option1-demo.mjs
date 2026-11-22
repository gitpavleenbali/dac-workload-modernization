#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const demoRoot = path.resolve(repoRoot, '..', 'dac-option1-demo');
const proposalRef = 'origin/feat/modernize-vm-to-aks';
const baselineRef = 'origin/main';
const docPaths = ['README.md', 'docs/architecture.md'];

function run(command, args, { cwd = repoRoot, allowFailure = false, print = true } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (print && result.stdout) process.stdout.write(result.stdout);
  if (print && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
  return result;
}

function git(args, options) {
  return run('git', ['--no-pager', ...args], options);
}

function normalized(value) {
  const absolute = path.resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function registeredWorktrees() {
  const output = git(['worktree', 'list', '--porcelain'], { print: false }).stdout;
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

function isRegisteredDemo() {
  return registeredWorktrees().some((worktree) => normalized(worktree) === normalized(demoRoot));
}

function changedPaths() {
  if (!isRegisteredDemo()) return [];
  return git(['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: demoRoot,
    print: false
  }).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, '').replaceAll('\\', '/'));
}

function assertSafeToReplace() {
  const unexpected = changedPaths().filter((file) => !docPaths.includes(file));
  if (unexpected.length) {
    throw new Error(
      `Refusing to reset ${demoRoot}. It contains unexpected changes:\n- ${unexpected.join('\n- ')}`
    );
  }
}

function assertRef(ref) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], { print: false });
}

function removeDemo() {
  if (isRegisteredDemo()) {
    assertSafeToReplace();
    git(['worktree', 'remove', '--force', demoRoot]);
    git(['worktree', 'prune']);
    return true;
  }
  if (fs.existsSync(demoRoot)) {
    throw new Error(
      `Refusing to remove ${demoRoot} because it exists but is not a registered Git worktree.`
    );
  }
  return false;
}

function translator(command, { allowFailure = false, print = true } = {}) {
  return run(
    process.execPath,
    ['packages/dac-translator/bin/dac-translator.mjs', command],
    { cwd: demoRoot, allowFailure, print }
  );
}

function prepare() {
  assertRef(baselineRef);
  assertRef(proposalRef);
  removeDemo();

  git(['worktree', 'add', '--detach', demoRoot, proposalRef]);
  git(['restore', `--source=${baselineRef}`, '--worktree', '--', ...docPaths], { cwd: demoRoot });

  console.log('\n=== OPTION 1 · PREPARE ===');
  console.log('AKS proposal code is now paired with the old VM documentation.');
  console.log('The next check is expected to fail.\n');

  const verification = translator('verify', { allowFailure: true, print: false });
  const combined = `${verification.stdout}\n${verification.stderr}`;
  if (verification.status === 0 || !combined.includes('stale generated Markdown')) {
    throw new Error('Expected the stale-document check to fail, but it did not fail as expected.');
  }
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);

  console.log('\nEXPECTED RESULT: PASS');
  console.log('The verifier caught stale README.md and docs/architecture.md.');
  console.log('\nSHOW: the two "stale generated Markdown" messages above.');
  console.log('NEXT: npm run demo:option1:render');
}

function render() {
  if (!isRegisteredDemo()) {
    throw new Error('Run npm run demo:option1:prepare first.');
  }
  assertSafeToReplace();

  console.log('\n=== OPTION 1 · RENDER ===');
  translator('render');
  const verification = translator('verify');
  const testFiles = [
    ...fs.readdirSync(path.join(demoRoot, 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('test', file)),
    ...fs.readdirSync(path.join(demoRoot, 'packages', 'dac-translator', 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('packages', 'dac-translator', 'test', file))
  ];
  run(process.execPath, ['--test', ...testFiles], { cwd: demoRoot });

  console.log('\n=== FILES UPDATED IN PLACE ===');
  git(['diff', '--stat', baselineRef, '--', ...docPaths], { cwd: demoRoot });
  git(['status', '--short', '--', ...docPaths], { cwd: demoRoot });

  const readme = fs.readFileSync(path.join(demoRoot, 'README.md'), 'utf8');
  const hosting = readme.match(/^\| \*\*Hosting Paradigm\*\* \| (.+) \|$/m)?.[1] || 'not found';
  const verified = JSON.parse(verification.stdout);

  console.log('\nEXPECTED RESULT: PASS');
  console.log(`Hosting shown in README: ${hosting}`);
  console.log(
    `Verified: ${verified.verifiedFiles} files · ${verified.verifiedMermaidBlocks} Mermaid blocks`
  );
  console.log('\nSHOW IN VS CODE:');
  console.log('1. Explorer > dac-option1-demo > README.md > Open Preview.');
  console.log('2. Point to Hosting Paradigm and the AKS Mermaid diagram.');
  console.log('3. Open docs/architecture.md and show that the same existing file changed.');
  console.log('\nDO NOT PUSH this disposable checkout.');
  console.log('NEXT ONLINE: run the workload workflow with "Update the central docs PR" checked.');
  console.log('CLEAN LATER: npm run demo:option1:clean');
}

function clean() {
  const removed = removeDemo();
  console.log(
    removed
      ? `Removed the disposable Option 1 checkout: ${demoRoot}`
      : 'The disposable Option 1 checkout is already absent.'
  );
}

function help() {
  console.log(`Option 1 workshop helper

Run these commands from the workload repository:
  npm run demo:option1:prepare  # create AKS code + stale VM docs; show expected failure
  npm run demo:option1:render   # regenerate, verify, test, and print what to show
  npm run demo:option1:clean    # safely remove only the disposable checkout
`);
}

const command = process.argv[2] || 'help';
if (command === 'prepare') prepare();
else if (command === 'render') render();
else if (command === 'clean') clean();
else if (command === 'help' || command === '--help' || command === '-h') help();
else throw new Error(`Unknown Option 1 demo command: ${command}`);
