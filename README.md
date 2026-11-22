# Grid Telemetry & Dispatch Service (`grid-telemetry-service`)

Ingests high-frequency substation voltage, frequency, and thermal telemetry and exposes real-time grid dispatch health APIs.

**[Open the interactive Doc as Code workshop](https://gitpavleenbali.github.io/dac-workload-modernization/).** Start with the [workload-to-platform overview](https://gitpavleenbali.github.io/dac-workload-modernization/#cross-team-flow), then follow the Why, What, and [How](https://gitpavleenbali.github.io/dac-workload-modernization/#how-story) comics. Use **Present** for the slide decks, including [commit IDs and architecture hashes](https://gitpavleenbali.github.io/dac-workload-modernization/#fingerprints). The [Evidence & Links tour](https://gitpavleenbali.github.io/dac-workload-modernization/#evidence-tour) connects the in-page diagrams and comparisons to the GitHub records.

This repository is the workload source. `main` holds the virtual machine (VM) baseline; [workload PR #1](https://github.com/gitpavleenbali/dac-workload-modernization/pull/1/files) proposes that the same app run on Azure Kubernetes Service (AKS). The declarations and diagrams describe a scenario in Git, not a deployed service.

The deployment quickstart illustrates the declared hosting design. The workshop does not provision Azure resources or publish a container image.

## Current Hosting & Landing Zone Summary

<!-- BEGIN DAC:local-hosting-summary source="gitpavleenbali/dac-workload-modernization@v1.0.0-vm-baseline" irHash="e8147f08f46c" -->
| Attribute | Current Value (Extracted from IaC & Manifests) |
| :--- | :--- |
| **Service** | **Grid Telemetry & Dispatch Service** (`grid-telemetry-service`) |
| **Hosting Paradigm** | **Azure Virtual Machines (IaaS)** |
| **Landing Zone / RG** | `alz-energy-ops-prod` / `rg-grid-telemetry-prod` (`westeurope`) |
| **IaC Definitions** | `terraform`, `bicep` |
| **Topology Semantic Hash** | `e8147f08f46cc101` |
<!-- END DAC:local-hosting-summary -->

## Landing Zone Architecture Diagram

<!-- BEGIN DAC:local-topology-diagram source="gitpavleenbali/dac-workload-modernization@v1.0.0-vm-baseline" irHash="e8147f08f46c" -->
```mermaid
flowchart TB
  ext_clients(["External Consumers & Grid Sensors"])
  subgraph sg_hub["Hub Connectivity Landing Zone"]
    hub_vnet["Hub VNet & Central Firewall<br/>vnet-hub-connectivity-eu"]
  end
  subgraph sg_rg["Landing Zone: alz-energy-ops-prod (rg-grid-telemetry-prod - westeurope)"]
    subgraph sg_vnet["Spoke VNet: vnet-grid-prod (10.40.0.0/16)"]
      subgraph sg_snet_vm_app["Subnet: snet-vm-app (10.40.1.0/24 • NSG: nsg-vm-grid-app)"]
        load_balancer_ingress_lb["Azure Standard Load Balancer<br/>lb-grid-telemetry (Standard)"]
        vm_app_vm["Azure Linux VM<br/>vm-grid-telemetry-01 (Standard_D4s_v5)<br/>System Managed Identity"]
      end
      subgraph sg_AzureBastionSubnet["Subnet: AzureBastionSubnet (10.40.0.0/26)"]
        bastion_ops_bastion["Azure Bastion<br/>bas-grid-ops (Standard)"]
      end
      subgraph sg_snet_data_pe["Subnet: snet-data-pe (10.40.2.0/24)"]
        postgresql_db[("Azure Database for PostgreSQL<br/>psql-grid-telemetry (GP_Standard_D2ds_v5)<br/>PG v16 • Private Endpoint")]
        key_vault_kv["Azure Key Vault<br/>kv-grid-telemetry (standard)<br/>Private Endpoint"]
      end
    end
    subgraph sg_platform["Control Plane, Identity & Observability"]
      log_analytics_law["Log Analytics Workspace<br/>law-grid-ops (PerGB2018)"]
    end
  end
  vm_app_vm -.->|"VNet Peering / Egress"| hub_vnet
  vm_app_vm -->|"Private Link"| postgresql_db
  vm_app_vm -.->|"Private Link + RBAC: Key Vault Secrets User"| key_vault_kv
  ext_clients -->|"HTTPS (443)"| load_balancer_ingress_lb
  load_balancer_ingress_lb -->|"Backend Pool (8080)"| vm_app_vm
  bastion_ops_bastion -->|"Admin SSH (22)"| vm_app_vm
  vm_app_vm -.->|"Azure Monitor Agent (VM Insights)"| log_analytics_law
  classDef compute fill:#e8f4fd,stroke:#0078d4,stroke-width:2px,color:#0f172a;
  classDef ingress fill:#eef2ff,stroke:#4f46e5,stroke-width:2px,color:#0f172a;
  classDef containers fill:#f0fdf4,stroke:#15803d,stroke-width:2px,color:#0f172a;
  classDef data fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#0f172a;
  classDef messaging fill:#fdf4ff,stroke:#a21caf,stroke-width:2px,color:#0f172a;
  classDef security fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#0f172a;
  classDef observability fill:#f1f5f9,stroke:#475569,stroke-width:1.5px,color:#0f172a;
  class bastion_ops_bastion security;
  class load_balancer_ingress_lb ingress;
  class vm_app_vm compute;
  class postgresql_db data;
  class key_vault_kv security;
  class log_analytics_law observability;
```
<!-- END DAC:local-topology-diagram -->

## Build, Validate & Deploy Quickstart

<!-- BEGIN DAC:local-build-deploy source="gitpavleenbali/dac-workload-modernization@v1.0.0-vm-baseline" irHash="e8147f08f46c" -->
```bash
# 1. Run application & DaC translator test suites
npm test

# 2. Validate Virtual Machine Landing Zone Terraform
terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate

# 3. Package & deploy systemd service to Linux VM (vm-grid-telemetry-01)
tar -czf dist-grid-telemetry.tar.gz src/ package.json deploy/systemd/grid-telemetry.service
az network bastion ssh --name bas-grid-ops --resource-group rg-grid-telemetry-prod --target-resource-id <vm-id> --auth-type AAD
```
<!-- END DAC:local-build-deploy -->

## REST API Surface

<!-- BEGIN DAC:local-api-endpoints source="gitpavleenbali/dac-workload-modernization@v1.0.0-vm-baseline" irHash="e8147f08f46c" -->
| HTTP Method | Endpoint Path | Capability Summary |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Liveness and readiness probe returning active runtime mode and buffer depth |
| `GET` | `/v1/grid/status` | Retrieve current regional grid nominal frequency, active frequency-deviation alerts, and latest substation reading |
| `POST` | `/v1/telemetry` | Idempotently ingest substation voltage and frequency telemetry reading |
| `GET` | `/v1/telemetry/recent` | List most recent 25 telemetry readings in the active window |
<!-- END DAC:local-api-endpoints -->

## Developer Notes & Local Environment (Human-Maintained)

- **Local Port:** `PORT=8080 npm start` launches the HTTP telemetry server locally with an in-memory ring buffer when PostgreSQL is unreachable.
- **Docs-as-Code Contract:** After infrastructure or manifest edits, run `npm run dac:render` and commit the generated Markdown with the workload change. GitHub Actions verifies the files and previews the architecture change.

## Refresh the existing documents

After changing a supported infrastructure, deployment, or OpenAPI declaration, the same commands update and check the workload documents:

```sh
npm run dac:render
npm run dac:verify
npm test
git diff -- README.md docs/architecture.md
```

`dac:render` replaces the marked `BEGIN DAC` / `END DAC` sections in `README.md` and [`docs/architecture.md`](docs/architecture.md). It leaves the surrounding prose alone. Commits carry the generated updates with the source change; ordinary GitHub Actions runs verify freshness but do not rewrite or publish the files.

## The portable core and the optional agent paths

**Option 1 is the foundation.** The Node.js 20+ translator reads a checkout from GitHub, Azure DevOps, or Bitbucket. Extracting, rendering, and verifying need neither an AI model nor a Git-host API. This repository verifies GitHub Actions. Azure Pipelines and Bitbucket Pipelines can call the same commands after checkout; their workflow configuration and any host-native pull request publisher are separate integrations. The publisher included here targets GitHub.

| Path | What it produces | Workshop evidence |
| --- | --- | --- |
| **1 · Deterministic translator** | The same rules refresh the existing diagrams and Markdown. An authorized opt-in sync separately updates the rolling central pull request. | [Workload PR #1](https://github.com/gitpavleenbali/dac-workload-modernization/pull/1/files) → [central docs PR #1](https://github.com/gitpavleenbali/dac-central-platform-docs/pull/1/files). [Workload sync](https://github.com/gitpavleenbali/dac-workload-modernization/actions/runs/44972624473) and [central check](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44972674206). |
| **2A · Spec-driven local Copilot** | Copilot follows the spec, runs the same translator and checks, and leaves a diff in the workload checkout. It does not push. | [Local walkthrough and recorded scaling change](https://gitpavleenbali.github.io/dac-workload-modernization/#option-two-local). |
| **2B · Copilot in GitHub Actions** | The opted-in workflow uses verified facts to draft a review note and question. A verifier checks each patch, but neither agent applies it. | [Workload run](https://github.com/gitpavleenbali/dac-workload-modernization/actions/runs/44971666753) and [central run](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44972101526), with [both patches shown inline](https://gitpavleenbali.github.io/dac-workload-modernization/#agentic-ci). |
| **2C · Cloud agent on demand** | A separate issue asks the cloud agent to draft an architecture decision record. The agent does not change the rolling sync or generated diagrams. | [Issue #2](https://github.com/gitpavleenbali/dac-central-platform-docs/issues/2) → [draft PR #3](https://github.com/gitpavleenbali/dac-central-platform-docs/pull/3/files) and its [validation](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44890039831). |

The [local spec](specs/doc-as-code/refresh-workload-docs.md) defines what Option 2A can change. It is used with the [repository instructions](.github/copilot-instructions.md), [custom agent](.github/agents/dac-architecture-guardian.agent.md), [skill](.github/skills/refresh-workload-docs/SKILL.md), and [VS Code prompt](.github/prompts/refresh-workload-docs.prompt.md). From the workload checkout, the equivalent Copilot CLI entry point is `copilot --agent dac-architecture-guardian`. The recorded scaling change uses the AKS proposal, not `main`.

The repository owner can opt in to sync on the migration branch in the [workload workflow](https://github.com/gitpavleenbali/dac-workload-modernization/actions/workflows/dac-translator-sync.yml). For Option 1, select **Update the central docs PR** only. For Option 2B, select both options. Azure AI Foundry inference uses GitHub OpenID Connect (OIDC) rather than a static inference token or API key; the central publisher uses separate scoped GitHub credentials. None of these paths deploy the workload or merge a PR.

The [central repository](https://github.com/gitpavleenbali/dac-central-platform-docs) owns the shared catalog and audience guides. The [workshop source](docs/workshop-presentation/dac.html) and its allowlisted assets are packaged with `node scripts/doc-as-code/package-site.mjs .dac-out/site`. The [Pages workflow](.github/workflows/publish-doc-as-code.yml) deploys the site only when dispatched from `main`.
