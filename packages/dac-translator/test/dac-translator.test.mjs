import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  stripCommentsPreservingStrings,
  buildArchitectureIR,
  computeArchitectureDelta,
  renderTopologyMermaid,
  renderRuntimeAndDeliveryMermaid,
  validateMermaidBlock,
  validateMarkdownMermaidBlocks,
  verifyManagedBlocksAndHumanProse,
  renderAllDocumentation,
  extractBicepDirectory
} from '../src/index.mjs';

function makeTempRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeVmFixture(repoDir, extraWhitespaceOrComments = '') {
  fs.mkdirSync(path.join(repoDir, 'infra', 'terraform'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'deploy', 'systemd'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'openapi'), { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'dac-manifest.json'),
    JSON.stringify({
      serviceId: 'grid-telemetry-service',
      serviceName: 'Grid Telemetry Service',
      landingZone: 'alz-energy-ops-prod',
      environment: 'prod',
      ownerTeam: '@cloud-platform-owners',
      centralDocsProductPath: 'products/grid-telemetry-service'
    })
  );

  fs.writeFileSync(
    path.join(repoDir, 'infra', 'terraform', 'main.tf'),
    `
${extraWhitespaceOrComments}
variable "location" {
  default = "westeurope"
}
variable "pg_sku" {
  default = "GP_Standard_D2ds_v5"
}
locals {
  rg_name = "rg-grid-telemetry-prod"
   docs_url = "https://internal.docs.example.com/grid" // inline comment after URL
}
resource "azurerm_resource_group" "rg" {
  name     = local.rg_name
  location = var.location
}
resource "azurerm_virtual_network" "spoke" {
  name                = "vnet-grid-prod"
  address_space       = ["10.40.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_virtual_network_peering" "to_hub" {
  name                      = "peer-spoke-to-hub"
  resource_group_name       = azurerm_resource_group.rg.name
  virtual_network_name      = azurerm_virtual_network.spoke.name
  remote_virtual_network_id = "/subscriptions/0000/resourceGroups/rg-hub/providers/Microsoft.Network/virtualNetworks/vnet-hub-eu"
}
resource "azurerm_subnet" "vm_app" {
  name                 = "snet-vm-app"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.1.0/24"]
}
resource "azurerm_subnet" "data_pe" {
  name                 = "snet-data-pe"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.2.0/24"]
}
resource "azurerm_lb" "ingress_lb" {
  name                = "lb-grid-telemetry"
  sku                 = "Standard"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_bastion_host" "ops_bastion" {
  name                = "bas-grid-ops"
  sku                 = "Standard"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_network_interface" "vm_nic" {
  name                = "nic-vm-grid-01"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.vm_app.id
    private_ip_address_allocation = "Dynamic"
  }
}
resource "azurerm_linux_virtual_machine" "app_vm" {
  name                  = "vm-grid-telemetry-01"
  size                  = "Standard_D4s_v5"
  location              = azurerm_resource_group.rg.location
  resource_group_name   = azurerm_resource_group.rg.name
  network_interface_ids = [azurerm_network_interface.vm_nic.id]
  identity {
    type = "SystemAssigned"
  }
}
resource "azurerm_postgresql_flexible_server" "db" {
  name                = "psql-grid-telemetry"
  sku_name            = var.pg_sku
  version             = "16"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_key_vault" "kv" {
  name                = "kv-grid-telemetry"
  sku_name            = "standard"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-grid-ops"
  sku                 = "PerGB2018"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_private_endpoint" "pe_db" {
  name                = "pe-psql-grid"
  subnet_id           = azurerm_subnet.data_pe.id
  private_service_connection {
    private_connection_resource_id = azurerm_postgresql_flexible_server.db.id
  }
}
resource "azurerm_role_assignment" "vm_kv_secrets" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_virtual_machine.app_vm.identity[0].principal_id
}
`
  );

  fs.writeFileSync(
    path.join(repoDir, 'deploy', 'systemd', 'grid-telemetry.service'),
    `[Unit]\nDescription=Grid Telemetry Service\n[Service]\nUser=telemetry\nExecStart=/usr/bin/node /opt/grid-telemetry/server.mjs\n`
  );

  fs.writeFileSync(
    path.join(repoDir, 'openapi', 'openapi.yaml'),
    `openapi: 3.1.0\ninfo:\n  title: Grid Telemetry API\n  version: 1.0.0\npaths:\n  /healthz:\n    get:\n      summary: Liveness and readiness check\n  /v1/telemetry:\n    post:\n      summary: Ingest grid substation reading\n`
  );
}

function upgradeFixtureToAks(repoDir) {
  // Remove systemd VM deployment
  fs.rmSync(path.join(repoDir, 'deploy', 'systemd'), { recursive: true, force: true });
  fs.mkdirSync(path.join(repoDir, 'deploy', 'k8s'), { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'Dockerfile'),
    `FROM node:24-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "src/server.mjs"]\n`
  );

  fs.writeFileSync(
    path.join(repoDir, 'deploy', 'k8s', 'workloads.yaml'),
    `apiVersion: apps/v1
kind: Deployment
metadata:
  name: grid-telemetry-api
spec:
  replicas: 3
  template:
    spec:
      serviceAccountName: sa-grid-telemetry
      containers:
        - name: api
          image: acrgridtelemetryprod.azurecr.io/grid-telemetry-service:2.0.0
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: grid-telemetry-hpa
spec:
  minReplicas: 3
  maxReplicas: 12
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: grid-telemetry-ingress
spec:
  ingressClassName: azure-application-gateway
  rules:
    - host: telemetry.grid.internal
---
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: kv-grid-secrets
spec:
  parameters:
    keyvaultName: "kv-grid-telemetry"
`
  );

  fs.writeFileSync(
    path.join(repoDir, 'infra', 'terraform', 'main.tf'),
    `
variable "location" {
  default = "westeurope"
}
resource "azurerm_resource_group" "rg" {
  name     = "rg-grid-telemetry-prod"
  location = var.location
}
resource "azurerm_virtual_network" "spoke" {
  name                = "vnet-grid-prod"
  address_space       = ["10.40.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_virtual_network_peering" "to_hub" {
  name                      = "peer-spoke-to-hub"
  resource_group_name       = azurerm_resource_group.rg.name
  virtual_network_name      = azurerm_virtual_network.spoke.name
  remote_virtual_network_id = "/subscriptions/0000/resourceGroups/rg-hub/providers/Microsoft.Network/virtualNetworks/vnet-hub-eu"
}
resource "azurerm_subnet" "aks_nodes" {
  name                 = "snet-aks-nodes"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.4.0/22"]
}
resource "azurerm_subnet" "ingress_agw" {
  name                 = "snet-ingress-waf"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.10.0/24"]
}
resource "azurerm_subnet" "data_pe" {
  name                 = "snet-data-pe"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.2.0/24"]
}
resource "azurerm_container_registry" "acr" {
  name                = "acrgridtelemetryprod"
  sku                 = "Premium"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_application_gateway" "waf" {
  name                = "agw-grid-waf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku {
    name = "WAF_v2"
    tier = "WAF_v2"
  }
  gateway_ip_configuration {
    subnet_id = azurerm_subnet.ingress_agw.id
  }
}
resource "azurerm_user_assigned_identity" "uami" {
  name                = "id-grid-telemetry-workload"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_kubernetes_cluster" "aks" {
  name                      = "aks-grid-telemetry-prod"
  kubernetes_version        = "1.31"
  sku_tier                  = "Standard"
  private_cluster_enabled   = true
  workload_identity_enabled = true
  oidc_issuer_enabled       = true
  location                  = azurerm_resource_group.rg.location
  resource_group_name       = azurerm_resource_group.rg.name
  default_node_pool {
    name           = "system"
    vm_size        = "Standard_D4ds_v5"
    vnet_subnet_id = azurerm_subnet.aks_nodes.id
  }
  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
  }
}
resource "azurerm_kubernetes_cluster_node_pool" "workload" {
  name                  = "workload"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.aks.id
  vm_size               = "Standard_D8ds_v5"
  min_count             = 3
  max_count             = 12
  vnet_subnet_id        = azurerm_subnet.aks_nodes.id
}
resource "azurerm_servicebus_namespace" "sb" {
  name                = "sb-grid-telemetry"
  sku                 = "Premium"
  capacity            = 1
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_postgresql_flexible_server" "db" {
  name                = "psql-grid-telemetry"
  sku_name            = "GP_Standard_D4ds_v5"
  version             = "16"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  high_availability {
    mode = "ZoneRedundant"
  }
}
resource "azurerm_key_vault" "kv" {
  name                = "kv-grid-telemetry"
  sku_name            = "standard"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-grid-ops"
  sku                 = "PerGB2018"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
resource "azurerm_private_endpoint" "pe_db" {
  name      = "pe-psql-grid"
  subnet_id = azurerm_subnet.data_pe.id
  private_service_connection {
    private_connection_resource_id = azurerm_postgresql_flexible_server.db.id
  }
}
resource "azurerm_private_endpoint" "pe_acr" {
  name      = "pe-acr-grid"
  subnet_id = azurerm_subnet.data_pe.id
  private_service_connection {
    private_connection_resource_id = azurerm_container_registry.acr.id
  }
}
resource "azurerm_private_endpoint" "pe_sb" {
  name      = "pe-sb-grid"
  subnet_id = azurerm_subnet.data_pe.id
  private_service_connection {
    private_connection_resource_id = azurerm_servicebus_namespace.sb.id
  }
}
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
}
resource "azurerm_role_assignment" "uami_kv" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.uami.principal_id
}
resource "azurerm_role_assignment" "uami_sb" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_user_assigned_identity.uami.principal_id
}
`
  );
}

test('stripCommentsPreservingStrings preserves https:// URLs while removing HCL comments', () => {
  const input = `
    # full line comment
    url = "https://learn.microsoft.com/azure // not a comment # still string" // trailing comment
    /* multi
       line */
    name = "ok"
  `;
  const cleaned = stripCommentsPreservingStrings(input);
  assert.match(cleaned, /https:\/\/learn\.microsoft\.com\/azure \/\/ not a comment # still string/);
  assert.doesNotMatch(cleaned, /trailing comment/);
  assert.doesNotMatch(cleaned, /full line comment/);
});

test('Semantic hash ignores formatting/comments and detects VM -> AKS modernization accurately', () => {
  const repoA = makeTempRepo('dac-vm-a-');
  const repoB = makeTempRepo('dac-vm-b-');
  try {
    writeVmFixture(repoA, '# initial comment');
    writeVmFixture(repoB, '\n\n/* extra comment block and blank lines */\n\n');

    const irA = buildArchitectureIR(repoA, { sourceCommit: '1111111' });
    const irB = buildArchitectureIR(repoB, { sourceCommit: '2222222' });

    assert.equal(irA.hostingModel, 'virtual-machines');
    assert.equal(irA.semanticHash, irB.semanticHash, 'Formatting/comments/commit SHA must not alter semanticHash');

    const noopDelta = computeArchitectureDelta(irA, irB);
    assert.equal(noopDelta.hasArchitecturalChanges, false);

    // Upgrade repoB to AKS!
    upgradeFixtureToAks(repoB);
    const irAks = buildArchitectureIR(repoB, { sourceCommit: '3333333' });
    assert.equal(irAks.hostingModel, 'aks-containerized');
    assert.notEqual(irA.semanticHash, irAks.semanticHash);

    const delta = computeArchitectureDelta(irA, irAks);
    assert.equal(delta.hasArchitecturalChanges, true);
    assert.equal(delta.hostingChanged, true);
    assert.equal(delta.hostingTransition, 'virtual-machines -> aks-containerized');
    assert.ok(delta.removedNodes.some((n) => n.role === 'vm'), 'Should record decommissioned Linux VM');
    assert.ok(delta.removedNodes.some((n) => n.role === 'bastion'), 'Should record decommissioned Azure Bastion');
    assert.ok(delta.addedNodes.some((n) => n.role === 'aks'), 'Should record added AKS cluster');
    assert.ok(delta.addedNodes.some((n) => n.role === 'acr'), 'Should record added ACR');
    assert.ok(delta.addedNodes.some((n) => n.role === 'service-bus'), 'Should record added Service Bus');
    assert.ok(delta.modifiedNodes.some((m) => m.name === 'psql-grid-telemetry'), 'Should detect PostgreSQL SKU + HA upgrade');
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('Mermaid compiler outputs valid GitHub-safe diagrams and validator catches broken labels', () => {
  const repo = makeTempRepo('dac-mermaid-');
  try {
    writeVmFixture(repo);
    const vmIR = buildArchitectureIR(repo);
    assert.deepEqual(validateMermaidBlock(renderTopologyMermaid(vmIR)), { valid: true, errors: [] });
    assert.deepEqual(validateMermaidBlock(renderRuntimeAndDeliveryMermaid(vmIR)), { valid: true, errors: [] });

    upgradeFixtureToAks(repo);
    const aksIR = buildArchitectureIR(repo);
    assert.deepEqual(validateMermaidBlock(renderTopologyMermaid(aksIR)), { valid: true, errors: [] });
    assert.deepEqual(validateMermaidBlock(renderRuntimeAndDeliveryMermaid(aksIR)), { valid: true, errors: [] });

    // Negative check: unquoted parentheses inside square brackets break GitHub Mermaid
    const broken = 'flowchart TB\n  aks_node[AKS Cluster (1.31)]\n';
    const brokenRes = validateMermaidBlock(broken);
    assert.equal(brokenRes.valid, false);
    assert.match(brokenRes.errors[0], /Unquoted special characters/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Non-destructive Markdown renderer updates VM -> AKS across all local & central guides while preserving human prose byte-for-byte', () => {
  const repo = makeTempRepo('dac-md-repo-');
  const central = makeTempRepo('dac-md-central-');
  try {
    fs.writeFileSync(
      path.join(central, 'README.md'),
      `# Central Docs\n\n<!-- BEGIN DAC:catalog-index -->\n_init_\n<!-- END DAC:catalog-index -->\n\nHuman footer policy text.\n`
    );

    writeVmFixture(repo);
    const vmIR = buildArchitectureIR(repo, { sourceCommit: 'aaaa111', sourceRepo: 'org/grid-repo' });
    renderAllDocumentation({ repoRoot: repo, centralDocsRoot: central, ir: vmIR });

    const archPath = path.join(central, 'products', 'grid-telemetry-service', 'architecture.md');
    const adminPath = path.join(central, 'products', 'grid-telemetry-service', 'admin-guide.md');
    const contributorPath = path.join(central, 'products', 'grid-telemetry-service', 'contributor-guide.md');

    // Inject custom human ADR note outside managed blocks
    const customHumanAdr = `\n### ADR-003: Custom Human Security Sign-Off\nApproved by Chief Security Architect on 2026-11-15 — DO NOT OVERWRITE.\n`;
    fs.appendFileSync(archPath, customHumanAdr, 'utf8');
    const vmArchSnapshot = fs.readFileSync(archPath, 'utf8');
    assert.match(fs.readFileSync(adminPath, 'utf8'), /az network bastion ssh/);
    const checkContributorGuidance = (markdown) => {
      assert.match(markdown, /`npm run dac:render`.*`npm run dac:verify`/);
      assert.match(markdown, /separate, opt-in GitHub workflow/);
      assert.doesNotMatch(markdown, /npx dac-translator|Copilot Cloud Agent open|CI pushes/);
    };
    checkContributorGuidance(fs.readFileSync(contributorPath, 'utf8'));

    // Now modernize to AKS and re-render!
    upgradeFixtureToAks(repo);
    const aksIR = buildArchitectureIR(repo, { sourceCommit: 'bbbb222', sourceRepo: 'org/grid-repo' });
    renderAllDocumentation({ repoRoot: repo, centralDocsRoot: central, ir: aksIR });

    const aksArchSnapshot = fs.readFileSync(archPath, 'utf8');
    const aksAdminSnapshot = fs.readFileSync(adminPath, 'utf8');

    // Verify human ADR survived untouched AND prose validator passes!
    assert.ok(aksArchSnapshot.includes(customHumanAdr), 'Custom human ADR must be preserved intact');
    const proseGuard = verifyManagedBlocksAndHumanProse(vmArchSnapshot, aksArchSnapshot, 'architecture.md');
    assert.equal(proseGuard.valid, true, proseGuard.errors.join('; '));

    // Verify AKS resources & runbook commands replaced VM Bastion/systemd inside managed blocks!
    assert.match(aksArchSnapshot, /aks-grid-telemetry-prod/);
    assert.match(aksArchSnapshot, /acrgridtelemetryprod/);
    assert.match(aksAdminSnapshot, /az aks get-credentials/);
    assert.doesNotMatch(aksAdminSnapshot, /az network bastion ssh/);
    const aksContributor = fs.readFileSync(contributorPath, 'utf8');
    checkContributorGuidance(aksContributor);
    assert.match(aksContributor, /builds without pushing an image or deploying/);

    // Verify every generated Markdown file has 100% valid Mermaid blocks
    for (const f of ['architecture.md', 'admin-guide.md', 'user-guide.md', 'contributor-guide.md']) {
      const md = fs.readFileSync(path.join(central, 'products', 'grid-telemetry-service', f), 'utf8');
      const check = validateMarkdownMermaidBlocks(md, f);
      assert.equal(check.valid, true, check.errors.join('; '));
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(central, { recursive: true, force: true });
  }
});

test('Bicep extractor detects AKS and ACR resources cleanly', () => {
  const dir = makeTempRepo('dac-bicep-');
  try {
    fs.writeFileSync(
      path.join(dir, 'main.bicep'),
      `
param location string = 'westeurope'
resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-grid-prod'
  properties: {
    addressSpace: { addressPrefixes: [ '10.40.0.0/16' ] }
  }
}
resource aks 'Microsoft.ContainerService/managedClusters@2024-05-01' = {
  name: 'aks-grid-telemetry-prod'
  sku: { name: 'Base' }
}
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrgridtelemetryprod'
  sku: { name: 'Premium' }
}
`
    );
    const res = extractBicepDirectory(dir);
    assert.equal(res.hostingModel, 'aks-containerized');
    assert.equal(res.nodes.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
