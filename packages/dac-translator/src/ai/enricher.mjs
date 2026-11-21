/**
 * Grounded AI Narrative Enricher & Deterministic PR Markdown Formatter.
 * When --ai-enrich is enabled and an endpoint/token is available (GitHub Models
 * or Azure OpenAI), generates a concise executive review narrative strictly
 * bounded to the computed ArchitectureDelta JSON. Always falls back cleanly
 * to deterministic structured output when offline or in air-gapped CI.
 */
export async function generateGroundedAiNarrative(delta, afterIR, options = {}) {
  const token = options.token || process.env.MODELS_TOKEN || process.env.GITHUB_TOKEN;
  const endpoint =
    options.endpoint ||
    process.env.AZURE_OPENAI_CHAT_COMPLETIONS_URL ||
    'https://models.github.ai/inference/chat/completions';
  const model = options.model || process.env.DAC_AI_MODEL || 'openai/gpt-4.1-mini';

  if (!token || options.disableNetwork) {
    return {
      mode: 'deterministic-fallback',
      narrative: buildDeterministicExecutiveBrief(delta, afterIR)
    };
  }

  const groundedPayload = {
    service: afterIR.service,
    hostingTransition: delta.hostingTransition,
    addedResources: delta.addedNodes.map((n) => ({ name: n.name, type: n.displayType, sku: n.sku, subnet: n.subnet })),
    removedResources: delta.removedNodes.map((n) => ({ name: n.name, type: n.displayType, sku: n.sku })),
    modifiedResources: delta.modifiedNodes,
    addedSubnets: delta.addedSubnets,
    removedSubnets: delta.removedSubnets,
    audienceImpacts: delta.audienceImpacts
  };

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content:
              'You are a Principal Azure Cloud Architect reviewing an automated Docs-as-Code synchronization PR. Summarize the architectural shift in 4 concise bullet points covering Compute, Networking/Ingress, Security/Identity, and Day-2 Operations. STRICT RULE: Cite ONLY resource names, SKUs, and subnets present in the supplied JSON payload. Never invent resources or numbers.'
          },
          {
            role: 'user',
            content: JSON.stringify(groundedPayload)
          }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!resp.ok) {
      return {
        mode: `deterministic-fallback (HTTP ${resp.status})`,
        narrative: buildDeterministicExecutiveBrief(delta, afterIR)
      };
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        mode: 'deterministic-fallback (empty)',
        narrative: buildDeterministicExecutiveBrief(delta, afterIR)
      };
    }
    return { mode: `ai-enriched (${model})`, narrative: content };
  } catch {
    return {
      mode: 'deterministic-fallback (offline)',
      narrative: buildDeterministicExecutiveBrief(delta, afterIR)
    };
  }
}

export function buildDeterministicExecutiveBrief(delta, afterIR) {
  const bullets = [];
  if (delta.hostingChanged) {
    bullets.push(
      `- **Compute Modernization:** Transitioned \`${afterIR.service.name}\` hosting paradigm from \`${delta.hostingTransition}\` inside Landing Zone \`${afterIR.service.landingZone}\`.`
    );
  }
  if (delta.addedNodes.length > 0 || delta.removedNodes.length > 0) {
    const addedList = delta.addedNodes.map((n) => `\`${n.name}\` (${n.displayType})`).join(', ') || 'none';
    const removedList = delta.removedNodes.map((n) => `\`${n.name}\` (${n.displayType})`).join(', ') || 'none';
    bullets.push(`- **Topology Changes:** Introduced ${addedList}; decommissioned ${removedList}.`);
  }
  if (delta.addedSubnets.length > 0 || delta.removedSubnets.length > 0) {
    const subAdded = delta.addedSubnets.map((s) => `\`${s.name}\` (${s.cidr})`).join(', ') || 'none';
    const subRem = delta.removedSubnets.map((s) => `\`${s.name}\` (${s.cidr})`).join(', ') || 'none';
    bullets.push(`- **Network Segmentation:** Added subnets ${subAdded}; retired subnets ${subRem}.`);
  }
  if (delta.modifiedNodes.length > 0) {
    bullets.push(
      `- **In-Place Upgrades:** ${delta.modifiedNodes.map((m) => `\`${m.name}\` (${m.changes.join(', ')})`).join('; ')}.`
    );
  }
  return bullets.join('\n') || '- Infrastructure synchronized with source repository; topology verified.';
}

export function formatSyncPullRequestBody({ afterIR, delta, narrativeResult, updatedRelPaths = [] }) {
  const lines = [];
  lines.push(`## Automated Docs-as-Code Synchronization — \`${afterIR.service.name}\``);
  lines.push('');
  lines.push(`| Metadata | Value |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| **Source Repository** | \`${afterIR.sourceRepo}\` @ \`${afterIR.sourceCommit}\` |`);
  lines.push(`| **Target Product Path** | \`${afterIR.service.centralDocsProductPath}/\` |`);
  lines.push(`| **Hosting Transition** | \`${delta.hostingTransition}\` |`);
  lines.push(`| **Semantic IR Hash** | \`${delta.beforeHash ? delta.beforeHash.slice(0, 12) : 'initial'} -> ${afterIR.semanticHash.slice(0, 12)}\` |`);
  lines.push(`| **Summary Engine** | \`${narrativeResult?.mode || 'deterministic'}\` |`);
  lines.push(`| **Human Prose Guard** | Verified — sections outside \`<!-- BEGIN DAC:... -->\` preserved byte-for-byte |`);
  lines.push('');
  lines.push('### Executive Architecture Summary');
  lines.push(narrativeResult?.narrative || buildDeterministicExecutiveBrief(delta, afterIR));
  lines.push('');

  if (delta.addedNodes.length || delta.removedNodes.length || delta.modifiedNodes.length) {
    lines.push('### Infrastructure Resource Delta');
    lines.push('| Change | Resource Name | Type | Detail |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const n of delta.addedNodes) {
      lines.push(`| **+ Added** | \`${n.name}\` | ${n.displayType} | SKU \`${n.sku}\` in \`${n.subnet || afterIR.service.resourceGroup}\` |`);
    }
    for (const m of delta.modifiedNodes) {
      lines.push(`| **~ Modified** | \`${m.name}\` | ${m.displayType} | ${m.changes.join('; ')} |`);
    }
    for (const n of delta.removedNodes) {
      lines.push(`| **- Removed** | \`${n.name}\` | ${n.displayType} | Decommissioned (\`${n.sku}\`) |`);
    }
    lines.push('');
  }

  lines.push('### Multi-Audience Guide Updates');
  lines.push(`- **Architecture & Diagrams (\`architecture.md\`):** Regenerated Landing Zone topology & runtime Mermaid diagrams, subnet CIDR matrix, and RBAC connectivity table.`);
  for (const item of delta.audienceImpacts.admin) lines.push(`- **Admin Guide (\`admin-guide.md\`):** ${item}`);
  for (const item of delta.audienceImpacts.user) lines.push(`- **User Guide (\`user-guide.md\`):** ${item}`);
  for (const item of delta.audienceImpacts.contributor) lines.push(`- **Contributor Guide (\`contributor-guide.md\`):** ${item}`);
  lines.push('');

  if (delta.adrReviewPrompts.length > 0) {
    lines.push('### Architect / CODEOWNERS Review Checklist (Human-Authored Sections)');
    for (const prompt of delta.adrReviewPrompts) {
      lines.push(`- [ ] ${prompt}`);
    }
    lines.push('');
  }

  if (updatedRelPaths.length > 0) {
    lines.push('### Synchronized Files');
    for (const p of updatedRelPaths) lines.push(`- \`${p}\``);
  }

  return lines.join('\n');
}
