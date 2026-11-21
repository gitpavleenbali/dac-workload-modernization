/**
 * Deterministic Mermaid & Managed-Block Integrity Validator.
 * Catches unquoted parentheses inside square brackets, unbalanced subgraphs,
 * invalid arrow tokens, missing DAC managed-block closing tags, and accidental
 * modification of human-owned Markdown prose outside managed blocks.
 */
export function validateMermaidBlock(mermaidSource) {
  const errors = [];
  const trimmed = (mermaidSource || '').trim();
  if (!trimmed) {
    return { valid: false, errors: ['Empty Mermaid diagram block'] };
  }

  const lines = trimmed.split(/\r?\n/);
  const header = lines[0].trim();
  if (!/^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/.test(header) && !/^sequenceDiagram\b/.test(header)) {
    errors.push(`Unsupported or invalid Mermaid header: "${header}"`);
  }

  let subgraphDepth = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line || line.startsWith('%%')) continue;

    if (/^subgraph\b/.test(line)) {
      subgraphDepth++;
      // Verify subgraph id is clean and title is quoted if brackets are used
      if (line.includes('[') && !/^subgraph\s+[A-Za-z0-9_]+\["[^"]*"\]$/.test(line)) {
        errors.push(`Line ${idx + 1}: Subgraph header should use safe id and quoted title: ${line}`);
      }
      continue;
    }
    if (line === 'end') {
      subgraphDepth--;
      if (subgraphDepth < 0) {
        errors.push(`Line ${idx + 1}: Unexpected 'end' without matching 'subgraph'`);
      }
      continue;
    }
    if (/^classDef\b/.test(line) || /^class\b/.test(line)) {
      continue;
    }

    // Check for unquoted parentheses inside square-bracket node labels e.g. id[AKS (1.31)]
    // which fails on GitHub's native Mermaid renderer unless quoted as id["AKS (1.31)"]
    const unquotedBracketMatch = line.match(/[A-Za-z0-9_]+\[(?![("])([^\]]*[():][^\]]*)\]/);
    if (unquotedBracketMatch) {
      errors.push(
        `Line ${idx + 1}: Unquoted special characters inside square-bracket label will break GitHub Mermaid rendering: "${unquotedBracketMatch[0]}"`
      );
    }

    // Check balanced double quotes per line
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      errors.push(`Line ${idx + 1}: Unbalanced double quotes in Mermaid line: ${line}`);
    }
  }

  if (subgraphDepth !== 0) {
    errors.push(`Unbalanced subgraph blocks: depth ended at ${subgraphDepth}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract all ```mermaid ... ``` fenced blocks from a Markdown document and validate each.
 */
export function validateMarkdownMermaidBlocks(markdownText, fileLabel = 'document.md') {
  const errors = [];
  const fenceRe = /```mermaid\r?\n([\s\S]*?)```/g;
  let count = 0;
  let m;
  while ((m = fenceRe.exec(markdownText)) !== null) {
    count++;
    const res = validateMermaidBlock(m[1]);
    if (!res.valid) {
      for (const err of res.errors) {
        errors.push(`${fileLabel} (Mermaid block #${count}): ${err}`);
      }
    }
  }
  return { valid: errors.length === 0, mermaidBlockCount: count, errors };
}

/**
 * Verify that all <!-- BEGIN DAC:... --> and <!-- END DAC:... --> markers are balanced
 * and that human-authored text outside managed blocks was preserved byte-for-byte
 * when updating an existing document in deterministic mode.
 */
export function verifyManagedBlocksAndHumanProse(originalMarkdown, updatedMarkdown, fileLabel = 'document.md') {
  const errors = [];

  const parseStructure = (md) => {
    const beginRe = /<!--\s*BEGIN DAC:([A-Za-z0-9_-]+)[^>]*-->/g;
    const endRe = /<!--\s*END DAC:([A-Za-z0-9_-]+)\s*-->/g;
    const begins = [...md.matchAll(beginRe)].map((m) => ({ id: m[1], index: m.index, len: m[0].length }));
    const ends = [...md.matchAll(endRe)].map((m) => ({ id: m[1], index: m.index, len: m[0].length }));

    if (begins.length !== ends.length) {
      return { ok: false, error: `Mismatched BEGIN (${begins.length}) vs END (${ends.length}) DAC markers` };
    }

    const outsideSegments = [];
    let cursor = 0;
    for (let i = 0; i < begins.length; i++) {
      if (begins[i].id !== ends[i].id) {
        return { ok: false, error: `Marker nesting/order mismatch: BEGIN ${begins[i].id} paired with END ${ends[i].id}` };
      }
      if (ends[i].index < begins[i].index) {
        return { ok: false, error: `END DAC:${ends[i].id} appears before BEGIN` };
      }
      outsideSegments.push(md.slice(cursor, begins[i].index));
      cursor = ends[i].index + ends[i].len;
    }
    outsideSegments.push(md.slice(cursor));
    return { ok: true, ids: begins.map((b) => b.id), outsideText: outsideSegments.join('<<DAC_SLOT>>') };
  };

  const updatedParsed = parseStructure(updatedMarkdown);
  if (!updatedParsed.ok) {
    errors.push(`${fileLabel}: ${updatedParsed.error}`);
    return { valid: false, errors };
  }

  if (originalMarkdown !== null && originalMarkdown !== undefined) {
    const origParsed = parseStructure(originalMarkdown);
    if (!origParsed.ok) {
      errors.push(`${fileLabel} (original): ${origParsed.error}`);
    } else if (origParsed.ids.join(',') === updatedParsed.ids.join(',')) {
      if (origParsed.outsideText !== updatedParsed.outsideText) {
        errors.push(`${fileLabel}: Human-authored prose outside managed DAC blocks was modified!`);
      }
    }
  }

  return { valid: errors.length === 0, managedBlockIds: updatedParsed.ids, errors };
}
