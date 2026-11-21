# Grid Telemetry & Dispatch Service (`grid-telemetry-service`)

Ingests high-frequency substation voltage, frequency, and thermal telemetry and exposes real-time grid dispatch health APIs.

## Current Hosting & Landing Zone Summary

<!-- BEGIN DAC:local-hosting-summary source="gitpavleenbali/dac-workload-modernization@1f2251fb06ffd941c5031136bc825e2e784c89e6" irHash="d329c4700a63" -->
| Attribute | Current Value (Extracted from IaC & Manifests) |
| :--- | :--- |
| **Service** | **Grid Telemetry & Dispatch Service** (`grid-telemetry-service`) |
| **Hosting Paradigm** | **Azure Kubernetes Service (Cloud-Native Containers)** |
| **Landing Zone / RG** | `alz-energy-ops-prod` / `rg-grid-telemetry-prod` (`westeurope`) |
| **IaC Definitions** | `terraform`, `bicep` |
| **Topology Semantic Hash** | `d329c4700a63490f` |
<!-- END DAC:local-hosting-summary -->

## Landing Zone Architecture Diagram

<!-- BEGIN DAC:local-topology-diagram source="gitpavleenbali/dac-workload-modernization@1f2251fb06ffd941c5031136bc825e2e784c89e6" irHash="d329c4700a63" -->
```mermaid
flowchart TB
  ext_clients(["External Consumers & Grid Sensors"])
  subgraph sg_hub["Hub Connectivity Landing Zone"]
    hub_vnet["Hub VNet & Central Firewall<br/>vnet-hub-connectivity-eu"]
  end
  subgraph sg_rg["Landing Zone: alz-energy-ops-prod (rg-grid-telemetry-prod - westeurope)"]
    subgraph sg_vnet["Spoke VNet: vnet-grid-prod (10.40.0.0/16)"]
      subgraph sg_snet_aks_nodes["Subnet: snet-aks-nodes (10.40.4.0/22 • NSG: nsg-aks-grid-nodes)"]
        aks_aks["Azure Kubernetes Service (AKS)<br/>aks-grid-telemetry-prod (Standard (Standard_D4ds_v5))<br/>K8s 1.31 • Workload Identity • Private Cluster"]
        aks_node_pool_workload["AKS Workload Node Pool<br/>workload (Standard_D8ds_v5)<br/>Autoscale 3-12"]
      end
      subgraph sg_snet_ingress_waf["Subnet: snet-ingress-waf (10.40.10.0/24)"]
        app_gateway_waf_ingress["Azure Application Gateway (WAF v2)<br/>agw-grid-waf (WAF_v2)<br/>TLS / Layer-7 Ingress"]
      end
      subgraph sg_snet_data_pe["Subnet: snet-data-pe (10.40.2.0/24)"]
        acr_acr["Azure Container Registry (ACR)<br/>acrgridtelemetryprod (Premium)<br/>Private Endpoint"]
        service_bus_sb["Azure Service Bus<br/>sb-grid-telemetry (Premium)<br/>1 Messaging Unit • Private Endpoint"]
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

<!-- BEGIN DAC:local-build-deploy source="gitpavleenbali/dac-workload-modernization@1f2251fb06ffd941c5031136bc825e2e784c89e6" irHash="d329c4700a63" -->
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

<!-- BEGIN DAC:local-api-endpoints source="gitpavleenbali/dac-workload-modernization@1f2251fb06ffd941c5031136bc825e2e784c89e6" irHash="d329c4700a63" -->
| HTTP Method | Endpoint Path | Capability Summary |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Kubernetes liveness and readiness probe returning pod runtime mode and buffer depth |
| `GET` | `/v1/grid/status` | Retrieve current regional grid nominal frequency, active frequency-deviation alerts, and latest substation reading |
| `POST` | `/v1/telemetry` | Idempotently ingest single substation voltage and frequency telemetry reading |
| `POST` | `/v1/telemetry/batch` | Asynchronously enqueue high-frequency substation telemetry batch via Azure Service Bus Premium |
| `GET` | `/v1/telemetry/recent` | List most recent 25 telemetry readings in the active window |
<!-- END DAC:local-api-endpoints -->

## Developer Notes & Local Environment (Human-Maintained)

- **Local Port:** `PORT=8080 npm start` launches the HTTP telemetry server locally with an in-memory ring buffer when PostgreSQL is unreachable.
- **Docs-as-Code Contract:** After infrastructure or manifest edits, run `npm run dac:render` and commit the generated Markdown with the workload change. GitHub Actions verifies the files and previews the architecture change.

## GitHub demo: VM to AKS

1. **Option 1 — DAC Translator:** Open [workload PR #1](https://github.com/gitpavleenbali/dac-workload-modernization/pull/1/files) to see the VM/systemd declarations replaced by AKS and Kubernetes manifests. In [GitHub Actions](https://github.com/gitpavleenbali/dac-workload-modernization/actions/workflows/dac-translator-sync.yml), select **Run workflow**, pick `feat/modernize-vm-to-aks`, and check **Update the central docs PR**. The translator refreshes the [central diagrams and guides in PR #1](https://github.com/gitpavleenbali/dac-central-platform-docs/pull/1/files). Ordinary PR and `main` runs only validate and preview.
2. **Option 2 — GitHub Copilot Cloud Agent:** Open the [ADR task](https://github.com/gitpavleenbali/dac-central-platform-docs/issues/2). Copilot drafts a separate decision record for review from the same migration evidence. It does not own the generated diagrams or guides. See the [central repo demo instructions](https://github.com/gitpavleenbali/dac-central-platform-docs#github-demo).

Both demos document the intended architecture; neither deploys Azure resources. Azure DevOps teams can call the same `dac-translator` CLI from their own pipelines with a scoped GitHub credential for central PRs. No Azure Pipelines workflow is required for this demo.
