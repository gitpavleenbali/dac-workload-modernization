import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildArchitectureIR,
  computeArchitectureDelta,
  renderAllDocumentation,
  validateMarkdownMermaidBlocks,
  verifyManagedBlocksAndHumanProse,
  formatSyncPullRequestBody,
  generateGroundedAiNarrative
} from '../packages/dac-translator/src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('Full E2E modernization simulation: scenarios/v1-vm -> scenarios/v2-aks updates local & central docs cleanly', async () => {
  const simRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-workload-'));
  const simCentral = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-central-'));

  try {
    // Seed simRepo with v1-vm baseline
    fs.copyFileSync(path.join(repoRoot, 'dac-manifest.json'), path.join(simRepo, 'dac-manifest.json'));
    fs.cpSync(path.join(repoRoot, 'scenarios', 'v1-vm'), simRepo, { recursive: true });

    // Seed simCentral with catalog README & validator script
    fs.writeFileSync(
      path.join(simCentral, 'README.md'),
      `# Central Docs\n\n<!-- BEGIN DAC:catalog-index -->\n_pending_\n<!-- END DAC:catalog-index -->\n\nHuman governance footer.\n`
    );

    const irVm = buildArchitectureIR(simRepo, {
      sourceCommit: '1111111aaaa',
      sourceRepo: 'gitpavleenbali/dac-workload-modernization'
    });
    assert.equal(irVm.hostingModel, 'virtual-machines');
    renderAllDocumentation({ repoRoot: simRepo, centralDocsRoot: simCentral, ir: irVm });

    const centralProductDir = path.join(simCentral, 'products', 'grid-telemetry-service');
    const vmOriginals = {};
    for (const f of ['architecture.md', 'admin-guide.md', 'user-guide.md', 'contributor-guide.md']) {
      vmOriginals[f] = fs.readFileSync(path.join(centralProductDir, f), 'utf8');
    }

    // Apply v2-aks modernization onto simRepo (removing VM systemd/cloud-init)
    fs.rmSync(path.join(simRepo, 'deploy'), { recursive: true, force: true });
    fs.cpSync(path.join(repoRoot, 'scenarios', 'v2-aks'), simRepo, { recursive: true });

    const irAks = buildArchitectureIR(simRepo, {
      sourceCommit: '2222222bbbb',
      sourceRepo: 'gitpavleenbali/dac-workload-modernization'
    });
    assert.equal(irAks.hostingModel, 'aks-containerized');

    const delta = computeArchitectureDelta(irVm, irAks);
    assert.equal(delta.hostingTransition, 'virtual-machines -> aks-containerized');
    assert.equal(
      delta.addedNodes.length,
      7,
      'Should add AKS, Node Pool, ACR, App Gateway, Service Bus, Managed Redis, and UAMI'
    );

    renderAllDocumentation({ repoRoot: simRepo, centralDocsRoot: simCentral, ir: irAks });

    // Verify all 4 central guides + 2 local docs pass Mermaid + Human Prose preservation!
    for (const f of ['architecture.md', 'admin-guide.md', 'user-guide.md', 'contributor-guide.md']) {
      const afterMd = fs.readFileSync(path.join(centralProductDir, f), 'utf8');
      assert.equal(validateMarkdownMermaidBlocks(afterMd, f).valid, true);
      assert.equal(verifyManagedBlocksAndHumanProse(vmOriginals[f], afterMd, f).valid, true);
    }

    // Verify specific content shifts across all 4 guides!
    assert.match(fs.readFileSync(path.join(centralProductDir, 'architecture.md'), 'utf8'), /aks-grid-telemetry-prod/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'architecture.md'), 'utf8'), /redis-grid-hotstate/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'admin-guide.md'), 'utf8'), /az aks get-credentials/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'admin-guide.md'), 'utf8'), /az redis show/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'user-guide.md'), 'utf8'), /\/v1\/telemetry\/batch/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'user-guide.md'), 'utf8'), /redis-grid-hotstate/);
    assert.match(fs.readFileSync(path.join(centralProductDir, 'contributor-guide.md'), 'utf8'), /acrgridtelemetryprod\.azurecr\.io/);
    assert.match(fs.readFileSync(path.join(simRepo, 'README.md'), 'utf8'), /Azure Kubernetes Service \(Cloud-Native Containers\)/);

    const narrativeResult = await generateGroundedAiNarrative(delta, irAks, { disableNetwork: true });
    const prBody = formatSyncPullRequestBody({ afterIR: irAks, delta, narrativeResult });
    assert.match(prBody, /virtual-machines -> aks-containerized/);
    assert.match(prBody, /ADR/);
  } finally {
    fs.rmSync(simRepo, { recursive: true, force: true });
    fs.rmSync(simCentral, { recursive: true, force: true });
  }
  void execFileSync;
});
