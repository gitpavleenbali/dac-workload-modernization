# Grid Telemetry & Dispatch Service (`grid-telemetry-service`)

Ingests high-frequency substation voltage, frequency, and thermal telemetry and exposes real-time grid dispatch health APIs.

## Current Hosting & Landing Zone Summary

<!-- BEGIN DAC:local-hosting-summary source="gitpavleenbali/dac-workload-modernization@a77df6d1846443937999c73a3fe23eb50c8be9d6" irHash="9d0955415321" -->
| Attribute | Current Value (Extracted from IaC & Manifests) |
| :--- | :--- |
| **Service** | **Grid Telemetry & Dispatch Service** (`grid-telemetry-service`) |
| **Hosting Paradigm** | **Azure Kubernetes Service (Cloud-Native Containers)** |
| **Landing Zone / RG** | `alz-energy-ops-prod` / `rg-grid-telemetry-prod` (`westeurope`) |
| **IaC Definitions** | `terraform`, `bicep` |
| **Topology Semantic Hash** | `9d095541532117cb` |
<!-- END DAC:local-hosting-summary -->

## Landing Zone Architecture Diagram

<!-- BEGIN DAC:local-topology-diagram source="gitpavleenbali/dac-workload-modernization@a77df6d1846443937999c73a3fe23eb50c8be9d6" irHash="9d0955415321" -->
```mermaid
flowchart TB
  ext_clients(["External Consumers & Grid Sensors"])
  subgraph sg_hub["Hub Connectivity Landing Zone"]
    hub_vnet["Hub VNet & Central Firewall<br/>vnet-hub-connectivity-eu"]
  end
  subgraph sg_rg["Landing Zone: alz-energy-ops-prod (rg-grid-telemetry-prod - westeurope)"]
    subgraph sg_vnet["Spoke VNet: vnet-grid-prod (10.40.0.0/16)"]
      subgraph sg_snet_aks_nodes["Subnet: snet-aks-nodes (10.40.4.0/22 • NSG: nsg-aks-grid-nodes)"]
        aks_aks["Azure Kubernetes Service (AKS)<br/>aks-grid-telemetry-prod (Standard (Standard_D4ds_v5))<br/>K8s 1.32 • Workload Identity • Private Cluster"]
        aks_node_pool_workload["AKS Workload Node Pool<br/>workload (Standard_D16ds_v5)<br/>Autoscale 4-20"]
      end
      subgraph sg_snet_ingress_waf["Subnet: snet-ingress-waf (10.40.10.0/24)"]
        app_gateway_waf_ingress["Azure Application Gateway (WAF v2)<br/>agw-grid-waf (WAF_v2)<br/>TLS / Layer-7 Ingress"]
      end
      subgraph sg_snet_data_pe["Subnet: snet-data-pe (10.40.2.0/24)"]
        acr_acr["Azure Container Registry (ACR)<br/>acrgridtelemetryprod (Premium)<br/>Private Endpoint"]
        service_bus_sb["Azure Service Bus<br/>sb-grid-telemetry (Premium)<br/>2 Messaging Units • Private Endpoint"]
        redis_hotstate[("Azure Managed Redis<br/>redis-grid-hotstate (Premium)<br/>TLS 1.2 • ZoneRedundant • Private Endpoint")]
        postgresql_db[("Azure Database for PostgreSQL<br/>psql-grid-telemetry (GP_Standard_D4ds_v5)<br/>PG v16 • HA: ZoneRedundant • Private Endpoint")]
        key_vault_kv["Azure Key Vault<br/>kv-grid-telemetry (standard)<br/>Private Endpoint"]
      end
    end
    subgraph sg_platform["Control Plane, Identity & Observability"]
      managed_identity_workload_mi["User-Assigned Managed Identity<br/>id-grid-telemetry-workload (Standard)"]
      log_analytics_law["Log Analytics Workspace<br/>law-grid-ops (PerGB2018)"]
    end
  end
  aks_aks -.->|"VNet Peering / Egress"| hub_vnet
  aks_aks -->|"Private Link"| postgresql_db
  aks_aks -->|"Private Link"| key_vault_kv
  aks_aks -.->|"Private Link + RBAC: AcrPull"| acr_acr
  aks_aks -->|"Private Link"| service_bus_sb
  aks_aks -->|"Private Link"| redis_hotstate
  managed_identity_workload_mi -.->|"RBAC: Key Vault Secrets User"| key_vault_kv
  managed_identity_workload_mi -.->|"RBAC: Azure Service Bus Data Sender"| service_bus_sb
  managed_identity_workload_mi -.->|"RBAC: Redis Cache Contributor"| redis_hotstate
  aks_aks -->|"Schedules Workloads"| aks_node_pool_workload
  ext_clients -->|"HTTPS (443)"| app_gateway_waf_ingress
  app_gateway_waf_ingress -->|"Ingress -> K8s Service"| aks_aks
  aks_aks -.->|"OIDC Workload Identity"| managed_identity_workload_mi
  aks_aks -.->|"Container Insights & Prometheus"| log_analytics_law
  classDef compute fill:#e8f4fd,stroke:#0078d4,stroke-width:2px,color:#0f172a;
  classDef ingress fill:#eef2ff,stroke:#4f46e5,stroke-width:2px,color:#0f172a;
  classDef containers fill:#f0fdf4,stroke:#15803d,stroke-width:2px,color:#0f172a;
  classDef data fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#0f172a;
  classDef messaging fill:#fdf4ff,stroke:#a21caf,stroke-width:2px,color:#0f172a;
  classDef security fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#0f172a;
  classDef observability fill:#f1f5f9,stroke:#475569,stroke-width:1.5px,color:#0f172a;
  class app_gateway_waf_ingress ingress;
  class acr_acr containers;
  class managed_identity_workload_mi security;
  class aks_aks compute;
  class aks_node_pool_workload compute;
  class service_bus_sb messaging;
  class redis_hotstate data;
  class postgresql_db data;
  class key_vault_kv security;
  class log_analytics_law observability;
```
<!-- END DAC:local-topology-diagram -->

## Build, Validate & Deploy Quickstart

<!-- BEGIN DAC:local-build-deploy source="gitpavleenbali/dac-workload-modernization@a77df6d1846443937999c73a3fe23eb50c8be9d6" irHash="9d0955415321" -->
```bash
# 1. Run application & DaC translator test suites
npm test

# 2. Build & push container image to Azure Container Registry (acrgridtelemetryprod)
docker build -t acrgridtelemetryprod.azurecr.io/grid-telemetry-service:latest .
az acr login --name acrgridtelemetryprod
docker push acrgridtelemetryprod.azurecr.io/grid-telemetry-service:latest

# 3. Validate Terraform & apply Kubernetes manifests to AKS (aks-grid-telemetry-prod)
terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate
az aks get-credentials --resource-group rg-grid-telemetry-prod --name aks-grid-telemetry-prod
kubectl apply -f deploy/k8s/
```
<!-- END DAC:local-build-deploy -->

## REST API Surface

<!-- BEGIN DAC:local-api-endpoints source="gitpavleenbali/dac-workload-modernization@a77df6d1846443937999c73a3fe23eb50c8be9d6" irHash="9d0955415321" -->
| HTTP Method | Endpoint Path | Capability Summary |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Kubernetes liveness and readiness probe returning pod runtime mode and buffer depth |
| `GET` | `/v1/grid/status` | Retrieve current regional grid nominal frequency, active frequency-deviation alerts, and latest substation reading |
| `POST` | `/v1/telemetry` | Idempotently ingest single substation voltage and frequency telemetry reading |
| `POST` | `/v1/telemetry/batch` | Asynchronously enqueue high-frequency substation telemetry batch via Azure Service Bus Premium |
| `POST` | `/v1/dispatch/curtailment` | Issue automated substation load-curtailment dispatch command during grid frequency excursion |
| `GET` | `/v1/telemetry/recent` | List most recent 25 telemetry readings in the active window |
<!-- END DAC:local-api-endpoints -->

## Developer Notes & Local Environment (Human-Maintained)

- **Local Port:** `PORT=8080 npm start` launches the HTTP telemetry server locally with an in-memory ring buffer when PostgreSQL is unreachable.
- **Docs-as-Code Contract:** After infrastructure or manifest edits, run `npm run dac:render` and commit the generated Markdown with the workload change. GitHub Actions verifies the files and previews the architecture change.

## GitHub demo & Interactive Workshop: VM to AKS

- **Live Interactive Workshop (GitHub Pages):** [`https://gitpavleenbali.github.io/dac-workload-modernization/`](https://gitpavleenbali.github.io/dac-workload-modernization/) — Full interactive slide-by-slide **Why → What → How** customer presentation, clickable 3D translator map, Azure VM/AKS topology comparison, **Facilitator mode** (120-minute run of show), and 10-stop guided evidence tour.

After changing infrastructure, deployment manifests, or OpenAPI contracts, run these commands locally from this repository:

```sh
npm run dac:render
npm run dac:verify
npm test
git diff -- README.md docs/architecture.md
```

`dac:render` updates the marked `BEGIN DAC` / `END DAC` sections in the existing `README.md` and `docs/architecture.md`. It does not push, deploy, or call an LLM. Commit the updated docs with the workload change; the PR workflow rejects stale generated sections.

1. **Option 1 — Deterministic DAC Translator (`0` LLM calls):** [Workload PR #1](https://github.com/gitpavleenbali/dac-workload-modernization/pull/1/files) shows the VM-to-AKS code and local docs change. Dispatch the [workload workflow](https://github.com/gitpavleenbali/dac-workload-modernization/actions/workflows/dac-translator-sync.yml) on `feat/modernize-vm-to-aks` with **Update the central docs PR** checked and **Option 2** unchecked ([verified workload run #44972624473](https://github.com/gitpavleenbali/dac-workload-modernization/actions/runs/44972624473) → [Central Docs PR #1](https://github.com/gitpavleenbali/dac-central-platform-docs/pull/1/files) → [verified central gate #44972674206](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44972674206)).
2. **Option 2A — Spec-Driven Local Copilot (`.github/` spec, skill, prompt & custom agent):** Governed by [`specs/doc-as-code/refresh-workload-docs.md`](specs/doc-as-code/refresh-workload-docs.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md), [`.github/agents/dac-architecture-guardian.agent.md`](.github/agents/dac-architecture-guardian.agent.md), [`.github/skills/refresh-workload-docs/SKILL.md`](.github/skills/refresh-workload-docs/SKILL.md), and [`.github/prompts/refresh-workload-docs.prompt.md`](.github/prompts/refresh-workload-docs.prompt.md).
   - **In VS Code Copilot Chat:** Edit a supported fact (e.g. `maxReplicas: 24` → `28` in `deploy/k8s/workloads.yaml`), select agent **`dac-architecture-guardian`** (or invoke `/refresh-workload-docs`), and ask it to refresh and verify the existing workload docs.
   - **In Copilot CLI:**
     ```sh
     copilot --agent dac-architecture-guardian -p "Follow specs/doc-as-code/refresh-workload-docs.md to refresh README.md and docs/architecture.md, run dac:verify and npm test, and summarize what changed." --allow-tool="write" --allow-tool="shell(npm run)" --allow-tool="shell(npm test)" --allow-tool="shell(git diff)"
     ```
3. **Option 2B — Automated Copilot in CI (`gh-aw` + Keyless Azure OIDC):** Select **both checkboxes** on the workload workflow (or add the `dac-agentic` label on the migration PR). Authenticated via **keyless GitHub OIDC** (`id-token: write` → Microsoft Entra Managed Identity → Azure AI Foundry `gpt-5.4-mini`) with zero static PATs or API keys, Copilot runs inside the Agent Workflow Firewall (AWF), passes threat detection, and attaches verified `architecture.patch` artifacts across both repositories ([verified workload run #44971666753](https://github.com/gitpavleenbali/dac-workload-modernization/actions/runs/44971666753) → [verified central run #44972101526](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44972101526)). Neither agent pushes to a branch.
4. **Option 2C — Copilot Cloud Agent on demand (`dac-central-curator`):** [Central Issue #2](https://github.com/gitpavleenbali/dac-central-platform-docs/issues/2) triggered [Cloud Agent run #44889944409](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44889944409), opening [Draft PR #3](https://github.com/gitpavleenbali/dac-central-platform-docs/pull/3/files) ([passed quality gate #44890039831](https://github.com/gitpavleenbali/dac-central-platform-docs/actions/runs/44890039831)) to propose standalone `ADR-003` without touching deterministic diagrams.

All paths document the declared architecture; none deploy Azure resources. Azure DevOps teams can run the same zero-dependency `dac-translator` CLI from Azure Pipelines.

## Doc as Code workshop site (`docs/workshop-presentation/`)

The [interactive workshop](docs/workshop-presentation/dac.html) (live at [`https://gitpavleenbali.github.io/dac-workload-modernization/`](https://gitpavleenbali.github.io/dac-workload-modernization/)) provides slide-by-slide **Why → What → How** decks, rendered Mermaid and Azure icon topologies, exact before/after file comparisons, and **Facilitator mode** (off by default).

- To stage the allowlisted static bundle locally, run `node scripts/doc-as-code/package-site.mjs .dac-out/site`.
- GitHub Pages deploys from `main` via [`.github/workflows/publish-doc-as-code.yml`](.github/workflows/publish-doc-as-code.yml) (`workflow_dispatch` on `main`; pull requests validate packaging only).
