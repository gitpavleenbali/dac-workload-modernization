# Docs-as-Code Repository Instructions

This repository participates in an enterprise Docs-as-Code (DaC) architecture synchronization pipeline.

## Mandatory Guardrails for Agents & Contributors

1. **Dual Documentation Responsibility:**
   - Whenever `infra/terraform/`, `infra/bicep/`, `deploy/`, `Dockerfile`, or `openapi/openapi.yaml` changes, keep local documentation (`README.md` and `docs/architecture.md`) synchronized by running `npm run dac:render` followed by `npm run dac:verify`.
   - Centralized audience guides (`architecture.md`, `admin-guide.md`, `user-guide.md`, `contributor-guide.md`) live in the target repository declared in `dac-manifest.json` (`centralDocsRepo`).
2. **Mermaid Syntax Safety:**
   - Always quote node labels inside `["..."]` or `[("...")]` and subgraph titles inside `subgraph id["..."]` so parentheses such as `(AKS 1.31)` or `(WAF v2)` render cleanly on GitHub.
3. **Human Prose Protection:**
   - Never delete or overwrite human-authored Architectural Decision Records (ADRs), escalation contacts, or maintenance policies outside `<!-- BEGIN DAC:... -->` / `<!-- END DAC:... -->` blocks unless explicitly instructed to add a new numbered ADR.
4. **Verification Before Completion:**
   - Always run `npm test` and `npm run dac:verify` (and `terraform -chdir=infra/terraform validate` when Terraform is available) before opening or updating a pull request.
