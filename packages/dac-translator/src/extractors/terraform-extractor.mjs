import fs from 'node:fs';
import path from 'node:path';
import { AZURE_TAXONOMY, WELL_KNOWN_ROLES } from '../ir/schema.mjs';

/**
 * Strip HCL comments (#, //, /* ... *\/) while preserving string literals.
 */
export function stripCommentsPreservingStrings(src) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '#' || (ch === '/' && next === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Find matching closing brace starting from openBraceIdx (string-aware).
 */
function findMatchingBrace(text, openBraceIdx) {
  let depth = 0;
  let inStr = false;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse top-level HCL blocks such as resource "type" "name" { ... }, variable "x" { ... }, locals { ... }
 */
export function parseHclTopBlocks(rawSource) {
  const src = stripCommentsPreservingStrings(rawSource);
  const blocks = [];
  const headerRe = /\b(resource|variable|locals|module|output|data)\b\s*(?:"([^"]+)"\s*)?(?:"([^"]+)"\s*)?\{/g;
  let match;
  while ((match = headerRe.exec(src)) !== null) {
    const openIdx = src.indexOf('{', match.index);
    const closeIdx = findMatchingBrace(src, openIdx);
    if (closeIdx === -1) continue;
    blocks.push({
      blockType: match[1],
      label1: match[2] || null,
      label2: match[3] || null,
      body: src.slice(openIdx + 1, closeIdx)
    });
    headerRe.lastIndex = closeIdx + 1;
  }
  return blocks;
}

function parseNestedBlock(body, blockName) {
  const results = [];
  const re = new RegExp(`\\b${blockName}\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(body)) !== null) {
    const openIdx = body.indexOf('{', m.index);
    const closeIdx = findMatchingBrace(body, openIdx);
    if (closeIdx === -1) break;
    results.push(body.slice(openIdx + 1, closeIdx));
    re.lastIndex = closeIdx + 1;
  }
  return results;
}

function stripTopNestedBlocks(body) {
  let out = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (depth === 0) out += ch;
      if (ch === '\\') {
        if (depth === 0 && i + 1 < body.length) out += body[i + 1];
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      if (depth === 0) out += ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

function extractAttr(body, attrName, ctx = {}, topLevelOnly = false) {
  const target = topLevelOnly ? stripTopNestedBlocks(body) : body;
  const lineRe = new RegExp(`(?:^|\\n)\\s*${attrName}\\s*=\\s*([^\\n]+)`, 'm');
  const m = target.match(lineRe);
  if (!m) return null;
  return resolveHclExpr(m[1].trim(), ctx);
}

function extractArrayAttr(body, attrName, ctx = {}) {
  const arrRe = new RegExp(`${attrName}\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
  const m = body.match(arrRe);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => resolveHclExpr(s.trim(), ctx))
    .filter(Boolean);
}

function resolveHclExpr(raw, ctx) {
  if (!raw) return '';
  let val = raw.replace(/,\s*$/, '').trim();
  if (val.startsWith('"') && val.endsWith('"')) {
    val = val.slice(1, -1);
  }
  // Interpolate ${var.foo} and ${local.bar}
  val = val.replace(/\$\{\s*(var|local)\.([A-Za-z0-9_-]+)\s*\}/g, (_, scope, key) => {
    const map = scope === 'var' ? ctx.vars : ctx.locals;
    return map?.[key] ?? `${scope}.${key}`;
  });
  // Direct var.foo or local.bar reference
  const directMatch = val.match(/^(var|local)\.([A-Za-z0-9_-]+)$/);
  if (directMatch) {
    const map = directMatch[1] === 'var' ? ctx.vars : ctx.locals;
    if (map && map[directMatch[2]] !== undefined) return String(map[directMatch[2]]);
  }
  return val;
}

function parseVarsAndLocals(blocks, tfvarsContent = '') {
  const ctx = { vars: {}, locals: {} };
  for (const b of blocks) {
    if (b.blockType === 'variable' && b.label1) {
      const def = extractAttr(b.body, 'default', ctx);
      if (def !== null) ctx.vars[b.label1] = def;
    }
  }
  if (tfvarsContent) {
    const clean = stripCommentsPreservingStrings(tfvarsContent);
    for (const line of clean.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (m) ctx.vars[m[1]] = resolveHclExpr(m[2].trim(), ctx);
    }
  }
  for (const b of blocks) {
    if (b.blockType === 'locals') {
      for (const line of b.body.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
        if (m && !m[2].includes('{')) {
          ctx.locals[m[1]] = resolveHclExpr(m[2].trim(), ctx);
        }
      }
    }
  }
  return ctx;
}

/**
 * Extract structured infrastructure topology from a Terraform directory.
 */
export function extractTerraformDirectory(tfDir) {
  if (!fs.existsSync(tfDir)) {
    return null;
  }
  const files = fs
    .readdirSync(tfDir)
    .filter((f) => f.endsWith('.tf'))
    .sort();
  if (files.length === 0) return null;

  const combinedTf = files.map((f) => fs.readFileSync(path.join(tfDir, f), 'utf8')).join('\n\n');
  const tfvarsFiles = fs
    .readdirSync(tfDir)
    .filter((f) => f.endsWith('.tfvars'))
    .sort();
  const tfvarsContent = tfvarsFiles.map((f) => fs.readFileSync(path.join(tfDir, f), 'utf8')).join('\n');

  const blocks = parseHclTopBlocks(combinedTf);
  const ctx = parseVarsAndLocals(blocks, tfvarsContent);
  const resources = blocks.filter((b) => b.blockType === 'resource' && b.label1 && b.label2);

  let resourceGroup = null;
  let location = ctx.vars.location || 'westeurope';
  let vnetName = null;
  let addressSpace = [];
  let hubPeering = null;
  const subnetsByTfRef = new Map();
  const subnets = [];
  const nsgsByTfRef = new Map();
  const nodes = [];
  const tfAddrToNodeId = new Map();
  const plumbingBlocks = [];

  // Pass 1: Boundaries & NSGs
  for (const r of resources) {
    const tfAddr = `${r.label1}.${r.label2}`;
    if (r.label1 === 'azurerm_resource_group') {
      resourceGroup = extractAttr(r.body, 'name', ctx, true) || r.label2;
      location = extractAttr(r.body, 'location', ctx, true) || location;
    } else if (r.label1 === 'azurerm_virtual_network') {
      vnetName = extractAttr(r.body, 'name', ctx, true) || r.label2;
      addressSpace = extractArrayAttr(r.body, 'address_space', ctx);
    } else if (r.label1 === 'azurerm_subnet') {
      const name = extractAttr(r.body, 'name', ctx, true) || r.label2;
      const prefixes = extractArrayAttr(r.body, 'address_prefixes', ctx);
      const delegationBlocks = parseNestedBlock(r.body, 'service_delegation');
      const delegation = delegationBlocks.length > 0 ? extractAttr(delegationBlocks[0], 'name', ctx) : null;
      const subnetObj = {
        id: `subnet:${r.label2}`,
        name,
        cidr: prefixes[0] || 'unspecified',
        delegation: delegation || null,
        nsg: null
      };
      subnetsByTfRef.set(tfAddr, subnetObj);
      subnets.push(subnetObj);
    } else if (r.label1 === 'azurerm_network_security_group') {
      nsgsByTfRef.set(tfAddr, extractAttr(r.body, 'name', ctx, true) || r.label2);
    } else if (r.label1 === 'azurerm_subnet_network_security_group_association') {
      const subnetExpr = extractAttr(r.body, 'subnet_id', ctx, true) || '';
      const nsgExpr = extractAttr(r.body, 'network_security_group_id', ctx, true) || '';
      for (const [subRef, subObj] of subnetsByTfRef.entries()) {
        if (subnetExpr.includes(subRef)) {
          for (const [nsgRef, nsgName] of nsgsByTfRef.entries()) {
            if (nsgExpr.includes(nsgRef)) subObj.nsg = nsgName;
          }
        }
      }
    } else if (r.label1 === 'azurerm_virtual_network_peering') {
      const remote = extractAttr(r.body, 'remote_virtual_network_id', ctx, true) || 'hub-vnet';
      const hubSeg = remote.split('/').pop() || remote;
      hubPeering = {
        peeringName: extractAttr(r.body, 'name', ctx, true) || r.label2,
        hubVnet: hubSeg
      };
    }
  }

  // Helper to resolve which subnet name a resource body references
  const resolveSubnetName = (body) => {
    for (const [subRef, subObj] of subnetsByTfRef.entries()) {
      if (body.includes(subRef)) return subObj.name;
    }
    return null;
  };

  // Pass 2: Primary Architectural Nodes
  const hostingSignals = new Set();
  for (const r of resources) {
    const tax = AZURE_TAXONOMY[r.label1];
    if (!tax || tax.category === 'boundary') continue;
    if (tax.category === 'plumbing') {
      plumbingBlocks.push(r);
      continue;
    }
    if (tax.hostingSignal) hostingSignals.add(tax.hostingSignal);

    const tfAddr = `${r.label1}.${r.label2}`;
    const nodeId = `${tax.role}:${r.label2}`;
    const name = extractAttr(r.body, 'name', ctx, true) || r.label2;
    let sku =
      extractAttr(r.body, 'sku_name', ctx, true) ||
      extractAttr(r.body, 'sku', ctx, true) ||
      extractAttr(r.body, 'size', ctx, true) ||
      extractAttr(r.body, 'vm_size', ctx, true) ||
      'Standard';

    const badges = [];
    const properties = {};

    if (r.label1 === 'azurerm_kubernetes_cluster') {
      const k8sVer = extractAttr(r.body, 'kubernetes_version', ctx, true);
      const defaultPool = parseNestedBlock(r.body, 'default_node_pool')[0] || '';
      const sysVmSize = extractAttr(defaultPool, 'vm_size', ctx) || 'Standard_D4ds_v5';
      sku = `${ extractAttr(r.body, 'sku_tier', ctx, true) || 'Standard' } (${sysVmSize})`;
      if (k8sVer) {
        badges.push(`K8s ${k8sVer}`);
        properties.kubernetesVersion = k8sVer;
      }
      if (extractAttr(r.body, 'workload_identity_enabled', ctx, true) === 'true') {
        badges.push('Workload Identity');
      }
      if (extractAttr(r.body, 'private_cluster_enabled', ctx, true) === 'true') {
        badges.push('Private Cluster');
      }
      const netProfile = parseNestedBlock(r.body, 'network_profile')[0] || '';
      const netPlugin = extractAttr(netProfile, 'network_plugin', ctx);
      const netMode = extractAttr(netProfile, 'network_plugin_mode', ctx);
      if (netPlugin) {
        badges.push(netMode ? `${netPlugin} (${netMode})` : netPlugin);
      }
    } else if (r.label1 === 'azurerm_kubernetes_cluster_node_pool') {
      const minCount = extractAttr(r.body, 'min_count', ctx, true);
      const maxCount = extractAttr(r.body, 'max_count', ctx, true);
      if (minCount && maxCount) {
        badges.push(`Autoscale ${minCount}-${maxCount}`);
        properties.autoscale = `${minCount}-${maxCount}`;
      }
    } else if (r.label1 === 'azurerm_linux_virtual_machine' || r.label1 === 'azurerm_linux_virtual_machine_scale_set') {
      const instances = extractAttr(r.body, 'instances', ctx, true);
      if (instances) badges.push(`${instances} instances`);
      if (r.body.includes('SystemAssigned')) badges.push('System Managed Identity');
    } else if (r.label1 === 'azurerm_postgresql_flexible_server') {
      const pgVer = extractAttr(r.body, 'version', ctx, true);
      if (pgVer) badges.push(`PG v${pgVer}`);
      const haBlocks = parseNestedBlock(r.body, 'high_availability');
      if (haBlocks.length > 0) {
        const haMode = extractAttr(haBlocks[0], 'mode', ctx) || 'ZoneRedundant';
        badges.push(`HA: ${haMode}`);
        properties.highAvailability = haMode;
      }
    } else if (r.label1 === 'azurerm_application_gateway') {
      const skuBlock = parseNestedBlock(r.body, 'sku')[0] || '';
      sku = extractAttr(skuBlock, 'tier', ctx) || extractAttr(skuBlock, 'name', ctx) || 'WAF_v2';
      badges.push('TLS / Layer-7 Ingress');
    } else if (r.label1 === 'azurerm_servicebus_namespace') {
      const cap = extractAttr(r.body, 'capacity', ctx, true);
      if (cap) badges.push(`${cap} Messaging Unit`);
    }

    const subnet = resolveSubnetName(r.body);
    const node = {
      id: nodeId,
      tfAddress: tfAddr,
      name,
      role: tax.role,
      category: tax.category,
      displayType: tax.displayType,
      sku,
      subnet,
      badges,
      properties
    };
    nodes.push(node);
    tfAddrToNodeId.set(tfAddr, nodeId);
  }

  // Pass 3: Fold Plumbing (Private Endpoints, NIC->Subnet, RBAC, Ingress, Diagnostics) into Edges & Badges
  const relationships = [];
  const computeNodes = nodes.filter((n) => n.category === 'compute' && n.role !== 'aks-node-pool');
  const primaryCompute = computeNodes[0] || nodes.find((n) => n.category === 'compute');

  // Map VM NICs to subnets so VM nodes know their subnet
  for (const p of plumbingBlocks) {
    if (p.label1 === 'azurerm_network_interface') {
      const nicSub = resolveSubnetName(p.body);
      const nicAddr = `azurerm_network_interface.${p.label2}`;
      if (nicSub) {
        for (const n of nodes) {
          if (n.role === 'vm') n.subnet = n.subnet || nicSub;
        }
      }
      void nicAddr;
    }
  }
  // Second pass on original VM resources to bind NIC subnet accurately
  for (const r of resources) {
    if (r.label1 === 'azurerm_linux_virtual_machine') {
      const nodeId = tfAddrToNodeId.get(`${r.label1}.${r.label2}`);
      const node = nodes.find((n) => n.id === nodeId);
      if (node && !node.subnet) {
        for (const p of plumbingBlocks) {
          if (p.label1 === 'azurerm_network_interface' && r.body.includes(`azurerm_network_interface.${p.label2}`)) {
            node.subnet = resolveSubnetName(p.body);
          }
        }
      }
    }
  }

  // Private Endpoints -> badge target resource + add Private Link relationship from compute
  for (const p of plumbingBlocks) {
    if (p.label1 === 'azurerm_private_endpoint') {
      const peSub = resolveSubnetName(p.body);
      for (const [tfAddr, targetNodeId] of tfAddrToNodeId.entries()) {
        if (p.body.includes(tfAddr)) {
          const targetNode = nodes.find((n) => n.id === targetNodeId);
          if (targetNode) {
            if (!targetNode.badges.includes('Private Endpoint')) targetNode.badges.push('Private Endpoint');
            if (peSub && !targetNode.subnet) targetNode.subnet = peSub;
            if (primaryCompute && primaryCompute.id !== targetNodeId) {
              relationships.push({
                from: primaryCompute.id,
                to: targetNodeId,
                kind: 'private-link',
                label: 'Private Link',
                protocol: 'TLS/TCP'
              });
            }
          }
        }
      }
    } else if (p.label1 === 'azurerm_role_assignment') {
      const roleNameRaw =
        extractAttr(p.body, 'role_definition_name', ctx, true) ||
        WELL_KNOWN_ROLES[extractAttr(p.body, 'role_definition_id', ctx, true)] ||
        'RBAC Access';
      const scopeExpr = extractAttr(p.body, 'scope', ctx, true) || p.body;
      const principalExpr = extractAttr(p.body, 'principal_id', ctx, true) || p.body;

      let targetId = null;
      let sourceId = primaryCompute?.id || null;
      for (const [tfAddr, nodeId] of tfAddrToNodeId.entries()) {
        if (scopeExpr.includes(tfAddr)) targetId = nodeId;
        if (principalExpr.includes(tfAddr)) sourceId = nodeId;
      }
      if (sourceId && targetId && sourceId !== targetId) {
        relationships.push({
          from: sourceId,
          to: targetId,
          kind: 'rbac',
          label: `RBAC: ${roleNameRaw}`,
          protocol: 'Entra ID MI'
        });
      }
    }
  }

  //AKS node pool attachment
  const aksNode = nodes.find((n) => n.role === 'aks');
  for (const pool of nodes.filter((n) => n.role === 'aks-node-pool')) {
    if (aksNode) {
      relationships.push({
        from: aksNode.id,
        to: pool.id,
        kind: 'hosts-pool',
        label: 'Schedules Workloads',
        protocol: 'Kubelet'
      });
    }
  }

  // Ingress -> Compute traffic edges
  const ingressNodes = nodes.filter((n) => n.category === 'ingress');
  for (const ing of ingressNodes) {
    relationships.push({
      from: 'ext:clients',
      to: ing.id,
      kind: 'ingress',
      label: 'HTTPS (443)',
      protocol: 'HTTPS'
    });
    if (primaryCompute) {
      relationships.push({
        from: ing.id,
        to: primaryCompute.id,
        kind: 'traffic',
        label: primaryCompute.role === 'aks' ? 'Ingress -> K8s Service' : 'Backend Pool (8080)',
        protocol: 'HTTP/TLS'
      });
    }
  }

  // Bastion -> VM SSH admin access
  const bastionNode = nodes.find((n) => n.role === 'bastion');
  if (bastionNode && primaryCompute && (primaryCompute.role === 'vm' || primaryCompute.role === 'vmss')) {
    relationships.push({
      from: bastionNode.id,
      to: primaryCompute.id,
      kind: 'admin-access',
      label: 'Admin SSH (22)',
      protocol: 'SSH'
    });
  }

  // Managed Identity -> Compute binding if UAMI exists
  const uamiNode = nodes.find((n) => n.role === 'managed-identity');
  if (uamiNode && primaryCompute && uamiNode.id !== primaryCompute.id) {
    relationships.push({
      from: primaryCompute.id,
      to: uamiNode.id,
      kind: 'identity',
      label: primaryCompute.role === 'aks' ? 'OIDC Workload Identity' : 'Assigned Identity',
      protocol: 'OIDC/IMDS'
    });
  }

  // Observability relationship
  const lawNode = nodes.find((n) => n.role === 'log-analytics');
  if (lawNode && primaryCompute) {
    relationships.push({
      from: primaryCompute.id,
      to: lawNode.id,
      kind: 'telemetry',
      label: primaryCompute.role === 'aks' ? 'Container Insights & Prometheus' : 'Azure Monitor Agent (VM Insights)',
      protocol: 'HTTPS'
    });
  }

  let hostingModel = 'unknown';
  if (hostingSignals.size > 1) hostingModel = 'hybrid';
  else if (hostingSignals.size === 1) hostingModel = [...hostingSignals][0];

  return {
    sourceFormat: 'terraform',
    resourceGroup,
    location,
    hostingModel,
    network: {
      vnetName,
      addressSpace,
      hubPeering,
      subnets
    },
    nodes: nodes.map(({ tfAddress, ...rest }) => rest),
    relationships
  };
}
