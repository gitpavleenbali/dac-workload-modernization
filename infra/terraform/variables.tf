variable "location" {
  description = "Primary Azure region for the Grid Telemetry Spoke Landing Zone"
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

variable "vm_admin_ssh_public_key" {
  description = "Break-glass SSH public key when AAD login extension is bootstrapping"
  type        = string
  default     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGridTelemetryPlatformPlaceholderKey gridops@example"
}

variable "postgres_sku" {
  description = "Azure Database for PostgreSQL Flexible Server SKU"
  type        = string
  default     = "GP_Standard_D2ds_v5"
}
