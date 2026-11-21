#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildArchitectureIR,
  computeArchitectureDelta,
  renderAllDocumentation,
  validateMarkdownMermaidBlocks,
  verifyManagedBlocksAndHumanProse,
  generateGroundedAiNarrative,
  formatSyncPullRequestBody,
  publishCentralDocsPullRequest
} from '../src/index.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function detectGitSha(repoRoot) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.BUILD_SOURCEVERSION) return process.env.BUILD_SOURCEVERSION;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local-dev';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  const repoRoot = path.resolve(args.repo || process.cwd());
  const sourceCommit = args.sha || detectGitSha(repoRoot);
  const sourceRepo = args['source-repo'] || process.env.GITHUB_REPOSITORY || process.env.BUILD_REPOSITORY_NAME || undefined;

  if (command === 'extract') {
    const ir = buildArchitectureIR(repoRoot, { sourceCommit, sourceRepo });
    const json = JSON.stringify(ir, null, 2);
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(path.resolve(args.out), json + '\n', 'utf8');
      console.log(`Extracted ArchitectureIR (${ir.hostingModel}, ${ir.nodes.length} nodes, hash=${ir.semanticHash.slice(0, 12)}) -> ${args.out}`);
    } else {
      console.log(json);
    }
    return;
  }

  if (command === 'diff') {
    if (!args.before || !args.after) {
      throw new Error('Usage: dac-translator diff --before <before-ir.json> --after <after-ir.json> [--out <delta.json>] [--summary-md <summary.md>]');
    }
    const beforeIR = fs.existsSync(path.resolve(args.before))
      ? JSON.parse(fs.readFileSync(path.resolve(args.before), 'utf8'))
      : null;
    const afterIR = JSON.parse(fs.readFileSync(path.resolve(args.after), 'utf8'));
    const delta = computeArchitectureDelta(beforeIR, afterIR);
    if (args.out) {
      fs.writeFileSync(path.resolve(args.out), JSON.stringify(delta, null, 2) + '\n', 'utf8');
    }
    if (args['summary-md']) {
      const narrativeResult = await generateGroundedAiNarrative(delta, afterIR, {
        disableNetwork: !args['ai-enrich']
      });
      const md = formatSyncPullRequestBody({ afterIR, delta, narrativeResult });
      fs.writeFileSync(path.resolve(args['summary-md']), md + '\n', 'utf8');
    }
    console.log(JSON.stringify(delta, null, 2));
    return;
  }

  if (command === 'render') {
    const ir = args.ir
      ? JSON.parse(fs.readFileSync(path.resolve(args.ir), 'utf8'))
      : buildArchitectureIR(repoRoot, { sourceCommit, sourceRepo });
    const centralDocsRoot = args['central-docs'] ? path.resolve(args['central-docs']) : null;
    const { updatedFiles } = renderAllDocumentation({ repoRoot, centralDocsRoot, ir });
    console.log(
      JSON.stringify(
        {
          ok: true,
          hostingModel: ir.hostingModel,
          semanticHash: ir.semanticHash,
          updatedCount: updatedFiles.length,
          updatedFiles
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'verify') {
    const ir = buildArchitectureIR(repoRoot, { sourceCommit, sourceRepo });
    const targets = [
      path.join(repoRoot, 'README.md'),
      path.join(repoRoot, 'docs', 'architecture.md')
    ];
    if (args['central-docs']) {
      const pDir = path.join(path.resolve(args['central-docs']), ir.service.centralDocsProductPath);
      for (const f of ['architecture.md', 'admin-guide.md', 'user-guide.md', 'contributor-guide.md']) {
        targets.push(path.join(pDir, f));
      }
    }

    const errors = [];
    let totalMermaidBlocks = 0;
    for (const file of targets) {
      if (!fs.existsSync(file)) {
        errors.push(`Missing expected documentation file: ${file}`);
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const mRes = validateMarkdownMermaidBlocks(text, path.relative(process.cwd(), file));
      totalMermaidBlocks += mRes.mermaidBlockCount;
      if (!mRes.valid) errors.push(...mRes.errors);
      const bRes = verifyManagedBlocksAndHumanProse(null, text, path.relative(process.cwd(), file));
      if (!bRes.valid) errors.push(...bRes.errors);
    }

    if (errors.length > 0) {
      console.error(JSON.stringify({ ok: false, errors }, null, 2));
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          serviceId: ir.service.id,
          hostingModel: ir.hostingModel,
          semanticHash: ir.semanticHash,
          verifiedFiles: targets.length,
          verifiedMermaidBlocks: totalMermaidBlocks
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'sync-central-pr') {
    const centralRepoSlug = args['central-repo'] || process.env.DAC_CENTRAL_REPO;
    const token = args.token || process.env.DAC_CENTRAL_DOCS_TOKEN || process.env.GITHUB_TOKEN;
    const beforeIrPath = args['before-ir'] ? path.resolve(args['before-ir']) : null;
    const beforeIR = beforeIrPath && fs.existsSync(beforeIrPath)
      ? JSON.parse(fs.readFileSync(beforeIrPath, 'utf8'))
      : null;

    const afterIR = buildArchitectureIR(repoRoot, { sourceCommit, sourceRepo });
    const delta = computeArchitectureDelta(beforeIR, afterIR);

    if (beforeIR && !delta.hasArchitecturalChanges && !args.force) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: 'Semantic IR hash unchanged; zero PR noise.' }));
      return;
    }

    const narrativeResult = await generateGroundedAiNarrative(delta, afterIR, {
      token: process.env.MODELS_TOKEN || process.env.GITHUB_TOKEN || token,
      disableNetwork: !args['ai-enrich']
    });

    const prTitle = delta.hostingChanged
      ? `[DaC Sync] ${afterIR.service.name}: modernize architecture (${delta.hostingTransition})`
      : `[DaC Sync] ${afterIR.service.name}: update architecture & guides (${afterIR.sourceCommit.slice(0, 7)})`;

    const prBody = formatSyncPullRequestBody({
      afterIR,
      delta,
      narrativeResult,
      updatedRelPaths: [
        `${afterIR.service.centralDocsProductPath}/architecture.md`,
        `${afterIR.service.centralDocsProductPath}/admin-guide.md`,
        `${afterIR.service.centralDocsProductPath}/user-guide.md`,
        `${afterIR.service.centralDocsProductPath}/contributor-guide.md`,
        `${afterIR.service.centralDocsProductPath}/dac-provenance.json`,
        'README.md'
      ]
    });

    const result = await publishCentralDocsPullRequest({
      centralRepoSlug,
      token,
      baseBranch: args['base-branch'] || 'main',
      syncBranch: args['sync-branch'] || `dac-sync/${afterIR.service.id}`,
      ir: afterIR,
      prTitle,
      prBody,
      draft: Boolean(args.draft)
    });

    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  console.log(`dac-translator — Portable Docs-as-Code Architecture Translator & Renderer

Commands:
  dac-translator extract [--repo <dir>] [--out <ir.json>]
  dac-translator diff --before <irA.json> --after <irB.json> [--out <delta.json>] [--summary-md <pr.md>] [--ai-enrich]
  dac-translator render [--repo <dir>] [--central-docs <dir>]
  dac-translator verify [--repo <dir>] [--central-docs <dir>]
  dac-translator sync-central-pr --central-repo <owner/repo> [--before-ir <ir.json>] [--ai-enrich] [--draft]
`);
}

main().catch((err) => {
  console.error(`[dac-translator] ERROR: ${err.message}`);
  process.exit(1);
});
