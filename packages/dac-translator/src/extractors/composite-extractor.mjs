import fs from 'node:fs';
import path from 'node:path';
import { computeSemanticHash, validateArchitectureIR } from '../ir/schema.mjs';
import { extractTerraformDirectory } from './terraform-extractor.mjs';
import { extractBicepDirectory } from './bicep-extractor.mjs';
import { extractWorkloadsAndApi } from './workload-extractor.mjs';

/**
 * Build a complete, schema-validated Canonical ArchitectureIR from a repository root.
 */
export function buildArchitectureIR(repoRoot, options = {}) {
  const manifestPath = path.join(repoRoot, 'dac-manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {
        serviceId: path.basename(repoRoot),
        serviceName: path.basename(repoRoot),
        landingZone: 'alz-workload-prod',
        environment: 'prod',
        ownerTeam: '@platform-owners',
        centralDocsProductPath: `products/${path.basename(repoRoot)}`
      };

  const tfDir = path.join(repoRoot, manifest.paths?.terraform || 'infra/terraform');
  const bicepDir = path.join(repoRoot, manifest.paths?.bicep || 'infra/bicep');

  const tfResult = extractTerraformDirectory(tfDir);
  const bicepResult = extractBicepDirectory(bicepDir);
  const primaryInfra = tfResult || bicepResult;

  if (!primaryInfra) {
    throw new Error(`No Terraform or Bicep infrastructure found under ${repoRoot}`);
  }

  const workloadData = extractWorkloadsAndApi(repoRoot);

  const ir = {
    schemaVersion: '1.0.0',
    extractedAt: options.extractedAt || new Date().toISOString(),
    sourceCommit: options.sourceCommit || 'working-tree',
    sourceRepo: options.sourceRepo || manifest.sourceRepo || manifest.serviceId,
    iacFormatsDetected: [
      ...(tfResult ? ['terraform'] : []),
      ...(bicepResult ? ['bicep'] : [])
    ],
    service: {
      id: manifest.serviceId,
      name: manifest.serviceName,
      description: manifest.description || '',
      landingZone: manifest.landingZone,
      environment: manifest.environment || 'prod',
      region: primaryInfra.location || manifest.region || 'westeurope',
      resourceGroup: primaryInfra.resourceGroup || manifest.resourceGroup || `rg-${manifest.serviceId}`,
      ownerTeam: manifest.ownerTeam || '@platform-owners',
      centralDocsProductPath: manifest.centralDocsProductPath || `products/${manifest.serviceId}`,
      sloAvailability: manifest.sloAvailability || '99.9%'
    },
    hostingModel: primaryInfra.hostingModel,
    network: primaryInfra.network,
    nodes: primaryInfra.nodes,
    relationships: primaryInfra.relationships,
    workloads: workloadData.workloads,
    apiEndpoints: workloadData.apiEndpoints,
    semanticHash: ''
  };

  ir.semanticHash = computeSemanticHash(ir);
  const validation = validateArchitectureIR(ir);
  if (!validation.valid) {
    throw new Error(`Invalid ArchitectureIR: ${validation.errors.join('; ')}`);
  }
  return ir;
}
