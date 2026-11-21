/**
 * Sanitize Mermaid node IDs and escape label strings so GitHub, Azure DevOps,
 * MkDocs, and Mermaid v10/v11 always parse cleanly without bracket/paren errors.
 */
export function safeMermaidId(raw) {
  return String(raw).replace(/[^A-Za-z0-9_]/g, '_');
}

export function safeMermaidLabel(raw) {
  return String(raw)
    .replace(/"/g, "'")
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, '<br/>');
}

/**
 * Compile the Landing Zone & Network Topology diagram (flowchart TB) from Canonical IR.
 */
export function renderTopologyMermaid(ir) {
  const lines = [];
  lines.push('flowchart TB');
  lines.push('  ext_clients(["External Consumers & Grid Sensors"])');

  if (ir.network?.hubPeering) {
    const hubName = safeMermaidLabel(ir.network.hubPeering.hubVnet);
    lines.push('  subgraph sg_hub["Hub Connectivity Landing Zone"]');
    lines.push(`    hub_vnet["Hub VNet & Central Firewall<br/>${hubName}"]`);
    lines.push('  end');
  }

  const rgTitle = safeMermaidLabel(
    `Landing Zone: ${ir.service.landingZone} (${ir.service.resourceGroup} - ${ir.service.region})`
  );
  lines.push(`  subgraph sg_rg["${rgTitle}"]`);

  const vnetLabel = ir.network?.vnetName
    ? `${ir.network.vnetName} (${(ir.network.addressSpace || []).join(', ')})`
    : 'Spoke Virtual Network';
  lines.push(`    subgraph sg_vnet["Spoke VNet: ${safeMermaidLabel(vnetLabel)}"]`);

  // Group nodes placed inside subnets vs RG-scoped services
  const subnets = ir.network?.subnets || [];
  const placedNodeIds = new Set();

  for (const sub of subnets) {
    const subId = safeMermaidId(`sg_${sub.name}`);
    const nsgSuffix = sub.nsg ? ` • NSG: ${sub.nsg}` : '';
    lines.push(`      subgraph ${subId}["Subnet: ${safeMermaidLabel(`${sub.name} (${sub.cidr}${nsgSuffix})`)}"]`);
    const subNodes = (ir.nodes || []).filter((n) => n.subnet === sub.name);
    if (subNodes.length === 0) {
      const placeholderId = safeMermaidId(`net_${sub.name}`);
      lines.push(`        ${placeholderId}["Delegated / Reserved Subnet<br/>${safeMermaidLabel(sub.cidr)}"]`);
    } else {
      for (const n of subNodes) {
        lines.push(`        ${formatMermaidNode(n)}`);
        placedNodeIds.add(n.id);
      }
    }
    lines.push('      end');
  }

  lines.push('    end');

  // RG-scoped nodes not directly bound inside a single subnet (e.g., Log Analytics, Managed Identity, Node Pools)
  const rgScopedNodes = (ir.nodes || []).filter((n) => !placedNodeIds.has(n.id));
  if (rgScopedNodes.length > 0) {
    lines.push('    subgraph sg_platform["Control Plane, Identity & Observability"]');
    for (const n of rgScopedNodes) {
      lines.push(`      ${formatMermaidNode(n)}`);
    }
    lines.push('    end');
  }

  lines.push('  end');

  // Hub-Spoke peering edge
  if (ir.network?.hubPeering) {
    const firstNode = ir.nodes.find((n) => n.category === 'compute') || ir.nodes[0];
    if (firstNode) {
      lines.push(`  ${safeMermaidId(firstNode.id)} -.->|"VNet Peering / Egress"| hub_vnet`);
    }
  }

  // Deduplicate edges cleanly between pairs
  const pairLabels = new Map();
  for (const rel of ir.relationships || []) {
    const fromId = rel.from === 'ext:clients' ? 'ext_clients' : safeMermaidId(rel.from);
    const toId = rel.to === 'ext:clients' ? 'ext_clients' : safeMermaidId(rel.to);
    const key = `${fromId}-->${toId}`;
    if (!pairLabels.has(key)) {
      pairLabels.set(key, { fromId, toId, kinds: new Set(), labels: [] });
    }
    const entry = pairLabels.get(key);
    entry.kinds.add(rel.kind);
    if (rel.label && !entry.labels.includes(rel.label)) {
      entry.labels.push(rel.label);
    }
  }

  for (const { fromId, toId, kinds, labels } of pairLabels.values()) {
    const arrow = kinds.has('rbac') || kinds.has('telemetry') || kinds.has('identity') ? '-.->' : '-->';
    const combinedLabel = safeMermaidLabel(labels.join(' + '));
    lines.push(`  ${fromId} ${arrow}|"${combinedLabel}"| ${toId}`);
  }

  // Color-coded classes
  lines.push('  classDef compute fill:#e8f4fd,stroke:#0078d4,stroke-width:2px,color:#0f172a;');
  lines.push('  classDef ingress fill:#eef2ff,stroke:#4f46e5,stroke-width:2px,color:#0f172a;');
  lines.push('  classDef containers fill:#f0fdf4,stroke:#15803d,stroke-width:2px,color:#0f172a;');
  lines.push('  classDef data fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#0f172a;');
  lines.push('  classDef messaging fill:#fdf4ff,stroke:#a21caf,stroke-width:2px,color:#0f172a;');
  lines.push('  classDef security fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#0f172a;');
  lines.push('  classDef observability fill:#f1f5f9,stroke:#475569,stroke-width:1.5px,color:#0f172a;');

  for (const n of ir.nodes || []) {
    const allowedClass = new Set([
      'compute',
      'ingress',
      'containers',
      'data',
      'messaging',
      'security',
      'observability'
    ]);
    if (allowedClass.has(n.category)) {
      lines.push(`  class ${safeMermaidId(n.id)} ${n.category};`);
    }
  }

  return lines.join('\n');
}

function formatMermaidNode(node) {
  const id = safeMermaidId(node.id);
  const badgeLine = node.badges?.length ? `<br/>${node.badges.slice(0, 3).join(' • ')}` : '';
  const text = safeMermaidLabel(`${node.displayType}<br/>${node.name} (${node.sku})${badgeLine}`);
  if (node.category === 'data') {
    return `${id}[("${text}")]`;
  }
  return `${id}["${text}"]`;
}

/**
 * Compile the Runtime Traffic & CI/CD Delivery Flow diagram (flowchart LR) from Canonical IR.
 */
export function renderRuntimeAndDeliveryMermaid(ir) {
  const lines = ['flowchart LR'];
  const isAks = ir.hostingModel === 'aks-containerized';
  const primaryWl = ir.workloads?.[0];

  lines.push('  subgraph sg_cicd["Engineering & CI/CD Delivery"]');
  if (isAks) {
    const acrNode = ir.nodes.find((n) => n.role === 'acr');
    const acrLabel = safeMermaidLabel(acrNode ? `${acrNode.name} (${acrNode.sku})` : 'Azure Container Registry');
    lines.push('    dev_commit["Git PR / Commit<br/>Dockerfile + k8s/ + IaC"]');
    lines.push('    ci_build["CI Pipeline<br/>Container Build & Scan"]');
    lines.push(`    acr_reg["${acrLabel}"]`);
    lines.push('    dev_commit --> ci_build -->|"Push Signed Image"| acr_reg');
  } else {
    lines.push('    dev_commit["Git PR / Commit<br/>Node Bundle + systemd + IaC"]');
    lines.push('    ci_build["CI Pipeline<br/>Artifact Tarball & cloud-init"]');
    lines.push('    dev_commit --> ci_build');
  }
  lines.push('  end');

  lines.push('  subgraph sg_runtime["Production Runtime Execution"]');
  lines.push('    api_caller(["API Consumers"])');
  if (isAks) {
    const ingNode = ir.nodes.find((n) => n.role === 'app-gateway');
    const aksNode = ir.nodes.find((n) => n.role === 'aks');
    const wlLabel = safeMermaidLabel(
      primaryWl
        ? `K8s Deployment: ${primaryWl.name}<br/>${primaryWl.replicas}`
        : `AKS Pods (${aksNode?.name || 'aks'})`
    );
    lines.push(`    rt_ingress["${safeMermaidLabel(ingNode?.name || 'Application Gateway Ingress')}"]`);
    lines.push(`    rt_compute["${wlLabel}"]`);
    lines.push('    api_caller -->|"HTTPS 443"| rt_ingress -->|"ClusterIP :8080"| rt_compute');
    lines.push('    acr_reg -.->|"Managed Identity AcrPull"| rt_compute');
  } else {
    const lbNode = ir.nodes.find((n) => n.role === 'load-balancer');
    const vmNode = ir.nodes.find((n) => n.role === 'vm' || n.role === 'vmss');
    const wlLabel = safeMermaidLabel(
      primaryWl
        ? `VM systemd: ${primaryWl.name}<br/>${vmNode?.name || 'Linux VM'} (${vmNode?.sku || 'Standard_D4s_v5'})`
        : 'Linux VM Host'
    );
    lines.push(`    rt_ingress["${safeMermaidLabel(lbNode?.name || 'Azure Standard Load Balancer')}"]`);
    lines.push(`    rt_compute["${wlLabel}"]`);
    lines.push('    api_caller -->|"TCP 443"| rt_ingress -->|"Port 8080"| rt_compute');
    lines.push('    ci_build -.->|"VM Extension / SSH Deploy"| rt_compute');
  }

  const dbNode = ir.nodes.find((n) => n.role === 'postgresql');
  const kvNode = ir.nodes.find((n) => n.role === 'key-vault');
  const sbNode = ir.nodes.find((n) => n.role === 'service-bus');
  if (dbNode) {
    lines.push(`    rt_db[("${safeMermaidLabel(`${dbNode.name}<br/>${dbNode.sku}`)}")]`);
    lines.push('    rt_compute -->|"Private Link :5432"| rt_db');
  }
  if (sbNode) {
    lines.push(`    rt_sb["${safeMermaidLabel(`${sbNode.name}<br/>Service Bus ${sbNode.sku}`)}"]`);
    lines.push('    rt_compute -->|"AMQP/TLS Events"| rt_sb');
  }
  if (kvNode) {
    const secretMech = isAks ? 'Workload Identity CSI' : 'System MI IMDS';
    lines.push(`    rt_kv["${safeMermaidLabel(`${kvNode.name}<br/>Key Vault`)}"]`);
    lines.push(`    rt_compute -.->|"${secretMech}"| rt_kv`);
  }
  lines.push('  end');

  return lines.join('\n');
}
