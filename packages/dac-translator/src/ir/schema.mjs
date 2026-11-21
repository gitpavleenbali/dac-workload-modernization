import crypto from 'node:crypto';

/**
 * Declarative Azure Resource Taxonomy mapping Terraform (azurerm_*) and
 * Bicep/ARM (Microsoft.*) resource types into canonical architectural roles.
 * Low-level plumbing (NICs, DNS links, NSG associations, role assignments,
 * private endpoints) is folded into structured edges and badges rather than
 * cluttering diagrams with noise boxes.
 */
export const AZURE_TAXONOMY = {
  // Boundaries
  azurerm_resource_group: { category: 'boundary', role: 'resource-group', displayType: 'Resource Group', hostingSignal: null },
  'Microsoft.Resources/resourceGroups': { category: 'boundary', role: 'resource-group', displayType: 'Resource Group', hostingSignal: null },
  azurerm_virtual_network: { category: 'boundary', role: 'vnet', displayType: 'Azure Virtual Network', hostingSignal: null },
  'Microsoft.Network/virtualNetworks': { category: 'boundary', role: 'vnet', displayType: 'Azure Virtual Network', hostingSignal: null },
  azurerm_subnet: { category: 'boundary', role: 'subnet', displayType: 'Subnet', hostingSignal: null },
  'Microsoft.Network/virtualNetworks/subnets': { category: 'boundary', role: 'subnet', displayType: 'Subnet', hostingSignal: null },

  // VM / Legacy IaaS Compute & Ingress
  azurerm_linux_virtual_machine: { category: 'compute', role: 'vm', displayType: 'Azure Linux VM', hostingSignal: 'virtual-machines' },
  azurerm_linux_virtual_machine_scale_set: { category: 'compute', role: 'vmss', displayType: 'Azure Linux VMSS', hostingSignal: 'virtual-machines' },
  'Microsoft.Compute/virtualMachines': { category: 'compute', role: 'vm', displayType: 'Azure Linux VM', hostingSignal: 'virtual-machines' },
  'Microsoft.Compute/virtualMachineScaleSets': { category: 'compute', role: 'vmss', displayType: 'Azure Linux VMSS', hostingSignal: 'virtual-machines' },
  azurerm_lb: { category: 'ingress', role: 'load-balancer', displayType: 'Azure Standard Load Balancer', hostingSignal: null },
  'Microsoft.Network/loadBalancers': { category: 'ingress', role: 'load-balancer', displayType: 'Azure Standard Load Balancer', hostingSignal: null },
  azurerm_bastion_host: { category: 'security', role: 'bastion', displayType: 'Azure Bastion', hostingSignal: null },
  'Microsoft.Network/bastionHosts': { category: 'security', role: 'bastion', displayType: 'Azure Bastion', hostingSignal: null },

  // Modernized Container / AKS Compute, Registry & Ingress
  azurerm_kubernetes_cluster: { category: 'compute', role: 'aks', displayType: 'Azure Kubernetes Service (AKS)', hostingSignal: 'aks-containerized' },
  'Microsoft.ContainerService/managedClusters': { category: 'compute', role: 'aks', displayType: 'Azure Kubernetes Service (AKS)', hostingSignal: 'aks-containerized' },
  azurerm_kubernetes_cluster_node_pool: { category: 'compute', role: 'aks-node-pool', displayType: 'AKS Workload Node Pool', hostingSignal: 'aks-containerized' },
  'Microsoft.ContainerService/managedClusters/agentPools': { category: 'compute', role: 'aks-node-pool', displayType: 'AKS Workload Node Pool', hostingSignal: 'aks-containerized' },
  azurerm_container_app: { category: 'compute', role: 'container-app', displayType: 'Azure Container App', hostingSignal: 'container-apps' },
  'Microsoft.App/containerApps': { category: 'compute', role: 'container-app', displayType: 'Azure Container App', hostingSignal: 'container-apps' },
  azurerm_container_registry: { category: 'containers', role: 'acr', displayType: 'Azure Container Registry (ACR)', hostingSignal: null },
  'Microsoft.ContainerRegistry/registries': { category: 'containers', role: 'acr', displayType: 'Azure Container Registry (ACR)', hostingSignal: null },
  azurerm_application_gateway: { category: 'ingress', role: 'app-gateway', displayType: 'Azure Application Gateway (WAF v2)', hostingSignal: null },
  'Microsoft.Network/applicationGateways': { category: 'ingress', role: 'app-gateway', displayType: 'Azure Application Gateway (WAF v2)', hostingSignal: null },

  // Data, Messaging, Security & Identity, Observability
  azurerm_postgresql_flexible_server: { category: 'data', role: 'postgresql', displayType: 'Azure Database for PostgreSQL', hostingSignal: null },
  'Microsoft.DBforPostgreSQL/flexibleServers': { category: 'data', role: 'postgresql', displayType: 'Azure Database for PostgreSQL', hostingSignal: null },
  azurerm_redis_cache: { category: 'data', role: 'redis', displayType: 'Azure Managed Redis', hostingSignal: null },
  'Microsoft.Cache/redis': { category: 'data', role: 'redis', displayType: 'Azure Managed Redis', hostingSignal: null },
  azurerm_servicebus_namespace: { category: 'messaging', role: 'service-bus', displayType: 'Azure Service Bus', hostingSignal: null },
  'Microsoft.ServiceBus/namespaces': { category: 'messaging', role: 'service-bus', displayType: 'Azure Service Bus', hostingSignal: null },
  azurerm_key_vault: { category: 'security', role: 'key-vault', displayType: 'Azure Key Vault', hostingSignal: null },
  'Microsoft.KeyVault/vaults': { category: 'security', role: 'key-vault', displayType: 'Azure Key Vault', hostingSignal: null },
  azurerm_user_assigned_identity: { category: 'security', role: 'managed-identity', displayType: 'User-Assigned Managed Identity', hostingSignal: null },
  'Microsoft.ManagedIdentity/userAssignedIdentities': { category: 'security', role: 'managed-identity', displayType: 'User-Assigned Managed Identity', hostingSignal: null },
  azurerm_log_analytics_workspace: { category: 'observability', role: 'log-analytics', displayType: 'Log Analytics Workspace', hostingSignal: null },
  'Microsoft.OperationalInsights/workspaces': { category: 'observability', role: 'log-analytics', displayType: 'Log Analytics Workspace', hostingSignal: null },

  // Folded Plumbing (converted into edges/badges rather than standalone boxes)
  azurerm_private_endpoint: { category: 'plumbing', role: 'private-endpoint', displayType: 'Private Endpoint', hostingSignal: null },
  'Microsoft.Network/privateEndpoints': { category: 'plumbing', role: 'private-endpoint', displayType: 'Private Endpoint', hostingSignal: null },
  azurerm_role_assignment: { category: 'plumbing', role: 'rbac', displayType: 'RBAC Role Assignment', hostingSignal: null },
  'Microsoft.Authorization/roleAssignments': { category: 'plumbing', role: 'rbac', displayType: 'RBAC Role Assignment', hostingSignal: null },
  azurerm_virtual_network_peering: { category: 'plumbing', role: 'vnet-peering', displayType: 'VNet Peering', hostingSignal: null },
  'Microsoft.Network/virtualNetworks/virtualNetworkPeerings': { category: 'plumbing', role: 'vnet-peering', displayType: 'VNet Peering', hostingSignal: null },
  azurerm_network_security_group: { category: 'plumbing', role: 'nsg', displayType: 'Network Security Group', hostingSignal: null },
  'Microsoft.Network/networkSecurityGroups': { category: 'plumbing', role: 'nsg', displayType: 'Network Security Group', hostingSignal: null },
  azurerm_network_interface: { category: 'plumbing', role: 'nic', displayType: 'Network Interface', hostingSignal: null },
  azurerm_monitor_diagnostic_setting: { category: 'plumbing', role: 'diagnostic-setting', displayType: 'Diagnostic Setting', hostingSignal: null }
};

export const WELL_KNOWN_ROLES = {
  '7f951dda-4ed3-4680-a7ca-43fe172d538d': 'AcrPull',
  '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
  '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39': 'Azure Service Bus Data Sender',
  '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0': 'Azure Service Bus Data Receiver',
  '3913510d-42f4-4e42-8a64-420c390055eb': 'Monitoring Metrics Publisher'
};

/**
 * Normalize an ArchitectureIR object so volatile fields (timestamps, commit SHAs,
 * file ordering) never affect semantic hashing.
 */
export function normalizeIRForHashing(ir) {
  const sortById = (arr = [], key = 'id') =>
    [...arr]
      .map((item) => {
        const clone = { ...item };
        if (Array.isArray(clone.badges)) clone.badges = [...clone.badges].sort();
        if (clone.properties && typeof clone.properties === 'object') {
          clone.properties = Object.keys(clone.properties)
            .sort()
            .reduce((acc, k) => {
              acc[k] = clone.properties[k];
              return acc;
            }, {});
        }
        return clone;
      })
      .sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')));

  return {
    schemaVersion: ir.schemaVersion || '1.0.0',
    service: {
      id: ir.service?.id || 'unknown-service',
      name: ir.service?.name || 'Unknown Service',
      landingZone: ir.service?.landingZone || 'default-lz',
      environment: ir.service?.environment || 'prod',
      region: ir.service?.region || 'westeurope'
    },
    hostingModel: ir.hostingModel || 'unknown',
    network: {
      vnetName: ir.network?.vnetName || null,
      addressSpace: [...(ir.network?.addressSpace || [])].sort(),
      hubPeering: ir.network?.hubPeering || null,
      subnets: sortById(ir.network?.subnets || [], 'name')
    },
    nodes: sortById(ir.nodes || [], 'id'),
    relationships: [...(ir.relationships || [])]
      .map((r) => ({
        from: r.from,
        to: r.to,
        kind: r.kind,
        label: r.label || '',
        protocol: r.protocol || ''
      }))
      .sort((a, b) => `${a.from}->${a.to}:${a.kind}:${a.label}`.localeCompare(`${b.from}->${b.to}:${b.kind}:${b.label}`)),
    workloads: sortById(ir.workloads || [], 'name'),
    apiEndpoints: [...(ir.apiEndpoints || [])].sort((a, b) =>
      `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)
    )
  };
}

export function computeSemanticHash(ir) {
  const normalized = normalizeIRForHashing(ir);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Strict schema validation for ArchitectureIR.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArchitectureIR(ir) {
  const errors = [];
  if (!ir || typeof ir !== 'object') {
    return { valid: false, errors: ['IR root must be an object'] };
  }
  if (!ir.service?.id) errors.push('Missing ir.service.id');
  if (!ir.service?.name) errors.push('Missing ir.service.name');
  const allowedModels = new Set(['virtual-machines', 'aks-containerized', 'container-apps', 'hybrid', 'unknown']);
  if (!allowedModels.has(ir.hostingModel)) {
    errors.push(`Invalid hostingModel "${ir.hostingModel}"`);
  }
  if (!Array.isArray(ir.nodes) || ir.nodes.length === 0) {
    errors.push('IR must contain at least one architectural node in ir.nodes');
  } else {
    const seen = new Set();
    for (const node of ir.nodes) {
      if (!node.id) errors.push('Node missing id');
      if (seen.has(node.id)) errors.push(`Duplicate node id "${node.id}"`);
      seen.add(node.id);
      if (!node.name) errors.push(`Node "${node.id}" missing name`);
      if (!node.category) errors.push(`Node "${node.id}" missing category`);
    }
    for (const rel of ir.relationships || []) {
      const validExternal = rel.from.startsWith('ext:') || rel.to.startsWith('ext:');
      if (!validExternal && (!seen.has(rel.from) || !seen.has(rel.to))) {
        errors.push(`Relationship "${rel.from} -> ${rel.to}" references unknown node id`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
