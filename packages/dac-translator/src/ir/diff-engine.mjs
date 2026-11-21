/**
 * Compute a structured semantic delta between a previous ArchitectureIR (or null)
 * and a new ArchitectureIR. Drives PR summaries, operational runbook guidance,
 * and ADR review prompts.
 */
export function computeArchitectureDelta(beforeIR, afterIR) {
  if (!beforeIR) {
    return {
      isInitialBaseline: true,
      hasArchitecturalChanges: true,
      beforeHash: null,
      afterHash: afterIR.semanticHash,
      hostingTransition: `initial -> ${afterIR.hostingModel}`,
      hostingChanged: true,
      addedNodes: afterIR.nodes,
      removedNodes: [],
      modifiedNodes: [],
      addedSubnets: afterIR.network?.subnets || [],
      removedSubnets: [],
      addedRelationships: afterIR.relationships || [],
      removedRelationships: [],
      workloadChanges: {
        added: afterIR.workloads || [],
        removed: []
      },
      audienceImpacts: buildAudienceImpacts(null, afterIR, afterIR.nodes, [], []),
      adrReviewPrompts: []
    };
  }

  const hasArchitecturalChanges = beforeIR.semanticHash !== afterIR.semanticHash;
  const beforeNodeMap = new Map((beforeIR.nodes || []).map((n) => [n.id, n]));
  const afterNodeMap = new Map((afterIR.nodes || []).map((n) => [n.id, n]));

  const addedNodes = [];
  const removedNodes = [];
  const modifiedNodes = [];

  for (const [id, node] of afterNodeMap.entries()) {
    if (!beforeNodeMap.has(id)) {
      addedNodes.push(node);
    } else {
      const prev = beforeNodeMap.get(id);
      const changes = [];
      if (prev.sku !== node.sku) changes.push(`SKU: ${prev.sku} -> ${node.sku}`);
      if (prev.subnet !== node.subnet) changes.push(`Subnet: ${prev.subnet || 'none'} -> ${node.subnet || 'none'}`);
      const prevBadges = (prev.badges || []).join(', ');
      const nextBadges = (node.badges || []).join(', ');
      if (prevBadges !== nextBadges) changes.push(`Capabilities: [${prevBadges || 'none'}] -> [${nextBadges || 'none'}]`);
      if (changes.length > 0) {
        modifiedNodes.push({ id, name: node.name, displayType: node.displayType, changes });
      }
    }
  }

  for (const [id, node] of beforeNodeMap.entries()) {
    if (!afterNodeMap.has(id)) removedNodes.push(node);
  }

  const beforeSubMap = new Map((beforeIR.network?.subnets || []).map((s) => [s.name, s]));
  const afterSubMap = new Map((afterIR.network?.subnets || []).map((s) => [s.name, s]));
  const addedSubnets = [...afterSubMap.values()].filter((s) => !beforeSubMap.has(s.name));
  const removedSubnets = [...beforeSubMap.values()].filter((s) => !afterSubMap.has(s.name));

  const relKey = (r) => `${r.from}->${r.to}:${r.kind}:${r.label}`;
  const beforeRels = new Map((beforeIR.relationships || []).map((r) => [relKey(r), r]));
  const afterRels = new Map((afterIR.relationships || []).map((r) => [relKey(r), r]));
  const addedRelationships = [...afterRels.entries()].filter(([k]) => !beforeRels.has(k)).map(([, v]) => v);
  const removedRelationships = [...beforeRels.entries()].filter(([k]) => !afterRels.has(k)).map(([, v]) => v);

  const beforeWl = new Map((beforeIR.workloads || []).map((w) => [`${w.kind}:${w.name}`, w]));
  const afterWl = new Map((afterIR.workloads || []).map((w) => [`${w.kind}:${w.name}`, w]));
  const workloadChanges = {
    added: [...afterWl.entries()].filter(([k]) => !beforeWl.has(k)).map(([, v]) => v),
    removed: [...beforeWl.entries()].filter(([k]) => !afterWl.has(k)).map(([, v]) => v)
  };

  const hostingChanged = beforeIR.hostingModel !== afterIR.hostingModel;
  const hostingTransition = hostingChanged
    ? `${beforeIR.hostingModel} -> ${afterIR.hostingModel}`
    : `${afterIR.hostingModel} (unchanged)`;

  const adrReviewPrompts = [];
  if (hostingChanged) {
    adrReviewPrompts.push(
      `Hosting paradigm changed (${beforeIR.hostingModel} -> ${afterIR.hostingModel}): verify and add an ADR entry documenting trade-offs, node-pool sizing rationale, and rollback strategy.`
    );
  }
  for (const n of addedNodes) {
    if (['messaging', 'data', 'containers', 'ingress'].includes(n.category)) {
      adrReviewPrompts.push(
        `New ${n.displayType} ("${n.name}", SKU: ${n.sku}) introduced: confirm capacity, DR/SLA posture, and cost ownership in Architecture Decisions.`
      );
    }
  }
  for (const n of removedNodes) {
    if (n.role === 'bastion' || n.role === 'vm') {
      adrReviewPrompts.push(
        `Decommissioned ${n.displayType} ("${n.name}"): confirm break-glass access and historical log retention compliance.`
      );
    }
  }

  return {
    isInitialBaseline: false,
    hasArchitecturalChanges,
    beforeHash: beforeIR.semanticHash,
    afterHash: afterIR.semanticHash,
    hostingTransition,
    hostingChanged,
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedSubnets,
    removedSubnets,
    addedRelationships,
    removedRelationships,
    workloadChanges,
    audienceImpacts: buildAudienceImpacts(beforeIR, afterIR, addedNodes, removedNodes, modifiedNodes),
    adrReviewPrompts
  };
}

function buildAudienceImpacts(beforeIR, afterIR, addedNodes, removedNodes, modifiedNodes) {
  const admin = [];
  const user = [];
  const contributor = [];

  if (beforeIR && beforeIR.hostingModel !== afterIR.hostingModel) {
    if (afterIR.hostingModel === 'aks-containerized') {
      admin.push(
        'Replace Azure Bastion SSH & systemd maintenance with `az aks get-credentials`, `kubectl`, AKS node-pool upgrades, and Container Insights monitoring.'
      );
      contributor.push(
        'Switch build/release flow from VM cloud-init/systemd packaging to multi-stage Docker builds pushed to Azure Container Registry and deployed via `k8s/` manifests.'
      );
      user.push(
        'Traffic now enters via Layer-7 WAF Application Gateway Ingress with pod horizontal autoscaling and zero-downtime rolling updates.'
      );
    }
  }
  for (const n of addedNodes) {
    if (n.role === 'acr') {
      contributor.push(`Push container images to private registry \`${n.name}\` (${n.sku}); AKS pulls via Managed Identity \`AcrPull\`.`);
    } else if (n.role === 'service-bus') {
      admin.push(`Monitor dead-letter queues and messaging units on \`${n.name}\` (${n.displayType}).`);
      user.push(`Asynchronous telemetry ingestion is now buffered through \`${n.name}\` for burst resiliency.`);
    } else if (n.role === 'managed-identity') {
      admin.push(`Secretless authentication federated via \`${n.name}\` OIDC Workload Identity + Key Vault CSI driver.`);
    }
  }
  for (const m of modifiedNodes) {
    admin.push(`${m.displayType} (\`${m.name}\`) updated: ${m.changes.join('; ')}.`);
  }
  if (removedNodes.some((n) => n.role === 'bastion')) {
    admin.push('Azure Bastion and port-22 SSH paths removed; cluster operations use Entra ID RBAC over AKS API.');
  }

  return { admin, user, contributor };
}
