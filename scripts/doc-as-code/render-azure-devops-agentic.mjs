#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workshopRoot = path.resolve(scriptDir, '..', '..', 'docs', 'workshop-presentation');
const assetsDir = path.join(workshopRoot, 'assets');
const iconDir = path.join(scriptDir, 'azure-icons');
const outputBase = path.join(assetsDir, 'azure-devops-agentic-dac');
const svgPath = `${outputBase}.svg`;
const pngPath = `${outputBase}.png`;
const excalidrawPath = `${outputBase}.excalidraw`;
const width = 1600;
const height = 1120;

const iconSources = {
  devops: path.join(iconDir, 'azure-devops.svg'),
  foundry: path.join(iconDir, 'foundry-agent-service.svg'),
  policy: path.join(iconDir, 'azure-policy.svg'),
  identity: path.join(iconDir, 'identity-governance.svg')
};

for (const file of Object.values(iconSources)) {
  if (!fs.existsSync(file)) throw new Error(`Missing official icon: ${file}`);
}

const icons = Object.fromEntries(
  Object.entries(iconSources).map(([name, file]) => {
    const bytes = fs.readFileSync(file);
    return [name, `data:image/svg+xml;base64,${bytes.toString('base64')}`];
  })
);

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const text = (x, y, value, {
  size = 17,
  weight = 400,
  fill = '#172033',
  anchor = 'start'
} = {}) => `<text x="${x}" y="${y}" fill="${fill}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;

const lines = (x, y, values, options = {}) =>
  values.map((value, index) => text(x, y + index * (options.lineHeight || 25), value, options)).join('\n');

const image = (name, x, y, size = 46) =>
  `<image href="${icons[name]}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;

const nodeW = 310;
const nodeH = 230;
const nodes = [
  { id: 'repos', x: 40, y: 270, title: 'Azure Repos', icon: 'devops', body: ['Workload repositories', 'Central documentation', 'dac-manifest.json'] },
  { id: 'dac', x: 430, y: 270, title: 'Stage 1 · Deterministic DAC', icon: 'devops', body: ['Extract ArchitectureIR', 'Compute semantic delta', 'Render managed blocks'] },
  { id: 'evidence', x: 820, y: 270, title: 'Bounded evidence', icon: null, body: ['IR + delta JSON', 'Semantic hash', 'Exact source commit'] },
  { id: 'foundry', x: 1210, y: 270, title: 'Stage 2 · Foundry Agent', icon: 'foundry', body: ['Optional prompt agent', 'Bounded narrative', 'Strict structured output'] },
  { id: 'verify', x: 1210, y: 590, title: 'Stage 3 · Independent verify', icon: 'policy', body: ['Match deterministic evidence', 'Allowlisted paths', 'Mermaid + prose gate'] },
  { id: 'pr', x: 820, y: 590, title: 'Stage 4 · Azure Repos PR', icon: 'devops', body: ['dac-sync/<service-id>', 'Draft pull request', 'Build validation'] },
  { id: 'human', x: 430, y: 590, title: 'Human + policy gate', icon: 'identity', body: ['Required reviewers', 'Comments resolved', 'Controlled merge'] }
];
const nodeMap = new Map(nodes.map(node => [node.id, node]));
const center = (node) => ({ x: node.x + nodeW / 2, y: node.y + nodeH / 2 });
const mainEdges = [
  { from: 'repos', to: 'dac', label: 'Trigger', direction: 'right' },
  { from: 'dac', to: 'evidence', label: 'IR + hash', direction: 'right' },
  { from: 'evidence', to: 'foundry', label: 'Evidence JSON', direction: 'right' },
  { from: 'foundry', to: 'verify', label: 'Structured output', direction: 'down' },
  { from: 'verify', to: 'pr', label: 'Verified patch', direction: 'left' },
  { from: 'pr', to: 'human', label: 'PR policies', direction: 'left' }
];
const controls = [
  ['Workload identity', 'No stored Foundry API key'],
  ['Separate identities', 'Agent caller cannot push'],
  ['Least privilege', 'Foundry Agent Consumer'],
  ['PR governance', 'Draft + required reviewers'],
  ['Generated facts', 'Deterministic DAC authority']
];

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="diagram-title diagram-desc">`,
  '<title id="diagram-title">Azure DevOps remediation pattern for agentic Doc as Code</title>',
  '<desc id="diagram-desc">Azure Repos triggers Azure Pipelines. Deterministic DAC produces architecture evidence. An optional Microsoft Foundry Agent produces bounded structured output. An independent verifier checks the patch. Azure Repos policies govern the draft pull request and merge.</desc>',
  '<defs>',
  '<marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L10,3.5 L0,7 Z" fill="#426a8c"/></marker>',
  '<marker id="arrowGreen" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L10,3.5 L0,7 Z" fill="#2f7d61"/></marker>',
  '</defs>',
  `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  text(40, 48, 'Azure DevOps remediation pattern for agentic Doc as Code', { size: 31, weight: 700, fill: '#112947' }),
  text(40, 79, 'Recommended custom architecture · source-defined pattern · not implemented in the workshop MVP', { size: 16, fill: '#4b6078' }),
  '<rect x="40" y="106" width="1520" height="116" rx="8" fill="#fff5f3" stroke="#c85a45" stroke-width="1.5"/>',
  text(60, 139, 'Azure DevOps challenge', { size: 19, weight: 700, fill: '#8b2f24' }),
  text(60, 173, 'Azure Repos has native AI review and local agent assistance, but not full GitHub cloud-agent / Agentic Workflows parity.', { size: 15, fill: '#5e342f' }),
  text(60, 200, 'Mitigation: keep generated facts deterministic, add a governed Foundry invocation, and publish through Azure Repos-specific PR APIs.', { size: 15, fill: '#5e342f' })
];

for (const node of nodes) {
  svg.push(`<rect x="${node.x}" y="${node.y}" width="${nodeW}" height="${nodeH}" rx="10" fill="#ffffff" stroke="#7696b3" stroke-width="1.5"/>`);
  svg.push(`<rect x="${node.x}" y="${node.y}" width="${nodeW}" height="62" rx="10" fill="#eef5fb"/>`);
  if (node.icon) svg.push(image(node.icon, node.x + 14, node.y + 13, 36));
  else svg.push(`<path d="M${node.x + 18} ${node.y + 17}h28v32h-28z M${node.x + 24} ${node.y + 25}h16 M${node.x + 24} ${node.y + 32}h16 M${node.x + 24} ${node.y + 39}h12" fill="none" stroke="#0078d4" stroke-width="2"/>`);
  svg.push(text(node.x + 58, node.y + 39, node.title, { size: 17, weight: 700, fill: '#112947' }));
  svg.push(lines(node.x + 20, node.y + 101, node.body, { size: 15, fill: '#334a62', lineHeight: 34 }));
}

for (const edge of mainEdges) {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (edge.direction === 'right') {
    const x1 = from.x + nodeW;
    const x2 = to.x - 8;
    const y = center(from).y;
    svg.push(`<path d="M${x1} ${y} H${x2}" fill="none" stroke="#426a8c" stroke-width="2.2" marker-end="url(#arrow)"/>`);
    svg.push(text((x1 + x2) / 2, y - 14, edge.label, { size: 12, weight: 600, fill: '#426a8c', anchor: 'middle' }));
  } else if (edge.direction === 'left') {
    const x1 = from.x;
    const x2 = to.x + nodeW + 8;
    const y = center(from).y;
    svg.push(`<path d="M${x1} ${y} H${x2}" fill="none" stroke="#426a8c" stroke-width="2.2" marker-end="url(#arrow)"/>`);
    svg.push(text((x1 + x2) / 2, y - 14, edge.label, { size: 12, weight: 600, fill: '#426a8c', anchor: 'middle' }));
  } else {
    const x = center(from).x;
    const y1 = from.y + nodeH;
    const y2 = to.y - 8;
    svg.push(`<path d="M${x} ${y1} V${y2}" fill="none" stroke="#426a8c" stroke-width="2.2" marker-end="url(#arrow)"/>`);
    svg.push(text(x + 14, (y1 + y2) / 2, edge.label, { size: 12, weight: 600, fill: '#426a8c' }));
  }
}

const evidence = nodeMap.get('evidence');
const verify = nodeMap.get('verify');
svg.push(`<path d="M${center(evidence).x} ${evidence.y + nodeH} V548 H${center(verify).x} V${verify.y - 8}" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-dasharray="7 6" marker-end="url(#arrow)"/>`);
svg.push(text(1170, 543, 'Agent optional: evidence may bypass Foundry', { size: 13, weight: 600, fill: '#5b6470', anchor: 'middle' }));

const human = nodeMap.get('human');
const repos = nodeMap.get('repos');
svg.push(`<path d="M${human.x} ${center(human).y} H${center(repos).x} V${repos.y + nodeH + 8}" fill="none" stroke="#2f7d61" stroke-width="2.2" marker-end="url(#arrowGreen)"/>`);
svg.push(text(298, 844, 'Approved merge', { size: 13, weight: 600, fill: '#2f7d61', anchor: 'middle' }));

svg.push('<rect x="40" y="858" width="1520" height="196" rx="10" fill="#f3f8f6" stroke="#5b9b7e" stroke-width="1.5"/>');
svg.push(text(60, 893, 'Security and operating controls', { size: 20, weight: 700, fill: '#245e48' }));
controls.forEach(([title, detail], index) => {
  const x = 60 + index * 300;
  svg.push(`<rect x="${x}" y="918" width="280" height="99" rx="7" fill="#ffffff" stroke="#a8c8b7"/>`);
  svg.push(text(x + 14, 947, title, { size: 15, weight: 700, fill: '#245e48' }));
  svg.push(text(x + 14, 979, detail, { size: 13, fill: '#4b665a' }));
});
svg.push(text(40, 1092, 'Static configuration and recommended controls—not proof of a deployed integration.', { size: 12, fill: '#6b7280' }));
svg.push('</svg>');

fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(svgPath, svg.join('\n'), 'utf8');

let seed = 1200;
const elements = [];
const common = (id, type, x, y, w, h, extra = {}) => ({
  id, type, x, y, width: w, height: h, angle: 0,
  strokeColor: extra.strokeColor || '#7696b3',
  backgroundColor: extra.backgroundColor || 'transparent',
  fillStyle: 'solid', strokeWidth: extra.strokeWidth || 1,
  strokeStyle: extra.strokeStyle || 'solid', roughness: 0, opacity: 100,
  groupIds: [], frameId: null, roundness: type === 'rectangle' ? { type: 3 } : null,
  seed: seed++, version: 1, versionNonce: seed * 17, isDeleted: false,
  boundElements: null, updated: 1, locked: false, ...extra
});
const textElement = (id, x, y, w, h, value, size = 16, color = '#172033', align = 'left') =>
  common(id, 'text', x, y, w, h, {
    strokeColor: color, backgroundColor: 'transparent', text: value, originalText: value,
    fontSize: size, fontFamily: 2, textAlign: align, verticalAlign: 'top',
    containerId: null, autoResize: false, lineHeight: 1.3
  });
const files = Object.fromEntries(Object.entries(icons).map(([name, dataURL]) => [
  `icon-${name}`,
  { id: `icon-${name}`, mimeType: 'image/svg+xml', dataURL, created: 1, lastRetrieved: 1 }
]));
const imageElement = (id, fileId, x, y, w, h) => common(id, 'image', x, y, w, h, {
  strokeColor: 'transparent', fileId, status: 'saved', scale: [1, 1], crop: null
});
const arrowFromPoints = (id, points, color = '#426a8c', dashed = false) => {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const normalized = points.map(([x, y]) => [x - minX, y - minY]);
  return common(id, 'arrow', minX, minY, Math.max(...xs) - minX || 1, Math.max(...ys) - minY || 1, {
    strokeColor: color, strokeWidth: 2, strokeStyle: dashed ? 'dashed' : 'solid',
    points: normalized, startBinding: null, endBinding: null,
    lastCommittedPoint: null, startArrowhead: null, endArrowhead: 'triangle', elbowed: false
  });
};

elements.push(textElement('title', 40, 30, 950, 48, 'Azure DevOps remediation pattern for agentic Doc as Code', 30, '#112947'));
elements.push(textElement('subtitle', 40, 76, 1100, 28, 'Recommended custom architecture · not implemented in the workshop MVP', 16, '#4b6078'));
elements.push(common('challenge', 'rectangle', 40, 106, 1520, 116, { strokeColor: '#c85a45', backgroundColor: '#fff5f3', strokeWidth: 2 }));
elements.push(textElement('challenge-title', 60, 126, 280, 28, 'Azure DevOps challenge', 19, '#8b2f24'));
elements.push(textElement('challenge-body', 60, 164, 1440, 48, 'Azure Repos has native AI review and local agent assistance, but not full GitHub cloud-agent / Agentic Workflows parity.\nMitigation: deterministic DAC + governed Foundry invocation + Azure Repos-specific publisher.', 15, '#5e342f'));

for (const node of nodes) {
  elements.push(common(`box-${node.id}`, 'rectangle', node.x, node.y, nodeW, nodeH, { strokeColor: '#7696b3', backgroundColor: '#ffffff', strokeWidth: 2 }));
  if (node.icon) elements.push(imageElement(`img-${node.id}`, `icon-${node.icon}`, node.x + 14, node.y + 14, 42, 42));
  elements.push(textElement(`title-${node.id}`, node.x + 62, node.y + 20, 230, 44, node.title, 16, '#112947'));
  elements.push(textElement(`body-${node.id}`, node.x + 20, node.y + 96, 270, 120, node.body.join('\n'), 15, '#334a62'));
}
for (const edge of mainEdges) {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  let points;
  if (edge.direction === 'right') points = [[from.x + nodeW, center(from).y], [to.x - 8, center(to).y]];
  else if (edge.direction === 'left') points = [[from.x, center(from).y], [to.x + nodeW + 8, center(to).y]];
  else points = [[center(from).x, from.y + nodeH], [center(to).x, to.y - 8]];
  elements.push(arrowFromPoints(`arrow-${edge.from}-${edge.to}`, points));
}
elements.push(arrowFromPoints('optional-evidence', [
  [center(evidence).x, evidence.y + nodeH],
  [center(evidence).x, 548],
  [center(verify).x, 548],
  [center(verify).x, verify.y - 8]
], '#6b7280', true));
elements.push(arrowFromPoints('merge-loop', [
  [human.x, center(human).y],
  [center(repos).x, center(human).y],
  [center(repos).x, repos.y + nodeH + 8]
], '#2f7d61'));
elements.push(common('controls', 'rectangle', 40, 858, 1520, 196, { strokeColor: '#5b9b7e', backgroundColor: '#f3f8f6', strokeWidth: 2 }));
elements.push(textElement('controls-title', 60, 880, 400, 30, 'Security and operating controls', 20, '#245e48'));
controls.forEach(([title, detail], index) => {
  const x = 60 + index * 300;
  elements.push(common(`control-${index}`, 'rectangle', x, 918, 280, 99, { strokeColor: '#a8c8b7', backgroundColor: '#ffffff' }));
  elements.push(textElement(`control-title-${index}`, x + 14, 936, 250, 24, title, 15, '#245e48'));
  elements.push(textElement(`control-body-${index}`, x + 14, 970, 250, 30, detail, 13, '#4b665a'));
});

fs.writeFileSync(excalidrawPath, JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'iac-to-architecture',
  elements,
  appState: { viewBackgroundColor: '#ffffff' },
  files
}, null, 2), 'utf8');

const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const edge = edgeCandidates.find(fs.existsSync);
if (!edge) throw new Error('Microsoft Edge is required to render the PNG.');
const wrapper = path.join(assetsDir, '.azure-devops-agentic-dac-render.html');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-diagram-edge-'));
const pngWidthExpected = width * 2;
const pngHeightExpected = height * 2;
try {
  fs.writeFileSync(wrapper, `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:${pngWidthExpected}px;height:${pngHeightExpected}px;overflow:hidden;background:white}img{display:block;width:${pngWidthExpected}px;height:${pngHeightExpected}px}</style><img src="${pathToFileURL(svgPath).href}">`, 'utf8');
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${profile}`, `--window-size=${pngWidthExpected},${pngHeightExpected}`,
    '--force-device-scale-factor=1', `--screenshot=${pngPath}`, pathToFileURL(wrapper).href
  ], { stdio: 'ignore' });
} finally {
  fs.rmSync(wrapper, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}

const png = fs.readFileSync(pngPath);
if (png.toString('ascii', 1, 4) !== 'PNG') throw new Error('PNG rendering failed.');
const pngWidth = png.readUInt32BE(16);
const pngHeight = png.readUInt32BE(20);
if (pngWidth !== pngWidthExpected || pngHeight !== pngHeightExpected) {
  throw new Error(`Unexpected PNG dimensions ${pngWidth}x${pngHeight}.`);
}

console.log(JSON.stringify({
  svg: svgPath,
  png: pngPath,
  excalidraw: excalidrawPath,
  pngDimensions: `${pngWidth}x${pngHeight}`,
  nodes: nodes.length,
  officialIcons: Object.keys(icons)
}, null, 2));
