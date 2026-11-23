#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const demoRoot = path.resolve(repoRoot, '..', 'dac-option2a-agent-demo');
const proposalRef = 'origin/feat/modernize-vm-to-aks';
const baselineRef = 'origin/main';
const expectedPaths = [
  'README.md',
  'docs/architecture.md'
];

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
  return git(['worktree', 'list', '--porcelain'], { print: false }).stdout
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

function isKnownLegacySourceChange(file) {
  const transformations = {
    'deploy/k8s/workloads.yaml': (value) =>
      value.replace(/maxReplicas:\s*24/, 'maxReplicas: 28'),
    'infra/terraform/main.tf': (value) =>
      value.replace(/max_count\s*=\s*20/, 'max_count             = 24')
  };
  const transform = transformations[file];
  if (!transform) return false;
  const base = git(['show', `HEAD:${file}`], { cwd: demoRoot, print: false }).stdout;
  const current = fs.readFileSync(path.join(demoRoot, file), 'utf8');
  const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
  return normalizeNewlines(current) === normalizeNewlines(transform(base));
}

function assertSafeToReplace() {
  const unexpected = changedPaths().filter(
    (file) => !expectedPaths.includes(file) && !isKnownLegacySourceChange(file)
  );
  if (unexpected.length) {
    throw new Error(
      `Refusing to reset ${demoRoot}. It contains unexpected changes:\n- ${unexpected.join('\n- ')}`
    );
  }
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
  git(['rev-parse', '--verify', `${baselineRef}^{commit}`], { print: false });
  git(['rev-parse', '--verify', `${proposalRef}^{commit}`], { print: false });
  removeDemo();
  git(['worktree', 'add', '--detach', demoRoot, proposalRef]);

  git(['restore', `--source=${baselineRef}`, '--worktree', '--', ...expectedPaths], {
    cwd: demoRoot
  });

  const verification = translator('verify', { allowFailure: true, print: false });
  const combined = `${verification.stdout}\n${verification.stderr}`;
  if (verification.status === 0 ||
      !combined.includes('README.md: stale generated Markdown') ||
      !combined.includes('docs\\\\architecture.md: stale generated Markdown')) {
    throw new Error('Expected AKS code paired with VM documents to make both managed documents stale.');
  }

  console.log('\n=== OPTION 2A · PREPARE LOCAL AGENT DEMO ===');
  console.log('AKS proposal code is paired with the old VM README.md and docs/architecture.md.');
  console.log('The local custom agent must understand the mismatch and refresh both existing documents.');
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);
  console.log('\nOPEN THIS CHECKOUT IN A SEPARATE VS CODE WINDOW FOR COPILOT CHAT:');
  console.log(`code -n "${demoRoot}"`);
  console.log('\nNEXT: select the dac-architecture-guardian custom agent in VS Code Chat.');
}

function check() {
  if (!isRegisteredDemo()) {
    throw new Error('Run npm run demo:option2a:prepare first.');
  }
  assertSafeToReplace();
  translator('verify');
  run(process.execPath, [
    '--test',
    ...fs.readdirSync(path.join(demoRoot, 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('test', file)),
    ...fs.readdirSync(path.join(demoRoot, 'packages', 'dac-translator', 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('packages', 'dac-translator', 'test', file))
  ], { cwd: demoRoot });

  const architecture = fs.readFileSync(path.join(demoRoot, 'docs', 'architecture.md'), 'utf8');
  if (!architecture.includes('K8s Deployment: grid-telemetry-api')) {
    throw new Error('docs/architecture.md does not contain the expected AKS runtime update.');
  }
  const readme = fs.readFileSync(path.join(demoRoot, 'README.md'), 'utf8');
  if (!readme.includes('Azure Kubernetes Service (Cloud-Native Containers)') ||
      !readme.includes('aks-grid-telemetry-prod')) {
    throw new Error('README.md does not contain the expected AKS hosting and topology update.');
  }

  console.log('\n=== OPTION 2A · VERIFIED LOCAL AGENT RESULT ===');
  git(['diff', '--stat', baselineRef, '--', ...expectedPaths], { cwd: demoRoot });
  git(['status', '--short', '--', ...expectedPaths], { cwd: demoRoot });
  console.log('\nSHOW:');
  console.log('1. README.md: Hosting Paradigm and topology now show AKS.');
  console.log('2. README.md: deployment commands now use Docker, ACR, and kubectl.');
  console.log('3. docs/architecture.md: runtime, subnet, and resource inventory now show AKS.');
  console.log('4. git diff: the chat agent refreshed both existing documents and did not push.');
}

function clean() {
  const removed = removeDemo();
  console.log(removed
    ? `Removed the disposable Option 2A checkout: ${demoRoot}`
    : 'The disposable Option 2A checkout is already absent.');
}

function help() {
  console.log(`Option 2A local Copilot demo helper

Run these commands from the workload repository:
  npm run demo:option2a:prepare
  # Open the printed checkout in VS Code and run the custom agent in Copilot Chat.
  npm run demo:option2a:check
  npm run demo:option2a:clean
`);
}

const command = process.argv[2] || 'help';
if (command === 'prepare') prepare();
else if (command === 'check') check();
else if (command === 'clean') clean();
else if (command === 'help' || command === '--help' || command === '-h') help();
else throw new Error(`Unknown Option 2A demo command: ${command}`);
