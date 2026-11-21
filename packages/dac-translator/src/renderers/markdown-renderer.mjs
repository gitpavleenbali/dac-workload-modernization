import fs from 'node:fs';
import path from 'node:path';
import { renderTopologyMermaid, renderRuntimeAndDeliveryMermaid } from './mermaid-renderer.mjs';

const HOSTING_LABELS = {
  'virtual-machines': 'Azure Virtual Machines (IaaS)',
  'aks-containerized': 'Azure Kubernetes Service (Cloud-Native Containers)',
  'container-apps': 'Azure Container Apps (Serverless Containers)',
  hybrid: 'Hybrid Compute (VMs + Containers)',
  unknown: 'Custom Azure Infrastructure'
};

/**
 * Replace inner contents of <!-- BEGIN DAC:id ... --> ... <!-- END DAC:id --> blocks
 * without modifying a single byte of human-authored prose outside those markers.
 */
export function upsertManagedBlocks(existingContent, blockMap, provenance = {}) {
  const srcAttr = provenance.sourceRepo ? ` source="${provenance.sourceRepo}@${provenance.sourceCommit || 'HEAD'}"` : '';
  const hashAttr = provenance.semanticHash ? ` irHash="${provenance.semanticHash.slice(0, 12)}"` : '';

  let updated = existingContent;
  for (const [blockId, innerMarkdown] of Object.entries(blockMap)) {
    const blockRe = new RegExp(
      `<!--\\s*BEGIN DAC:${blockId}[^>]*-->[\\s\\S]*?<!--\\s*END DAC:${blockId}\\s*-->`,
      'g'
    );
    const replacement = [
      `<!-- BEGIN DAC:${blockId}${srcAttr}${hashAttr} -->`,
      innerMarkdown.trim(),
      `<!-- END DAC:${blockId} -->`
    ].join('\n');

    if (blockRe.test(updated)) {
      updated = updated.replace(blockRe, () => replacement);
    }
  }
  return updated;
}

function wrapBlock(blockId, innerMarkdown, provenance = {}) {
  const srcAttr = provenance.sourceRepo ? ` source="${provenance.sourceRepo}@${provenance.sourceCommit || 'HEAD'}"` : '';
  const hashAttr = provenance.semanticHash ? ` irHash="${provenance.semanticHash.slice(0, 12)}"` : '';
  return [
    `<!-- BEGIN DAC:${blockId}${srcAttr}${hashAttr} -->`,
    innerMarkdown.trim(),
    `<!-- END DAC:${blockId} -->`
  ].join('\n');
}

function buildResourceTable(ir) {
  const rows = [
    '| Azure Resource Name | Architectural Type | Category | SKU / Sizing | Subnet / Scope | Key Capabilities |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |'
  ];
  for (const n of ir.nodes) {
    const caps = n.badges?.length ? n.badges.join(', ') : 'Standard';
    rows.push(
      `| \`${n.name}\` | ${n.displayType} | \`${n.category}\` | \`${n.sku}\` | \`${n.subnet || ir.service.resourceGroup}\` | ${caps} |`
    );
  }
  return rows.join('\n');
}

function buildSubnetTable(ir) {
  const subnets = ir.network?.subnets || [];
  if (subnets.length === 0) return '_No dedicated subnets declared in IaC._';
  const rows = [
    '| Subnet Name | CIDR Prefix | Attached NSG | Service Delegation | Hosted / Connected Resources |',
    '| :--- | :--- | :--- | :--- | :--- |'
  ];
  for (const s of subnets) {
    const hosted = ir.nodes
      .filter((n) => n.subnet === s.name)
      .map((n) => `\`${n.name}\``)
      .join(', ');
    rows.push(
      `| \`${s.name}\` | \`${s.cidr}\` | \`${s.nsg || 'Platform Default'}\` | \`${s.delegation || 'None'}\` | ${hosted || 'Delegated / Routing'} |`
    );
  }
  return rows.join('\n');
}

function buildEndpointsTable(ir) {
  if (!ir.apiEndpoints?.length) return '_No OpenAPI endpoints detected._';
  const rows = [
    '| HTTP Method | Endpoint Path | Capability Summary |',
    '| :--- | :--- | :--- |'
  ];
  for (const ep of ir.apiEndpoints) {
    rows.push(`| \`${ep.method}\` | \`${ep.path}\` | ${ep.summary || 'Service endpoint'} |`);
  }
  return rows.join('\n');
}

function buildSecurityRbacTable(ir) {
  const rows = [
    '| Source Principal / Origin | Target Resource | Access Type | Mechanism / Protocol |',
    '| :--- | :--- | :--- | :--- |'
  ];
  for (const r of ir.relationships || []) {
    const fromName =
      r.from === 'ext:clients'
        ? 'External API Consumers'
        : ir.nodes.find((n) => n.id === r.from)?.name || r.from;
    const toName = ir.nodes.find((n) => n.id === r.to)?.name || r.to;
    rows.push(`| \`${fromName}\` | \`${toName}\` | ${r.label} | \`${r.protocol || r.kind}\` |`);
  }
  return rows.join('\n');
}

/**
 * Render local repository documentation blocks (README.md + docs/architecture.md)
 */
export function buildLocalRepoBlocks(ir) {
  const prov = { sourceRepo: ir.sourceRepo, sourceCommit: ir.sourceCommit, semanticHash: ir.semanticHash };
  const topologyMermaid = renderTopologyMermaid(ir);
  const runtimeMermaid = renderRuntimeAndDeliveryMermaid(ir);
  const isAks = ir.hostingModel === 'aks-containerized';
  const aksNode = ir.nodes.find((n) => n.role === 'aks');
  const acrNode = ir.nodes.find((n) => n.role === 'acr');
  const vmNode = ir.nodes.find((n) => n.role === 'vm' || n.role === 'vmss');

  const readmeBlocks = {
    'local-hosting-summary': [
      '| Attribute | Current Value (Extracted from IaC & Manifests) |',
      '| :--- | :--- |',
      `| **Service** | **${ir.service.name}** (\`${ir.service.id}\`) |`,
      `| **Hosting Paradigm** | **${HOSTING_LABELS[ir.hostingModel]}** |`,
      `| **Landing Zone / RG** | \`${ir.service.landingZone}\` / \`${ir.service.resourceGroup}\` (\`${ir.service.region}\`) |`,
      `| **IaC Definitions** | ${ir.iacFormatsDetected.map((f) => `\`${f}\``).join(', ')} |`,
      `| **Topology Semantic Hash** | \`${ir.semanticHash.slice(0, 16)}\` |`
    ].join('\n'),
    'local-topology-diagram': `\`\`\`mermaid\n${topologyMermaid}\n\`\`\``,
    'local-build-deploy': isAks
      ? [
          '```bash',
          '# 1. Run application & DaC translator test suites',
          'npm test',
          '',
          `# 2. Build & push container image to Azure Container Registry (${acrNode?.name || 'acr'})`,
          `docker build -t ${acrNode?.name || 'acrgridtelemetryprod'}.azurecr.io/${ir.service.id}:latest .`,
          `az acr login --name ${acrNode?.name || 'acrgridtelemetryprod'}`,
          `docker push ${acrNode?.name || 'acrgridtelemetryprod'}.azurecr.io/${ir.service.id}:latest`,
          '',
          `# 3. Validate Terraform & apply Kubernetes manifests to AKS (${aksNode?.name || 'aks'})`,
          'terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate',
          `az aks get-credentials --resource-group ${ir.service.resourceGroup} --name ${aksNode?.name || 'aks-grid-telemetry-prod'}`,
          'kubectl apply -f deploy/k8s/',
          '```'
        ].join('\n')
      : [
          '```bash',
          '# 1. Run application & DaC translator test suites',
          'npm test',
          '',
          '# 2. Validate Virtual Machine Landing Zone Terraform',
          'terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate',
          '',
          `# 3. Package & deploy systemd service to Linux VM (${vmNode?.name || 'vm-grid-telemetry-01'})`,
          'tar -czf dist-grid-telemetry.tar.gz src/ package.json deploy/systemd/grid-telemetry.service',
          `az network bastion ssh --name bas-grid-ops --resource-group ${ir.service.resourceGroup} --target-resource-id <vm-id> --auth-type AAD`,
          '```'
        ].join('\n'),
    'local-api-endpoints': buildEndpointsTable(ir)
  };

  const localArchBlocks = {
    'local-runtime-diagram': `\`\`\`mermaid\n${runtimeMermaid}\n\`\`\``,
    'local-subnet-table': buildSubnetTable(ir),
    'local-resource-inventory': buildResourceTable(ir)
  };

  return { prov, readmeBlocks, localArchBlocks };
}

/**
 * Render centralized documentation repository blocks across the 4 audience guides:
 * architecture.md, admin-guide.md, user-guide.md, and contributor-guide.md
 */
export function buildCentralRepoBlocks(ir) {
  const prov = { sourceRepo: ir.sourceRepo, sourceCommit: ir.sourceCommit, semanticHash: ir.semanticHash };
  const topologyMermaid = renderTopologyMermaid(ir);
  const runtimeMermaid = renderRuntimeAndDeliveryMermaid(ir);
  const isAks = ir.hostingModel === 'aks-containerized';

  const aksNode = ir.nodes.find((n) => n.role === 'aks');
  const poolNode = ir.nodes.find((n) => n.role === 'aks-node-pool');
  const acrNode = ir.nodes.find((n) => n.role === 'acr');
  const ingNode = ir.nodes.find((n) => n.role === 'app-gateway' || n.role === 'load-balancer');
  const vmNode = ir.nodes.find((n) => n.role === 'vm' || n.role === 'vmss');
  const bastionNode = ir.nodes.find((n) => n.role === 'bastion');
  const dbNode = ir.nodes.find((n) => n.role === 'postgresql');
  const redisNode = ir.nodes.find((n) => n.role === 'redis');
  const kvNode = ir.nodes.find((n) => n.role === 'key-vault');
  const sbNode = ir.nodes.find((n) => n.role === 'service-bus');
  const lawNode = ir.nodes.find((n) => n.role === 'log-analytics');
  const primaryWl = ir.workloads?.[0];

  const architectureBlocks = {
    'arch-executive-summary': [
      '| Architecture Dimension | Current State (Synced from Source IaC) |',
      '| :--- | :--- |',
      `| **Product / Service** | **${ir.service.name}** (\`${ir.service.id}\`) |`,
      `| **Landing Zone** | \`${ir.service.landingZone}\` (\`${ir.service.resourceGroup}\` in \`${ir.service.region}\`) |`,
      `| **Compute Hosting Model** | **${HOSTING_LABELS[ir.hostingModel]}** |`,
      `| **Spoke VNet & Hub Peering** | \`${ir.network.vnetName}\` (${(ir.network.addressSpace || []).join(', ')}) ${ir.network.hubPeering ? `peered to \`${ir.network.hubPeering.hubVnet}\`` : ''} |`,
      `| **Ingress Entrypoint** | \`${ingNode?.name || 'N/A'}\` (${ingNode?.displayType || 'Internal'}, \`${ingNode?.sku || 'Standard'}\`) |`,
      `| **Stateful & Messaging Tier** | \`${dbNode?.name || 'N/A'}\` (${dbNode?.sku || ''})${redisNode ? `, \`${redisNode.name}\` (Redis ${redisNode.sku})` : ''}${sbNode ? `, \`${sbNode.name}\` (Service Bus ${sbNode.sku})` : ''} |`,
      `| **Source Provenance** | \`${ir.sourceRepo}@${ir.sourceCommit}\` • IR Hash \`${ir.semanticHash.slice(0, 12)}\` |`
    ].join('\n'),
    'arch-topology-diagram': `\`\`\`mermaid\n${topologyMermaid}\n\`\`\``,
    'arch-runtime-diagram': `\`\`\`mermaid\n${runtimeMermaid}\n\`\`\``,
    'arch-network-table': buildSubnetTable(ir),
    'arch-resource-inventory': buildResourceTable(ir),
    'arch-security-rbac': buildSecurityRbacTable(ir)
  };

  const adminGuideBlocks = {
    'admin-ops-posture': isAks
      ? [
          `- **Control Plane & Cluster Access:** Private AKS cluster \`${aksNode?.name}\` (${aksNode?.badges.join(', ')}). Direct SSH and Azure Bastion are **decommissioned**; administrators authenticate exclusively with Microsoft Entra ID RBAC.`,
          `- **Workload Scaling & Node Pools:** System pool plus dedicated workload node pool \`${poolNode?.name || 'workload'}\` (\`${poolNode?.sku || 'Standard_D8ds_v5'}\`, ${poolNode?.properties?.autoscale ? `Cluster Autoscaler ${poolNode.properties.autoscale} nodes` : 'autoscaled'}) paired with Kubernetes \`${primaryWl?.replicas || 'HPA'}\`.`,
          `- **Secrets & Identity Management:** Pod-level OIDC Workload Identity mounts secrets from \`${kvNode?.name}\` via the Azure Key Vault CSI Driver—zero static credentials on nodes.`,
          `- **Stateful & Messaging Resilience:** PostgreSQL \`${dbNode?.name}\` (\`${dbNode?.sku}\`${dbNode?.properties?.highAvailability ? `, HA: ${dbNode.properties.highAvailability}` : ''})${redisNode ? `, Azure Managed Redis \`${redisNode.name}\` (\`${redisNode.sku}\`)` : ''}${sbNode ? `, and Service Bus \`${sbNode.name}\` (\`${sbNode.sku}\`) isolated over Private Link` : ''}.`,
          `- **Observability:** Container logs, Prometheus scrape metrics, and control-plane diagnostics stream to Log Analytics \`${lawNode?.name}\`.`
        ].join('\n')
      : [
          `- **Host Management & Administrative Access:** Workload runs as \`systemd\` unit \`${primaryWl?.name || 'grid-telemetry'}.service\` on Linux VM \`${vmNode?.name}\` (\`${vmNode?.sku}\`). Direct public SSH is blocked; administrators connect through Azure Bastion \`${bastionNode?.name}\`.`,
          `- **Traffic & Availability Posture:** Layer-4 TCP distribution via \`${ingNode?.name}\` (\`${ingNode?.displayType}\`). OS patching requires coordinated maintenance windows.`,
          `- **Secrets & Identity Management:** VM System-Assigned Managed Identity retrieves runtime secrets from \`${kvNode?.name}\` over Private Endpoint.`,
          `- **Database Tier:** PostgreSQL Flexible Server \`${dbNode?.name}\` (\`${dbNode?.sku}\`) in \`${dbNode?.subnet || 'snet-data-pe'}\`.`,
          `- **Observability:** Azure Monitor Linux Agent forwards syslog and VM performance counters to \`${lawNode?.name}\`.`
        ].join('\n'),
    'admin-day2-runbook': isAks
      ? [
          '```bash',
          '# 1. Authenticate to Private AKS Cluster via Entra ID',
          `az aks get-credentials --resource-group ${ir.service.resourceGroup} --name ${aksNode?.name || 'aks-grid-telemetry-prod'} --overwrite-existing`,
          'kubelogin convert-kubeconfig -l azurecli',
          '',
          '# 2. Inspect Pod Health, HPA Scaling & Ingress',
          'kubectl get pods,svc,ingress,hpa -n grid-telemetry -o wide',
          `kubectl rollout status deployment/${primaryWl?.name || 'grid-telemetry-api'} -n grid-telemetry`,
          '',
          '# 3. Check Key Vault CSI Mounted Secrets & Workload Identity Token',
          'kubectl get secretproviderclass -n grid-telemetry',
          '',
          ...(sbNode
            ? [
                `# 4. Inspect Azure Service Bus (${sbNode.name}) Queue & Dead-Letter Depth`,
                `az servicebus queue show --resource-group ${ir.service.resourceGroup} --namespace-name ${sbNode.name} --name telemetry-events --query countDetails`
              ]
            : []),
          ...(redisNode
            ? [
                '',
                `# 5. Inspect Azure Managed Redis (${redisNode.name}) TLS & Cluster Health`,
                `az redis show --resource-group ${ir.service.resourceGroup} --name ${redisNode.name} --query "{provisioningState:provisioningState,sku:sku.name,tls:minimumTlsVersion}"`
              ]
            : []),
          '```'
        ].join('\n')
      : [
          '```bash',
          `# 1. Connect to Linux VM (${vmNode?.name || 'vm-grid-telemetry-01'}) via Azure Bastion`,
          `VM_ID=$(az vm show -g ${ir.service.resourceGroup} -n ${vmNode?.name || 'vm-grid-telemetry-01'} --query id -o tsv)`,
          `az network bastion ssh --name ${bastionNode?.name || 'bas-grid-ops'} --resource-group ${ir.service.resourceGroup} --target-resource-id "$VM_ID" --auth-type AAD`,
          '',
          '# 2. Check systemd Service Health & Recent Journal Logs',
          'sudo systemctl status grid-telemetry.service',
          'sudo journalctl -u grid-telemetry.service -n 100 --no-pager',
          '',
          '# 3. Restart Service After Configuration or OS Patching',
          'sudo systemctl restart grid-telemetry.service && curl -fsS http://localhost:8080/healthz',
          '```'
        ].join('\n'),
    'admin-observability-table': buildResourceTable(ir)
  };

  const userGuideBlocks = {
    'user-service-overview': [
      '| Consumer Property | Active Production Configuration |',
      '| :--- | :--- |',
      `| **Service Name** | **${ir.service.name}** |`,
      `| **Gateway / Entrypoint** | \`${ingNode?.name || 'Internal'}\` (${ingNode?.displayType || 'Gateway'}) |`,
      `| **Runtime Scaling & Availability** | ${isAks ? `Kubernetes Rolling Updates (${primaryWl?.replicas || 'HPA'}) • Target SLO ${ir.service.sloAvailability}` : `Single-Region VM Host (${vmNode?.sku || 'Standard'}) • Target SLO ${ir.service.sloAvailability}`} |`,
      `| **Async Event Buffering** | ${sbNode ? `Enabled via Azure Service Bus (\`${sbNode.name}\`)` : 'Not enabled (synchronous database write path)'} |`,
      ...(redisNode ? [`| **Hot-State Read Cache** | Sub-millisecond substation state cache via \`${redisNode.name}\` (${redisNode.sku}) |`] : []),
      `| **Exposure & Security** | ${primaryWl?.exposure || 'HTTPS 443'} |`
    ].join('\n'),
    'user-endpoints-catalog': buildEndpointsTable(ir)
  };

  const contributorGuideBlocks = {
    'contrib-delivery-flow': [
      `\`\`\`mermaid\n${runtimeMermaid}\n\`\`\``,
      '',
      isAks
        ? [
            '### Container & AKS Contribution Workflow',
            `1. **Application & OpenAPI Changes:** Update \`src/\` and \`openapi/openapi.yaml\`; run \`npm test\`.`,
            `2. **Container Packaging:** Validate \`Dockerfile\` builds cleanly; CI pushes immutable SHA-tagged images to \`${acrNode?.name || 'acrgridtelemetryprod'}.azurecr.io\`.`,
            `3. **Kubernetes & IaC Changes:** Update \`deploy/k8s/\` manifests and \`infra/terraform/\` (plus \`infra/bicep/\` mirror). Run \`terraform validate\`.`,
            `4. **Automated Docs-as-Code Sync:** Run \`npx dac-translator verify\` locally or let GitHub Actions / Azure Pipelines / Copilot Cloud Agent open the synchronized PR against \`${ir.service.centralDocsProductPath}\`.`
          ].join('\n')
        : [
            '### Virtual Machine & systemd Contribution Workflow',
            `1. **Application & OpenAPI Changes:** Update \`src/\` and \`openapi/openapi.yaml\`; run \`npm test\`.`,
            `2. **VM Packaging:** Update \`deploy/systemd/grid-telemetry.service\` or \`deploy/cloud-init/cloud-init.yaml\` when runtime flags change.`,
            `3. **IaC Changes:** Update \`infra/terraform/\` (and \`infra/bicep/\`); validate with \`terraform validate\`.`,
            `4. **Automated Docs-as-Code Sync:** Run \`npx dac-translator verify\` locally or allow CI/CD to propose synchronized documentation updates.`
          ].join('\n')
    ].join('\n'),
    'contrib-repo-contracts': [
      '| Artifact Path | Responsibility | Consumed By |',
      '| :--- | :--- | :--- |',
      '| `infra/terraform/*.tf` | Primary Azure Landing Zone infrastructure state | Terraform CI + `dac-translator` HCL Extractor |',
      '| `infra/bicep/main.bicep` | Multi-team Bicep reference template | Bicep Validator + `dac-translator` Bicep Extractor |',
      `| \`${isAks ? 'Dockerfile + deploy/k8s/*.yaml' : 'deploy/systemd/*.service'}\` | Workload runtime & scaling specification | Release Pipeline + \`dac-translator\` Workload Extractor |`,
      '| `openapi/openapi.yaml` | REST API contract & health probe endpoints | API Consumers + `user-guide.md` Renderer |',
      '| `dac-manifest.json` | Product ownership & Central Docs path mapping | `dac-translator` & GitHub Cloud Agent |'
    ].join('\n')
  };

  return {
    prov,
    architectureBlocks,
    adminGuideBlocks,
    userGuideBlocks,
    contributorGuideBlocks
  };
}

/**
 * Create initial baseline files if they do not exist yet, or non-destructively update
 * managed blocks if they already exist!
 */
export function renderAllDocumentation({ repoRoot, centralDocsRoot, ir }) {
  const { prov, readmeBlocks, localArchBlocks } = buildLocalRepoBlocks(ir);
  const updatedFiles = [];

  // 1. Local README.md
  const localReadmePath = path.join(repoRoot, 'README.md');
  const localReadmeInitial = () => `# ${ir.service.name} (\`${ir.service.id}\`)

${ir.service.description || 'Grid substation telemetry ingestion and dispatch status service.'}

## Current Hosting & Landing Zone Summary

${wrapBlock('local-hosting-summary', readmeBlocks['local-hosting-summary'], prov)}

## Landing Zone Architecture Diagram

${wrapBlock('local-topology-diagram', readmeBlocks['local-topology-diagram'], prov)}

## Build, Validate & Deploy Quickstart

${wrapBlock('local-build-deploy', readmeBlocks['local-build-deploy'], prov)}

## REST API Surface

${wrapBlock('local-api-endpoints', readmeBlocks['local-api-endpoints'], prov)}

## Developer Notes & Local Environment (Human-Maintained)

- **Local Port:** \`PORT=8080 npm start\` launches the HTTP telemetry server locally with an in-memory ring buffer when PostgreSQL is unreachable.
- **Docs-as-Code Contract:** Infrastructure or manifest edits automatically update the managed blocks above and open a synchronized Pull Request in the Centralized Platform Documentation repository.
`;

  writeOrUpdateDoc(localReadmePath, localReadmeInitial, readmeBlocks, prov, updatedFiles);

  // 2. Local docs/architecture.md
  const localArchPath = path.join(repoRoot, 'docs', 'architecture.md');
  const localArchInitial = () => `# ${ir.service.name} — Repository Architecture & Delivery View

## Runtime & CI/CD Delivery Flow

${wrapBlock('local-runtime-diagram', localArchBlocks['local-runtime-diagram'], prov)}

## Spoke VNet & Subnet Layout

${wrapBlock('local-subnet-table', localArchBlocks['local-subnet-table'], prov)}

## Provisioned Azure Resources

${wrapBlock('local-resource-inventory', localArchBlocks['local-resource-inventory'], prov)}

## Engineering Design Notes (Human-Maintained)

- Telemetry ingestion endpoints must remain idempotent by \`sensorId + timestamp\` so retries across network partitions never duplicate dispatch alerts.
- Any change to database SKUs, network CIDRs, or compute hosting requires \`CODEOWNERS\` review in the centralized platform repository.
`;

  writeOrUpdateDoc(localArchPath, localArchInitial, localArchBlocks, prov, updatedFiles);

  // 3. Centralized Documentation Repository (if path supplied)
  if (centralDocsRoot) {
    const productDir = path.join(centralDocsRoot, ir.service.centralDocsProductPath);
    fs.mkdirSync(productDir, { recursive: true });
    const central = buildCentralRepoBlocks(ir);

    const archPath = path.join(productDir, 'architecture.md');
    writeOrUpdateDoc(
      archPath,
      () => `# ${ir.service.name} — Architecture & Landing Zone Design

> **Centralized Platform Documentation** • Managed sections are synchronized from source IaC via Docs-as-Code PRs; Architectural Decision Records (ADRs) below remain human-curated by ${ir.service.ownerTeam}.

## Executive Topology Summary

${wrapBlock('arch-executive-summary', central.architectureBlocks['arch-executive-summary'], prov)}

## Azure Landing Zone & Network Topology

${wrapBlock('arch-topology-diagram', central.architectureBlocks['arch-topology-diagram'], prov)}

## Runtime Traffic & Delivery Architecture

${wrapBlock('arch-runtime-diagram', central.architectureBlocks['arch-runtime-diagram'], prov)}

## Virtual Network & Subnet Allocation

${wrapBlock('arch-network-table', central.architectureBlocks['arch-network-table'], prov)}

## Azure Resource & SKU Inventory

${wrapBlock('arch-resource-inventory', central.architectureBlocks['arch-resource-inventory'], prov)}

## Identity, RBAC & Private Connectivity Matrix

${wrapBlock('arch-security-rbac', central.architectureBlocks['arch-security-rbac'], prov)}

## Architectural Decision Records (ADRs) & Design Rationale

### ADR-001: Hub-and-Spoke Network Isolation & Private Endpoints
All stateful data stores (\`psql-grid-telemetry\`) and secret vaults (\`kv-grid-telemetry\`) must disallow public network ingress and bind exclusively to \`snet-data-pe\` via Azure Private Link, with egress inspected through the central Hub Firewall.

### ADR-002: Compute Hosting Posture
The baseline deployment originated on regional Linux Virtual Machines to accelerate initial SCADA/grid sensor migration from on-premises hypervisors. Platform engineering tracks compute density and patching toil quarterly to evaluate containerization.
`,
      central.architectureBlocks,
      prov,
      updatedFiles
    );

    const adminPath = path.join(productDir, 'admin-guide.md');
    writeOrUpdateDoc(
      adminPath,
      () => `# ${ir.service.name} — Administrator & SRE Operations Guide

## Active Operational Posture

${wrapBlock('admin-ops-posture', central.adminGuideBlocks['admin-ops-posture'], prov)}

## Day-2 Operational Runbook

${wrapBlock('admin-day2-runbook', central.adminGuideBlocks['admin-day2-runbook'], prov)}

## Monitored Infrastructure Inventory

${wrapBlock('admin-observability-table', central.adminGuideBlocks['admin-observability-table'], prov)}

## Incident Escalation Matrix & Maintenance Windows

- **Primary On-Call Owner:** Grid Platform Operations (\`${ir.service.ownerTeam}\`) — PagerDuty schedule \`PD-GRID-OPS-EU\`.
- **Change Freeze Windows:** Grid settlement peak hours (07:00–09:00 CET and 17:00–20:00 CET) disallow disruptive database or network changes without VP Infrastructure sign-off.
- **RPO / RTO Policy:** Production telemetry store targets RPO <= 5 minutes and RTO <= 15 minutes.
`,
      central.adminGuideBlocks,
      prov,
      updatedFiles
    );

    const userPath = path.join(productDir, 'user-guide.md');
    writeOrUpdateDoc(
      userPath,
      () => `# ${ir.service.name} — Service Consumer & User Guide

## Service Overview & Access Posture

${wrapBlock('user-service-overview', central.userGuideBlocks['user-service-overview'], prov)}

## API Endpoints Catalog

${wrapBlock('user-endpoints-catalog', central.userGuideBlocks['user-endpoints-catalog'], prov)}

## Consumer Onboarding, Rate Limits & Support

- **Authentication:** Internal platform consumers authenticate using Entra ID App Roles (\`Telemetry.Read\`, \`Telemetry.Ingest\`) issued under tenant policy \`POL-GRID-API\`.
- **Standard Rate Quota:** Up to 2,500 requests/minute per consumer client ID; request burst exemptions via the Cloud Platform intake portal.
- **Support Channel:** Raise non-urgent integration requests in \`#grid-telemetry-support\` or open an issue in this documentation repository.
`,
      central.userGuideBlocks,
      prov,
      updatedFiles
    );

    const contribPath = path.join(productDir, 'contributor-guide.md');
    writeOrUpdateDoc(
      contribPath,
      () => `# ${ir.service.name} — Engineering Contributor Guide

## Build, Release & Infrastructure Delivery Flow

${wrapBlock('contrib-delivery-flow', central.contributorGuideBlocks['contrib-delivery-flow'], prov)}

## Repository & Docs-as-Code Contracts

${wrapBlock('contrib-repo-contracts', central.contributorGuideBlocks['contrib-repo-contracts'], prov)}

## Code Review Standards, Branching Policy & Definition of Done

- **Protected \`main\` Branch:** All application and IaC modifications require pull request approval from \`CODEOWNERS\`, green unit tests, and passing \`terraform validate\`.
- **Zero Static Secrets:** Never commit connection strings, SSH keys, or SAS tokens; bind permissions through Managed Identity RBAC in Terraform/Bicep.
- **Documentation Accountability:** Review automated Docs-as-Code PRs alongside architectural changes and append human rationale to \`architecture.md\` ADRs whenever hosting or stateful services change.
`,
      central.contributorGuideBlocks,
      prov,
      updatedFiles
    );

    // Provenance lockfile
    const provPath = path.join(productDir, 'dac-provenance.json');
    fs.writeFileSync(
      provPath,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          serviceId: ir.service.id,
          serviceName: ir.service.name,
          landingZone: ir.service.landingZone,
          hostingModel: ir.hostingModel,
          hostingLabel: HOSTING_LABELS[ir.hostingModel],
          sourceRepo: ir.sourceRepo,
          sourceCommit: ir.sourceCommit,
          semanticHash: ir.semanticHash,
          nodeCount: ir.nodes.length,
          subnetCount: ir.network?.subnets?.length || 0,
          syncedAt: ir.extractedAt
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    updatedFiles.push(provPath);

    // Update Central Catalog README.md index if present
    const centralReadmePath = path.join(centralDocsRoot, 'README.md');
    if (fs.existsSync(centralReadmePath)) {
      const catalogRow = [
        '| Product / Service | Landing Zone | Active Hosting Model | Region | Owner | Source Provenance | Guides |',
        '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
        `| **${ir.service.name}** | \`${ir.service.landingZone}\` | **${HOSTING_LABELS[ir.hostingModel]}** | \`${ir.service.region}\` | \`${ir.service.ownerTeam}\` | \`${ir.sourceRepo}@${ir.sourceCommit.slice(0, 7)}\` (\`${ir.semanticHash.slice(0, 8)}\`) | [Architecture](./${ir.service.centralDocsProductPath}/architecture.md) · [Admin](./${ir.service.centralDocsProductPath}/admin-guide.md) · [User](./${ir.service.centralDocsProductPath}/user-guide.md) · [Contributor](./${ir.service.centralDocsProductPath}/contributor-guide.md) |`
      ].join('\n');
      const currentCatalog = fs.readFileSync(centralReadmePath, 'utf8');
      const nextCatalog = upsertManagedBlocks(currentCatalog, { 'catalog-index': catalogRow }, prov);
      if (nextCatalog !== currentCatalog) {
        fs.writeFileSync(centralReadmePath, nextCatalog, 'utf8');
        updatedFiles.push(centralReadmePath);
      }
    }
  }

  return { updatedFiles };
}

function writeOrUpdateDoc(filePath, initialBuilder, blockMap, prov, updatedFiles) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, initialBuilder(), 'utf8');
    updatedFiles.push(filePath);
    return;
  }
  const current = fs.readFileSync(filePath, 'utf8');
  const next = upsertManagedBlocks(current, blockMap, prov);
  if (next !== current) {
    fs.writeFileSync(filePath, next, 'utf8');
    updatedFiles.push(filePath);
  }
}
