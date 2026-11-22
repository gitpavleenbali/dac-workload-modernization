import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../docs/workshop-presentation/', import.meta.url));
if (process.argv.length !== 3) {
  throw new Error('Usage: node scripts/doc-as-code/package-site.mjs <new output directory>');
}

const output = path.resolve(process.argv[2]);
const topologyAssets = ['vm-baseline', 'aks-modernization'].flatMap(name =>
  ['svg', 'png', 'excalidraw'].map(ext => `assets/${name}.${ext}`));
if (!lstatSync(path.join(source, 'assets')).isDirectory()) {
  throw new Error('The site assets directory must not be a symbolic link.');
}
if (!lstatSync(path.join(source, 'dac.html')).isFile()) {
  throw new Error('The workshop page must be a regular file.');
}
const html = readFileSync(path.join(source, 'dac.html'), 'utf8');
for (const id of ['workshop-intro', 'workshop-fullscreen', 'cross-team-flow', 'why', 'why-deck', 'opening-story', 'story-detail', 'facilitator-mode', 'what', 'what-deck', 'portable-core-story', 'fingerprints', 'pipeline-flow', 'pipeline-detail', 'map-pipeline',
  'presentation', 'diagram-viewer', 'how', 'how-deck', 'how-story', 'topology-comparison', 'file-comparison', 'compare-code', 'compare-readme', 'workflow-terms',
  'compare-provenance', 'option-two-local', 'fixture-workload', 'fixture-central', 'evidence-tour', 'evidence-index', 'evidence-deck', 'glossary']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing site section: ${id}`);
}
const relativeAssets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(match => match[1]);
const workshopDiagrams = [...new Set(relativeAssets.filter(file => /^assets\/workshop-diagram-[a-f0-9]{12}\.svg$/.test(file)))];
if (workshopDiagrams.length < 4) throw new Error('The workshop Mermaid diagrams were not embedded.');
const storyAssets = ['why', 'what', 'how', 'core', 'local', 'review'].map(chapter => `assets/story-${chapter}.png`);
const openingAssets = ['assets/doc-as-code-mark.svg', 'assets/cross-team-projection.webp',
  ...['change', 'refresh', 'review'].map(scene => `assets/story-how-${scene}.webp`)];
const assets = [...topologyAssets, ...workshopDiagrams, ...storyAssets, ...openingAssets];
if (assets.some(file => !relativeAssets.includes(file)) || relativeAssets.some(file => !assets.includes(file))) {
  throw new Error('The HTML references do not match the Pages asset allowlist.');
}
const files = ['dac.html', ...assets];
for (const file of files) {
  if (!lstatSync(path.join(source, file)).isFile()) {
    throw new Error(`Expected a regular site file: ${file}`);
  }
}

mkdirSync(path.dirname(output), { recursive: true });
mkdirSync(output);
mkdirSync(path.join(output, 'assets'));
for (const file of files) copyFileSync(path.join(source, file), path.join(output, file));
copyFileSync(path.join(source, 'dac.html'), path.join(output, 'index.html'));
console.log(`Prepared ${readdirSync(output).join(', ')} with ${assets.length} allowlisted assets.`);
