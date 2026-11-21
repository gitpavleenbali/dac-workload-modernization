---
name: Agentic Architecture & Documentation Synchronizer
description: Uses GitHub Agentic Workflows (gh-aw) to inspect IaC/workload diffs, update Mermaid diagrams and audience guides across repositories, and propose a validated Draft PR via Safe Outputs.
on:
  pull_request:
    branches: [main]
    paths:
      - "infra/**"
      - "deploy/**"
      - "Dockerfile"
      - "openapi/**"
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  pull-requests: read

checkout:
  - fetch-depth: 0
  - repository: gitpavleenbali/dac-central-platform-docs
    path: ./central-docs
    current: true
    github-token: ${{ secrets.DAC_CENTRAL_DOCS_TOKEN }}

network:
  allowed:
    - defaults
    - node

tools:
  github:
    toolsets: [repos, issues, pull_requests]
    allowed-repos:
      - "gitpavleenbali/dac-workload-modernization"
      - "gitpavleenbali/dac-central-platform-docs"
  edit:
  bash: true

timeout-minutes: 25

safe-outputs:
  github-token: ${{ secrets.DAC_CENTRAL_DOCS_TOKEN }}
  create-pull-request:
    target-repo: "gitpavleenbali/dac-central-platform-docs"
    allowed-repos:
      - "gitpavleenbali/dac-central-platform-docs"
    title-prefix: "[Agentic DaC] "
    labels: [documentation, architecture-sync, agentic-workflow]
    draft: true
    preserve-branch-name: true
    recreate-ref: true
    protected-files: fallback-to-issue
---

# Agentic Architecture & Documentation Synchronizer (`gh-aw`)

You are an autonomous Docs-as-Code Cloud Architect running inside a read-only GitHub Agentic Workflow sandbox.

## Mission

Inspect recent infrastructure, container/Kubernetes, and API changes in the source workload repository (`.` workspace root) and synchronize the target Centralized Platform Documentation repository checked out at `./central-docs`.

## Steps

1. **Analyze Infrastructure & Workload Delta:**
   - Run `git log -n 5 --stat` and inspect `infra/terraform/`, `infra/bicep/`, `deploy/`, `Dockerfile`, and `openapi/openapi.yaml`.
   - Run `node packages/dac-translator/bin/dac-translator.mjs extract --out /tmp/current-ir.json` to inspect the resolved Canonical Architecture IR.
2. **Synchronize Deterministic Blocks & Diagrams:**
   - Run `node packages/dac-translator/bin/dac-translator.mjs render --central-docs ./central-docs` to update managed Mermaid topology/runtime diagrams, CIDR tables, RBAC matrices, and `dac-provenance.json`.
3. **Curate Narrative ADRs & Operational Context:**
   - Inspect `./central-docs/products/grid-telemetry-service/architecture.md`. If the hosting paradigm or core stateful/messaging services changed (for example, migrating from Linux Virtual Machines + Bastion to Private AKS + ACR + Application Gateway WAF + Service Bus), append a concise, factual ADR (`### ADR-003: ...`) grounded strictly in the repository diff—never deleting existing ADRs.
4. **Run Quality Gates:**
   - Execute `(cd ./central-docs && node scripts/validate-central-docs.mjs)` and verify `ok: true` (zero Mermaid syntax errors, zero broken links, balanced DAC markers).
5. **Propose Pull Request via Safe Outputs:**
   - If `./central-docs` has modifications, invoke `create_pull_request` targeting `gitpavleenbali/dac-central-platform-docs` on branch `agentic-dac/grid-telemetry-service` with an executive summary of all hosting, network, security, and operational guide updates.
