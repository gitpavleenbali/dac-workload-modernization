import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderAllDocumentation } from '../renderers/markdown-renderer.mjs';
import { validateMarkdownMermaidBlocks, verifyManagedBlocksAndHumanProse } from '../validators/mermaid-validator.mjs';

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Portable Cross-Repo PR Publisher.
 * Uses git + Node native fetch against GitHub REST API so it runs identically
 * on GitHub Actions runners, Azure DevOps Microsoft-hosted/self-hosted agents,
 * and developer workstations without requiring the `gh` CLI binary.
 */
export async function publishCentralDocsPullRequest({
  centralRepoSlug,
  token,
  baseBranch = 'main',
  syncBranch,
  ir,
  prTitle,
  prBody,
  draft = false
}) {
  if (!centralRepoSlug || !centralRepoSlug.includes('/')) {
    throw new Error(`Invalid centralRepoSlug "${centralRepoSlug}". Expected "owner/repo".`);
  }
  if (!token) {
    throw new Error('Missing GitHub token for cross-repo documentation PR publication.');
  }

  const branchName = syncBranch || `dac-sync/${ir.service.id}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-central-sync-'));

  try {
    const authedUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${centralRepoSlug}.git`;
    runGit(['clone', '--branch', baseBranch, '--single-branch', authedUrl, tmpDir], process.cwd());
    runGit(['config', 'user.name', 'dac-translator[bot]'], tmpDir);
    runGit(['config', 'user.email', 'dac-translator-bot@users.noreply.github.com'], tmpDir);
    runGit(['checkout', '-B', branchName], tmpDir);

    // Snapshot original Markdown files to enforce byte-for-byte human prose preservation
    const productDir = path.join(tmpDir, ir.service.centralDocsProductPath);
    const mdTargets = ['architecture.md', 'admin-guide.md', 'user-guide.md', 'contributor-guide.md'];
    const originals = new Map();
    for (const file of mdTargets) {
      const full = path.join(productDir, file);
      if (fs.existsSync(full)) originals.set(full, fs.readFileSync(full, 'utf8'));
    }

    const { updatedFiles } = renderAllDocumentation({
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'dac-noop-local-')),
      centralDocsRoot: tmpDir,
      ir
    });
    void updatedFiles;

    // Gate: Validate Mermaid syntax + Human Prose preservation before committing!
    const gateErrors = [];
    for (const file of mdTargets) {
      const full = path.join(productDir, file);
      if (!fs.existsSync(full)) continue;
      const afterText = fs.readFileSync(full, 'utf8');
      const mermaidCheck = validateMarkdownMermaidBlocks(afterText, file);
      if (!mermaidCheck.valid) gateErrors.push(...mermaidCheck.errors);
      if (originals.has(full)) {
        const proseCheck = verifyManagedBlocksAndHumanProse(originals.get(full), afterText, file);
        if (!proseCheck.valid) gateErrors.push(...proseCheck.errors);
      }
    }
    if (gateErrors.length > 0) {
      throw new Error(`Central Docs Quality Gate blocked publication:\n${gateErrors.join('\n')}`);
    }

    const status = runGit(['status', '--porcelain'], tmpDir);
    if (!status) {
      return { changed: false, message: 'Central documentation is already in sync with source IR.' };
    }

    const changedRelFiles = status
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\S+\s+/, '').trim())
      .filter(Boolean);

    runGit(['add', '-A'], tmpDir);
    runGit(
      [
        'commit',
        '-m',
        `docs(${ir.service.id}): sync architecture & guides from ${ir.sourceRepo}@${ir.sourceCommit.slice(0, 7)}`
      ],
      tmpDir
    );
    runGit(['push', '--force', 'origin', `HEAD:refs/heads/${branchName}`], tmpDir);

    const [owner] = centralRepoSlug.split('/');
    const apiBase = `https://api.github.com/repos/${centralRepoSlug}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dac-translator/1.0.0'
    };

    // Check if an open rolling PR already exists for this branch
    const existingResp = await fetch(
      `${apiBase}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branchName}`)}&base=${encodeURIComponent(baseBranch)}`,
      { headers }
    );
    if (!existingResp.ok) {
      throw new Error(`Failed querying existing PRs: HTTP ${existingResp.status} ${await existingResp.text()}`);
    }
    const existingPrs = await existingResp.json();

    if (Array.isArray(existingPrs) && existingPrs.length > 0) {
      const pr = existingPrs[0];
      const patchResp = await fetch(`${apiBase}/pulls/${pr.number}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: prTitle, body: prBody })
      });
      if (!patchResp.ok) {
        throw new Error(`Failed updating PR #${pr.number}: HTTP ${patchResp.status}`);
      }
      const updatedPr = await patchResp.json();
      return {
        changed: true,
        action: 'updated',
        prNumber: updatedPr.number,
        prUrl: updatedPr.html_url,
        branch: branchName,
        changedFiles: changedRelFiles
      };
    }

    const createResp = await fetch(`${apiBase}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: prTitle,
        head: branchName,
        base: baseBranch,
        body: prBody,
        draft
      })
    });
    if (!createResp.ok) {
      throw new Error(`Failed creating PR: HTTP ${createResp.status} ${await createResp.text()}`);
    }
    const createdPr = await createResp.json();
    return {
      changed: true,
      action: 'created',
      prNumber: createdPr.number,
      prUrl: createdPr.html_url,
      branch: branchName,
      changedFiles: changedRelFiles
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
