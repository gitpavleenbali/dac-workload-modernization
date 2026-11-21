variable "location" {
  description = "Primary Azure region for the Grid Telemetry Cloud-Native AKS Landing Zone"
  type        = string
  default     = "westeurope"
}

variable "hub_vnet_id" {
  description = "Resource ID of the Hub Connectivity Virtual Network"
  type        = string
  default     = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-hub-connectivity-eu/providers/Microsoft.Network/virtualNetworks/vnet-hub-connectivity-eu"
}

variable "tenant_id" {
  description = "Microsoft Entra ID tenant GUID"
  type        = string
  default     = "00000000-0000-0000-0000-000000000002"
}

variable "postgres_sku" {
  description = "Upgraded Zone-Redundant PostgreSQL Flexible Server SKU for AKS burst throughput"
  type        = string
  default     = "GP_Standard_D4ds_v5"
}
