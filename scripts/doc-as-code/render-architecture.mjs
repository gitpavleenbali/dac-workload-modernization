import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'docs', 'workshop-presentation', 'assets');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/doc-as-code/render-architecture.mjs <selected Azure icon SVG directory>');
const iconRoot = path.resolve(process.argv[2]);
const azureIcons = 'https://learn.microsoft.com/en-us/azure/architecture/icons/';
const repo = 'https://github.com/gitpavleenbali/dac-workload-modernization';
const width = 1480;
const height = 722;
const tf = 'infra/terraform/main.tf';
const k8s = 'deploy/k8s/workloads.yaml';

const scenarios = [
  {
    id: 'vm-baseline',
    title: 'Azure virtual machine baseline',
    sha: '8a97381a2d8ba802b3ccf482fe222ebe21c894e4',
    entry: ['Bastion subnet', '10.40.0.0/26', 33],
    compute: ['Application subnet', '10.40.1.0/24', 26],
    endpoints: [
      ['postgres', 'Azure Database for PostgreSQL', '16 · 64 GiB · public access off', 134, 'pe_db', 'postgresqlServer', 164],
      ['kv', 'Azure Key Vault', 'RBAC · public access off', 145, 'pe_kv', 'vault', 178]
    ],
    workload: [
      ['bastion', 'bastion', 306, 374, 186, 63, ['Azure Bastion', 'Standard · public IP'], [tf, 58, 77]],
      ['lb', 'lb', 546, 270, 203, 58, ['Azure Load Balancer', 'Internal frontend'], [tf, 79, 90]],
      ['vm', 'vm', 546, 375, 203, 65, ['Azure Linux VM', 'systemd runs Node.js'], [tf, 92, 132]],
      ['identity', 'identity', 289, 600, 364, 59, ['VM system-assigned identity', 'Key Vault: Secrets User'], [tf, 192, 196]]
    ],
    wires: [
      ['intended', [[208, 299], [227, 299], [227, 217], [517, 217], [517, 299], [542, 299]]],
      ['intended', [[647, 328], [647, 371]]],
      ['intended', [[208, 406], [302, 406]]],
      ['intended', [[492, 406], [542, 406]]],
      ['association', [[647, 440], [647, 596]]]
    ],
    logsLine: 156
  },
  {
    id: 'aks-modernization',
    title: 'Azure Kubernetes Service modernization',
    sha: 'dc40791a22d65a2e8099fe2c122a11aeb6f0d26f',
    entry: ['Gateway subnet', '10.40.10.0/24', 33],
    compute: ['AKS node subnet', '10.40.4.0/22', 26],
    endpoints: [
      ['postgres', 'Azure Database for PostgreSQL', '16 · 128 GiB · zone-redundant HA', 209, 'pe_db', 'postgresqlServer', 244],
      ['kv', 'Azure Key Vault', 'RBAC · public access off', 225, 'pe_kv', 'vault', 258],
      ['acr', 'Azure Container Registry', 'Premium · public access off', 121, 'pe_acr', 'registry', 272],
      ['bus', 'Azure Service Bus', 'Premium · 2 messaging units', 185, 'pe_sb', 'namespace', 286],
      ['redis', 'Azure Cache for Redis', 'Premium · public access off', 195, 'pe_redis', 'redisCache', 300]
    ],
    workload: [
      ['gateway', 'gateway', 306, 270, 186, 83, ['Azure Application', 'Gateway', 'WAF v2 · public IP'], [tf, 58, 119]],
      ['aks-control', 'aks', 1068, 215, 358, 49, ['Azure Kubernetes Service control plane', 'Private API · workload identity enabled'], [tf, 136, 172]],
      ['aks', 'aks', 546, 277, 203, 69, ['AKS node pools', 'System: 2–4 nodes', 'Workload: 4–20 nodes'], [tf, 147, 183]],
      ['ingress', null, 546, 363, 203, 47, ['Ingress and Service', 'Manifest routes to port 8080'], [k8s, 65, 113]],
      ['deployment', null, 546, 425, 203, 49, ['Telemetry deployment', '4–24 pods by policy'], [k8s, 25, 94]],
      ['kubelet', 'identity', 289, 600, 364, 59, ['Kubelet managed identity', 'Container Registry: AcrPull'], [tf, 314, 318]],
      ['identity', 'identity', 674, 596, 378, 69, ['Workload managed identity', 'Key Vault secrets · Service Bus sender', 'Redis Contributor · no pod binding shown'], [tf, 320, 336]]
    ],
    wires: [
      ['intended', [[208, 299], [302, 299]]],
      ['intended', [[492, 307], [516, 307], [516, 385], [542, 385]]],
      ['declared', [[647, 410], [647, 421]]],
      ['association', [[749, 298], [777, 298], [777, 207], [1047, 207], [1047, 239], [1064, 239]]],
      ['association', [[627, 346], [627, 354], [776, 354], [776, 577], [622, 577], [622, 596]]]
    ],
    logsLine: 236
  }
];

const styles = {
  declared: { color: '#1262a2', dash: '', strokeStyle: 'solid' },
  intended: { color: '#4a6381', dash: '7 5', strokeStyle: 'dashed' },
  association: { color: '#487368', dash: '2 5', strokeStyle: 'dotted' }
};
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const cite = (sha, [file, line, end]) => `${repo}/blob/${sha}/${file}#L${line}${end ? `-L${end}` : ''}`;
const iconData = new Map();
function iconUrl(key) {
  if (!iconData.has(key)) {
    const bytes = readFileSync(path.join(iconRoot, `${key}.svg`));
    const text = bytes.toString('utf8');
    if (!/<svg\b[^>]*\bviewBox=/i.test(text) || /<\s*(script|foreignObject)\b/i.test(text)) {
      throw new Error(`Expected an original, static Azure SVG for ${key}`);
    }
    iconData.set(key, `data:image/svg+xml;base64,${bytes.toString('base64')}`);
  }
  return iconData.get(key);
}

function build(scenario) {
  const isVm = scenario.id === 'vm-baseline';
  const nodes = [];
  const scopes = [];
  const links = [];
  const labels = [];
  const sources = new Map();
  function checkedSource(ref) {
    const [file, start, end = start] = ref;
    if (!sources.has(file)) sources.set(file, execFileSync('git', ['--no-pager', 'show', `${scenario.sha}:${file}`], { cwd: root, encoding: 'utf8' }).trimEnd().split(/\r?\n/));
    if (start < 1 || end < start || end > sources.get(file).length) throw new Error(`Invalid source range: ${scenario.id} ${ref}`);
    return cite(scenario.sha, ref);
  }
  function label(text, x, y, size = 15, color = '#152d48', bold = false, group = '') {
    labels.push({ text, x, y, size, color, bold, group });
  }
  function scope(id, key, x, y, w, h, title, subtitle, kind, ref) {
    const stroke = { outer: '#a8b8c9', network: '#3575a6', subnet: '#9aafc2' }[kind];
    const dash = { outer: '', network: '8 5', subnet: '2 4' }[kind];
    const url = ref ? checkedSource(ref) : undefined;
    scopes.push({ id, key, x, y, w, h, stroke, dash, url });
    label(title, x + (key ? 39 : 13), y + 22, 17, '#152d48', true, id);
    if (subtitle) label(subtitle, x + (key ? 39 : 13), y + 41, 14, '#3d526b', false, id);
  }
  function node(id, key, x, y, w, h, lines, ref) {
    const url = ref ? checkedSource(ref) : undefined;
    if (!lines.length || lines.length > 3) throw new Error(`Invalid label count for ${id}`);
    nodes.push({ id, key, x, y, w, h, url });
    lines.forEach((text, i) => label(text, x + (key ? 47 : 11), y + (lines.length === 3 ? 22 : 20) + i * 17, i ? 13.6 : 15.5, i ? '#3d526b' : '#152d48', i === 0, id));
  }
  function edge(kind, points, arrow = true) {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      if (ax !== bx && ay !== by) throw new Error(`Non-orthogonal edge in ${scenario.id}`);
      const blocked = nodes.find(n => ax === bx
        ? ax > n.x && ax < n.x + n.w && Math.min(ay, by) < n.y + n.h && Math.max(ay, by) > n.y
        : ay > n.y && ay < n.y + n.h && Math.min(ax, bx) < n.x + n.w && Math.max(ax, bx) > n.x);
      if (blocked) throw new Error(`Connector overlaps ${blocked.id} in ${scenario.id}`);
    }
    links.push({ kind, points, arrow });
  }

  label(scenario.title, 22, 35, 26, '#142744', true);
  label(`Grid Telemetry & Dispatch Service · Terraform + deployment declarations · ${scenario.sha.slice(0, 7)}`, 22, 60, 15, '#405775');
  scope('subscription', 'subscription', 241, 78, 1219, 620, 'Azure subscription (deployment scope)', '', 'outer');
  scope('rg', 'rg', 257, 121, 1187, 561, 'Workload resource group', '', 'outer', [tf, 5, 8]);
  scope('spoke', 'vnet', 273, 168, 757, 396, 'Workload spoke virtual network', '10.40.0.0/16', 'network', [tf, 10, 15]);
  scope('entry-subnet', 'subnet', 289, 222, 216, 222, ...scenario.entry.slice(0, 2), 'subnet', [tf, scenario.entry[2], scenario.entry[2] + 5]);
  scope('compute-subnet', 'subnet', 529, 222, 237, 264, scenario.compute[0], `${scenario.compute[1]} · subnet NSG`, 'subnet', [tf, scenario.compute[2], 56]);
  scope('endpoint-subnet', 'subnet', 789, 222, 224, 329, 'Private endpoints', 'Subnet · 10.40.2.0/24', 'subnet', [tf, 40, 45]);
  label('External context', 32, 134, 17, '#152d48', true);
  label('Azure services outside the spoke VNet', 1068, 192, 17, '#152d48', true);
  label('Identity and scoped roles', 289, 587, 17, '#152d48', true);
  node('hub', 'vnet', 32, 166, 176, 58, ['Hub VNet', 'Existing; ID input'], [tf, 17, 24]);
  node('consumers', null, 32, 273, 176, 53, ['Service consumers', 'Intended entry path']);
  node('operators', null, 32, 377, 176, 61, isVm ? ['Operations team', 'Intended Bastion access'] : ['Operations team', 'Private admin path', 'Not defined in this source']);
  node('delivery', null, 32, 521, 176, 63, ['GitHub Actions', isVm ? 'Checks source and docs' : 'Builds image without push'], ['.github/workflows/dac-translator-sync.yml', 28, 46]);
  for (const args of scenario.workload) node(...args);
  scenario.endpoints.forEach(([key, title, note, line, id, target, endpointLine], i) => {
    const y = 273 + i * 55;
    const endpointLabel = { postgres: 'PostgreSQL', kv: 'Key Vault', acr: 'Container Registry', bus: 'Service Bus', redis: 'Redis' }[key];
    node(id, 'endpoint', 802, y, 198, 49, [endpointLabel, target], [tf, endpointLine, endpointLine + 12]);
    node(key, key, 1068, y, 358, 49, [title, note], [tf, line]);
    edge('declared', [[1000, y + 24], [1064, y + 24]]);
  });
  node('logs', 'logs', 1068, 606, 358, 50, ['Log Analytics workspace', 'Declared; no diagnostic attachment shown'], [tf, scenario.logsLine, scenario.logsLine + 6]);
  edge('association', [[273, 196], [210, 196]], false);
  for (const [kind, points] of scenario.wires) edge(kind, points);

  const description = `${scenario.title} in the reviewed ${scenario.sha.slice(0, 7)} source snapshot. Shows the spoke, existing hub reference, compute and ingress subnets, private endpoints and their targets, and declared identities. Intended traffic and unverified integration are not deployment evidence.`;
  return { ...scenario, nodes, scopes, labels, links, description };
}

function svg(topology) {
  const box = (r, fill, stroke, dash = '') =>
    `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const linked = ({ id, url }, body, kind) => url
    ? `<a href="${escape(url)}" data-${kind}="${id}">${body}</a>`
    : `<g data-${kind}="${id}">${body}</g>`;
  const icon = (key, x, y, size) => key
    ? `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="${iconUrl(key)}"/>` : '';
  const labels = group => topology.labels.filter(t => t.group === group).map(t =>
    `<text x="${t.x}" y="${t.y}" fill="${t.color}" font-size="${t.size}" font-family="Segoe UI, Arial, sans-serif" font-weight="${t.bold ? 700 : 400}">${escape(t.text)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escape(topology.title)}</title><desc id="desc">${escape(topology.description)}</desc>
<metadata>Source: ${repo}/tree/${topology.sha} · Azure service icons: ${azureIcons}</metadata>
<defs>${Object.entries(styles).map(([kind, s]) =>
    `<marker id="${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${s.color}"/></marker>`).join('')}</defs>
<rect width="100%" height="100%" fill="white"/>
${labels('')}
${topology.scopes.map(s => linked(s, box(s, 'none', s.stroke, s.dash) + icon(s.key, s.x + 10, s.y + 7, 22) + labels(s.id), 'scope')).join('\n')}
${topology.links.map(({ kind, points, arrow }) => `<polyline points="${points.map(p => p.join(',')).join(' ')}" fill="none" stroke="${styles[kind].color}" stroke-width="1.7"${styles[kind].dash ? ` stroke-dasharray="${styles[kind].dash}"` : ''}${arrow ? ` marker-end="url(#${kind})"` : ''}/>`).join('\n')}
${topology.nodes.map(n => linked(n, box(n, '#f6faff', '#aebfd0') + icon(n.key, n.x + 10, n.y + (n.h - 28) / 2, 28) + labels(n.id), 'node')).join('\n')}
</svg>\n`;
}

function excalidraw(topology) {
  const elements = [], files = {};
  let serial = 0;
  function add(type, x, y, w, h, extra = {}) {
    serial++;
    elements.push({
      id: `${type}-${serial}`, type, x, y, width: w, height: h, angle: 0, strokeColor: '#152d48',
      backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid',
      roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: serial,
      version: 1, versionNonce: serial, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra
    });
  }
  function addIcon(key, x, y, slot, groupIds) {
    if (!key) return;
    const dataURL = iconUrl(key);
    const viewBox = Buffer.from(dataURL.split(',')[1], 'base64').toString().match(/viewBox=["']([^"']+)/i)[1].trim().split(/[\s,]+/).map(Number);
    const factor = slot / Math.max(viewBox[2], viewBox[3]);
    const [w, h] = [viewBox[2] * factor, viewBox[3] * factor];
    files[key] = { id: key, mimeType: 'image/svg+xml', dataURL, created: 1, lastRetrieved: 1 };
    add('image', x + (slot - w) / 2, y + (slot - h) / 2, w, h, { fileId: key, status: 'saved', scale: [1, 1], crop: null, groupIds });
  }
  for (const s of topology.scopes) {
    add('rectangle', s.x, s.y, s.w, s.h, { strokeColor: s.stroke, strokeStyle: s.dash ? (s.dash === '2 4' ? 'dotted' : 'dashed') : 'solid', link: s.url ?? null });
    addIcon(s.key, s.x + 10, s.y + 7, 22, []);
  }
  for (const { kind, points, arrow } of topology.links) {
    const [[x, y]] = points;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    add(arrow ? 'arrow' : 'line', x, y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      points: points.map(([px, py]) => [px - x, py - y]), strokeColor: styles[kind].color, strokeStyle: styles[kind].strokeStyle,
      startBinding: null, endBinding: null, lastCommittedPoint: null, startArrowhead: null, endArrowhead: arrow ? 'triangle' : null, elbowed: false
    });
  }
  for (const n of topology.nodes) {
    const groupIds = [`node-${n.id}`];
    add('rectangle', n.x, n.y, n.w, n.h, { strokeColor: '#aebfd0', backgroundColor: '#f6faff', link: n.url ?? null, groupIds });
    addIcon(n.key, n.x + 10, n.y + (n.h - 28) / 2, 28, groupIds);
  }
  for (const t of topology.labels) {
    const groupIds = topology.nodes.some(n => n.id === t.group) ? [`node-${t.group}`] : [];
    add('text', t.x, t.y - t.size, Math.max(20, t.text.length * t.size * .55), t.size * 1.3, {
      text: t.text, originalText: t.text, fontSize: t.size, fontFamily: 2, textAlign: 'left', verticalAlign: 'top',
      containerId: null, autoResize: false, lineHeight: 1.3, strokeColor: t.color, groupIds
    });
  }
  return { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements, appState: { viewBackgroundColor: '#ffffff' }, files };
}

const diagrams = scenarios.map(build);
mkdirSync(destination, { recursive: true });
for (const topology of diagrams) {
  writeFileSync(path.join(destination, `${topology.id}.svg`), svg(topology));
  writeFileSync(path.join(destination, `${topology.id}.excalidraw`), `${JSON.stringify(excalidraw(topology))}\n`);
  console.log(`${topology.id}: ${topology.scopes.length} scopes, ${topology.nodes.length} nodes, ${topology.links.length} connections (${topology.sha.slice(0, 7)})`);
}
