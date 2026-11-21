export { AZURE_TAXONOMY, computeSemanticHash, normalizeIRForHashing, validateArchitectureIR } from './ir/schema.mjs';
export { computeArchitectureDelta } from './ir/diff-engine.mjs';
export { extractTerraformDirectory, parseHclTopBlocks, stripCommentsPreservingStrings } from './extractors/terraform-extractor.mjs';
export { extractBicepDirectory } from './extractors/bicep-extractor.mjs';
export { extractWorkloadsAndApi } from './extractors/workload-extractor.mjs';
export { buildArchitectureIR } from './extractors/composite-extractor.mjs';
export { renderTopologyMermaid, renderRuntimeAndDeliveryMermaid } from './renderers/mermaid-renderer.mjs';
export {
  upsertManagedBlocks,
  buildLocalRepoBlocks,
  buildCentralRepoBlocks,
  renderAllDocumentation
} from './renderers/markdown-renderer.mjs';
export {
  validateMermaidBlock,
  validateMarkdownMermaidBlocks,
  verifyManagedBlocksAndHumanProse
} from './validators/mermaid-validator.mjs';
export {
  generateGroundedAiNarrative,
  buildDeterministicExecutiveBrief,
  formatSyncPullRequestBody
} from './ai/enricher.mjs';
export { publishCentralDocsPullRequest } from './publishers/github-pr-publisher.mjs';
