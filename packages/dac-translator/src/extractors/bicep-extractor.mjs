import fs from 'node:fs';
import path from 'node:path';
import { AZURE_TAXONOMY } from '../ir/schema.mjs';
import { stripCommentsPreservingStrings } from './terraform-extractor.mjs';

/**
 * Lightweight Bicep extractor supporting param defaults and resource declarations
 * (`resource sym 'Microsoft.Provider/type@api' = { ... }`).
 */
export function extractBicepDirectory(bicepDir) {
  if (!fs.existsSync(bicepDir)) return null;
  const files = fs
    .readdirSync(bicepDir)
    .filter((f) => f.endsWith('.bicep'))
    .sort();
  if (files.length === 0) return null;

  const combined = stripCommentsPreservingStrings(
    files.map((f) => fs.readFileSync(path.join(bicepDir, f), 'utf8')).join('\n\n')
  );

  const params = {};
  for (const line of combined.split(/\r?\n/)) {
    const pm = line.match(/^\s*param\s+([A-Za-z0-9_]+)\s+[A-Za-z0-9_]+\s*=\s*'([^']*)'/);
    if (pm) params[pm[1]] = pm[2];
  }

  const resRe = /\bresource\s+([A-Za-z0-9_]+)\s+'([^'@]+)@[^']+'\s*=\s*\{/g;
  const nodes = [];
  const subnets = [];
  let vnetName = null;
  const addressSpace = [];
  const hostingSignals = new Set();

  let m;
  while ((m = resRe.exec(combined)) !== null) {
    const sym = m[1];
    const armType = m[2];
    const openIdx = combined.indexOf('{', m.index);
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < combined.length; i++) {
      if (combined[i] === '{') depth++;
      else if (combined[i] === '}') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) continue;
    const body = combined.slice(openIdx + 1, closeIdx);
    const nameMatch = body.match(/\bname\s*:\s*'([^']+)'/) || body.match(/\bname\s*:\s*([A-Za-z0-9_]+)/);
    const rawName = nameMatch ? params[nameMatch[1]] || nameMatch[1] : sym;

    if (armType === 'Microsoft.Network/virtualNetworks') {
      vnetName = rawName;
      const addrMatch = body.match(/addressPrefixes\s*:\s*\[\s*'([^']+)'/);
      if (addrMatch) addressSpace.push(addrMatch[1]);
      const subRe = /\{\s*name\s*:\s*'([^']+)'[\s\S]*?addressPrefix\s*:\s*'([^']+)'/g;
      let sm;
      while ((sm = subRe.exec(body)) !== null) {
        subnets.push({ id: `subnet:${sm[1]}`, name: sm[1], cidr: sm[2], delegation: null, nsg: null });
      }
    }

    const tax = AZURE_TAXONOMY[armType];
    if (tax && tax.category !== 'boundary' && tax.category !== 'plumbing') {
      if (tax.hostingSignal) hostingSignals.add(tax.hostingSignal);
      const skuMatch = body.match(/\bsku\s*:\s*\{\s*name\s*:\s*'([^']+)'/) || body.match(/vmSize\s*:\s*'([^']+)'/);
      nodes.push({
        id: `${tax.role}:${sym}`,
        name: rawName,
        role: tax.role,
        category: tax.category,
        displayType: tax.displayType,
        sku: skuMatch ? skuMatch[1] : 'Standard',
        subnet: null,
        badges: [],
        properties: {}
      });
    }
    resRe.lastIndex = closeIdx + 1;
  }

  let hostingModel = 'unknown';
  if (hostingSignals.size > 1) hostingModel = 'hybrid';
  else if (hostingSignals.size === 1) hostingModel = [...hostingSignals][0];

  return {
    sourceFormat: 'bicep',
    resourceGroup: params.resourceGroupName || null,
    location: params.location || 'westeurope',
    hostingModel,
    network: { vnetName, addressSpace, hubPeering: null, subnets },
    nodes,
    relationships: []
  };
}
