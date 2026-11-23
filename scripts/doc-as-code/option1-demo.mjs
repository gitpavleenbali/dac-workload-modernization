#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const demoRoot = path.resolve(repoRoot, '..', 'dac-option1-demo');
const baselineRoot = path.resolve(repoRoot, '..', 'dac-option1-vm-baseline');
const proposalRef = 'origin/feat/modernize-vm-to-aks';
const baselineRef = 'origin/main';
const docPaths = ['README.md', 'docs/architecture.md'];
const internalRoot = path.resolve(repoRoot, '..', '.dac-demo.internal');
const irArtifact = path.join(internalRoot, 'artifacts', 'aks-architecture-ir.json');
const demoDelayMs = Number.parseInt(process.env.DAC_DEMO_DELAY_MS || '1100', 10);
const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  blue: '\u001b[94m',
  cyan: '\u001b[96m',
  green: '\u001b[92m',
  yellow: '\u001b[93m'
};

function color(name, value) {
  return colorEnabled ? `${ansi[name]}${value}${ansi.reset}` : value;
}

function pause() {
  if (!Number.isFinite(demoDelayMs) || demoDelayMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, demoDelayMs);
}

function stage(index, total, title, detail) {
  console.log(`\n${color('cyan', `[DAC ${index}/${total}]`)} ${color('bold', title)}`);
  console.log(`  ${color('dim', detail)}`);
  pause();
}

function completed(message) {
  console.log(`  ${color('green', '[DONE]')} ${message}`);
}

function attention(message) {
  console.log(`  ${color('yellow', '[SHOW]')} ${message}`);
}

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

function isRegistered(root) {
  return registeredWorktrees().some((worktree) => normalized(worktree) === normalized(root));
}

function changedPaths(root) {
  if (!isRegistered(root)) return [];
  return git(['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    print: false
  }).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, '').replaceAll('\\', '/'));
}

function assertSafeToReplace(root, allowedPaths = []) {
  const unexpected = changedPaths(root).filter((file) => !allowedPaths.includes(file));
  if (unexpected.length) {
    throw new Error(
      `Refusing to reset ${root}. It contains unexpected changes:\n- ${unexpected.join('\n- ')}`
    );
  }
}

function assertRef(ref) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], { print: false });
}

function removeWorktree(root, allowedPaths = []) {
  if (isRegistered(root)) {
    assertSafeToReplace(root, allowedPaths);
    git(['worktree', 'remove', '--force', root]);
    git(['worktree', 'prune']);
    return true;
  }
  if (fs.existsSync(root)) {
    throw new Error(
      `Refusing to remove ${root} because it exists but is not a registered Git worktree.`
    );
  }
  return false;
}

function translator(command, {
  args = [],
  cwd = demoRoot,
  allowFailure = false,
  print = true
} = {}) {
  return run(
    process.execPath,
    ['packages/dac-translator/bin/dac-translator.mjs', command, ...args],
    { cwd, allowFailure, print }
  );
}

function baseline() {
  assertRef(baselineRef);

  console.log(`\n${color('blue', color('bold', 'OPTION 1 · ESTABLISH THE VM BASELINE'))}`);
  console.log('Presentation pacing is intentional. Set DAC_DEMO_DELAY_MS=0 for instant execution.');

  stage(1, 3, 'RESET BASELINE', 'Remove only the registered disposable VM baseline checkout.');
  removeWorktree(baselineRoot);
  completed('Previous VM baseline checkout cleared safely.');

  stage(2, 3, 'CHECKOUT VM DESIGN', 'Create a detached checkout from origin/main.');
  git(['worktree', 'add', '--detach', baselineRoot, baselineRef]);
  completed(`VM infrastructure code and matching VM documents are ready at ${baselineRoot}.`);

  stage(
    3,
    3,
    'VERIFY BASELINE',
    'Extract the VM architecture and prove the committed documentation already matches it.'
  );
  const verification = translator('verify', { cwd: baselineRoot, print: false });
  const result = JSON.parse(verification.stdout);
  completed(
    `hostingModel=${result.hostingModel}; ${result.verifiedFiles} documents; ` +
    `${result.verifiedMermaidBlocks} Mermaid blocks.`
  );

  console.log('\nSHOW THE COMPLETE VM BEFORE STATE:');
  console.log(`In the current VS Code Explorer, expand: ${baselineRoot}`);
  console.log('1. infra/terraform/main.tf: VM, Load Balancer, and Bastion resources.');
  console.log('2. deploy/systemd/grid-telemetry.service: VM runtime service.');
  console.log('3. README.md Preview: VM hosting table, VM diagram, and systemd/Bastion commands.');
  console.log('4. docs/architecture.md Preview: VM runtime, subnet, and resource inventory.');
  console.log('\nNEXT: npm run demo:option1:prepare');
}

function prepare() {
  assertRef(baselineRef);
  assertRef(proposalRef);

  console.log(`\n${color('blue', color('bold', 'OPTION 1 · PREPARE THE BEFORE STATE'))}`);
  console.log('Presentation pacing is intentional. Set DAC_DEMO_DELAY_MS=0 for instant execution.');

  stage(1, 4, 'RESET', 'Remove only the registered disposable demo checkout.');
  removeWorktree(demoRoot, docPaths);
  completed('Previous demo checkout cleared safely.');

  stage(2, 4, 'CHECKOUT', 'Create a detached checkout containing the AKS proposal code.');
  git(['worktree', 'add', '--detach', demoRoot, proposalRef]);
  completed(`AKS proposal checked out at ${demoRoot}.`);

  stage(3, 4, 'REWIND DOCUMENTATION', 'Restore README.md and docs/architecture.md from the VM baseline.');
  git(['restore', `--source=${baselineRef}`, '--worktree', '--', ...docPaths], { cwd: demoRoot });
  completed('AKS code is now paired with the previous VM documentation.');

  console.log('\n=== OPTION 1 · PREPARE ===');
  console.log('AKS proposal code is now paired with the old VM documentation.');
  console.log('The next check is expected to fail.\n');

  stage(4, 4, 'VALIDATE DRIFT', 'Run the real freshness verifier against the deliberately stale documentation.');
  const verification = translator('verify', { allowFailure: true, print: false });
  const combined = `${verification.stdout}\n${verification.stderr}`;
  if (verification.status === 0 || !combined.includes('stale generated Markdown')) {
    throw new Error('Expected the stale-document check to fail, but it did not fail as expected.');
  }
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);
  completed('The verifier rejected both stale managed documents as expected.');

  console.log('\nEXPECTED RESULT: PASS');
  console.log('The verifier caught stale README.md and docs/architecture.md.');
  console.log('\nSHOW: the two "stale generated Markdown" messages above.');
  console.log('\nUSE THE CURRENT VS CODE EXPLORER:');
  console.log(`Expand: ${demoRoot}`);
  console.log('Do not use the README in dac-workload-modernization; that feature branch already shows AKS.');
  console.log('CONFIRM: Hosting Paradigm is "Azure Virtual Machines (IaaS)" before rendering.');
  console.log('NEXT: npm run demo:option1:render');
}

function render() {
  if (!isRegistered(demoRoot)) {
    throw new Error('Run npm run demo:option1:prepare first.');
  }
  assertSafeToReplace(demoRoot, docPaths);

  console.log(`\n${color('blue', color('bold', 'OPTION 1 · RUN THE DAC STACK'))}`);
  console.log('Presentation pacing is intentional. Every completed stage below performs real work.');

  fs.mkdirSync(path.dirname(irArtifact), { recursive: true });

  stage(
    1,
    6,
    'EXTRACTORS',
    'Read Terraform, Bicep, Dockerfile, Kubernetes manifests, and OpenAPI declarations.'
  );
  translator('extract', { args: ['--out', irArtifact], print: false });
  const ir = JSON.parse(fs.readFileSync(irArtifact, 'utf8'));
  completed(
    `${ir.nodes.length} resources, ${ir.relationships.length} relationships, ` +
    `${ir.network.subnets.length} subnets, ${ir.workloads.length} workload, ` +
    `${ir.apiEndpoints.length} API endpoints.`
  );

  stage(
    2,
    6,
    'ARCHITECTURE IR',
    'Normalize the extracted facts into one validated, host-neutral architecture model.'
  );
  completed(
    `hostingModel=${ir.hostingModel}; semanticHash=${ir.semanticHash.slice(0, 16)}; ` +
    `formats=${ir.iacFormatsDetected.join(', ')}.`
  );

  stage(
    3,
    6,
    'RENDERERS',
    'Replace only the managed Markdown, Mermaid, command, API, subnet, and inventory blocks.'
  );
  translator('render', { args: ['--ir', irArtifact] });
  completed('README.md and docs/architecture.md rendered in place.');

  stage(
    4,
    6,
    'VALIDATORS',
    'Re-extract the architecture, verify managed blocks, and validate every Mermaid block.'
  );
  const verification = translator('verify');
  completed('Generated content matches the source declarations and Mermaid syntax is valid.');

  stage(
    5,
    6,
    'TEST SUITES',
    'Run application and translator tests against the regenerated checkout.'
  );
  const testFiles = [
    ...fs.readdirSync(path.join(demoRoot, 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('test', file)),
    ...fs.readdirSync(path.join(demoRoot, 'packages', 'dac-translator', 'test'))
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => path.join('packages', 'dac-translator', 'test', file))
  ];
  run(process.execPath, ['--test', ...testFiles], { cwd: demoRoot });
  completed(`${testFiles.length} test files completed successfully.`);

  stage(
    6,
    6,
    'PUBLISHER BOUNDARY',
    'Resolve the central documentation destination without publishing during this local rehearsal.'
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(demoRoot, 'dac-manifest.json'), 'utf8'));
  completed(
    `${manifest.sourceRepo} -> ${manifest.centralDocsRepo}/${manifest.centralDocsProductPath}`
  );
  attention('The opt-in GitHub workflow executes the publisher and opens/updates the central docs PR.');

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
  const removedDemo = removeWorktree(demoRoot, docPaths);
  const removedBaseline = removeWorktree(baselineRoot);
  console.log(removedDemo
    ? `Removed the disposable Option 1 checkout: ${demoRoot}`
    : 'The disposable Option 1 checkout is already absent.');
  console.log(removedBaseline
    ? `Removed the disposable VM baseline checkout: ${baselineRoot}`
    : 'The disposable VM baseline checkout is already absent.');
}

function help() {
  console.log(`Option 1 workshop helper

Run these commands from the workload repository:
  npm run demo:option1:baseline # create and verify matching VM code + VM docs
  npm run demo:option1:prepare  # create AKS code + stale VM docs; show expected failure
  npm run demo:option1:render   # regenerate, verify, test, and print what to show
  npm run demo:option1:clean    # safely remove both disposable checkouts
`);
}

const command = process.argv[2] || 'help';
if (command === 'baseline') baseline();
else if (command === 'prepare') prepare();
else if (command === 'render') render();
else if (command === 'clean') clean();
else if (command === 'help' || command === '--help' || command === '-h') help();
else throw new Error(`Unknown Option 1 demo command: ${command}`);
