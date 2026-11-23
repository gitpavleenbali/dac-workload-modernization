#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const evidenceRoot = path.resolve(repoRoot, '..', '.dac-demo.internal', 'option2b-evidence');
const workload = {
  repo: 'gitpavleenbali/dac-workload-modernization',
  run: '44971666753',
  artifact: 'dac-workload-architecture-proposal-1'
};
const central = {
  repo: 'gitpavleenbali/dac-central-platform-docs',
  run: '44972101526',
  artifact: 'dac-central-architecture-proposal-1'
};

function run(command, args, { cwd = repoRoot, print = true } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (print && result.stdout) process.stdout.write(result.stdout);
  if (print && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
  return result;
}

function safeResetEvidence() {
  const expectedParent = path.resolve(repoRoot, '..', '.dac-demo.internal');
  if (path.dirname(evidenceRoot) !== expectedParent || path.basename(evidenceRoot) !== 'option2b-evidence') {
    throw new Error(`Refusing to reset unexpected evidence path: ${evidenceRoot}`);
  }
  if (fs.existsSync(evidenceRoot)) {
    fs.rmSync(evidenceRoot, { recursive: true, force: false });
  }
  fs.mkdirSync(evidenceRoot, { recursive: true });
}

function downloadArtifact(config, folderName) {
  const destination = path.join(evidenceRoot, folderName);
  fs.mkdirSync(destination, { recursive: true });
  run('gh', [
    'run', 'download', config.run,
    '--repo', config.repo,
    '--name', config.artifact,
    '--dir', destination
  ]);
  const patch = path.join(destination, 'architecture.patch');
  if (!fs.existsSync(patch) || fs.statSync(patch).size === 0) {
    throw new Error(`Missing verified architecture.patch in ${destination}.`);
  }
  return patch;
}

function evidence() {
  safeResetEvidence();
  const workloadPatch = downloadArtifact(workload, 'workload');
  const centralPatch = downloadArtifact(central, 'central');

  const workloadText = fs.readFileSync(workloadPatch, 'utf8');
  const centralText = fs.readFileSync(centralPatch, 'utf8');
  if (!workloadText.includes('aks-grid-telemetry-prod') ||
      !centralText.includes('aks-grid-telemetry-prod')) {
    throw new Error('Verified patches do not contain the expected AKS cluster evidence.');
  }

  const summary = [
    'OPTION 2B VERIFIED EVIDENCE',
    '',
    `Workload run: https://github.com/${workload.repo}/actions/runs/${workload.run}`,
    `Workload patch: ${workloadPatch}`,
    '',
    `Central run: https://github.com/${central.repo}/actions/runs/${central.run}`,
    `Central patch: ${centralPatch}`,
    '',
    'These patches are verified review proposals. They were not applied by the agent.'
  ].join('\n');
  fs.writeFileSync(path.join(evidenceRoot, 'README.txt'), `${summary}\n`, 'utf8');

  console.log('\n=== OPTION 2B · VERIFIED AGENTIC WORKFLOW EVIDENCE ===');
  console.log(summary);
  console.log('\nWORKLOAD PATCH:\n');
  console.log(workloadText);
  console.log('\nCENTRAL PATCH:\n');
  console.log(centralText);
}

function clean() {
  safeResetEvidence();
  fs.rmdirSync(evidenceRoot);
  console.log(`Removed local Option 2B evidence: ${evidenceRoot}`);
}

function help() {
  console.log(`Option 2B GitHub Agentic Workflow evidence helper

Run from the workload repository:
  npm run demo:option2b:evidence
  npm run demo:option2b:clean
`);
}

const command = process.argv[2] || 'help';
if (command === 'evidence') evidence();
else if (command === 'clean') clean();
else if (command === 'help' || command === '--help' || command === '-h') help();
else throw new Error(`Unknown Option 2B demo command: ${command}`);
