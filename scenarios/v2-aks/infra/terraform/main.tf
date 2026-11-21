locals {
  rg_name = "rg-grid-telemetry-prod"
}

resource "azurerm_resource_group" "rg" {
  name     = local.rg_name
  location = var.location
}

resource "azurerm_virtual_network" "spoke" {
  name                = "vnet-grid-prod"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = ["10.40.0.0/16"]
}

resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  name                         = "peer-grid-spoke-to-hub"
  resource_group_name          = azurerm_resource_group.rg.name
  virtual_network_name         = azurerm_virtual_network.spoke.name
  remote_virtual_network_id    = var.hub_vnet_id
  allow_forwarded_traffic      = true
  allow_virtual_network_access = true
}

resource "azurerm_subnet" "aks_nodes" {
  name                 = "snet-aks-nodes"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.4.0/22"]
}

resource "azurerm_subnet" "ingress_waf" {
  name                 = "snet-ingress-waf"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.10.0/24"]
}

resource "azurerm_subnet" "data_pe" {
  name                 = "snet-data-pe"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.spoke.name
  address_prefixes     = ["10.40.2.0/24"]
}

resource "azurerm_network_security_group" "aks_nsg" {
  name                = "nsg-aks-grid-nodes"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_subnet_network_security_group_association" "aks_nsg_assoc" {
  subnet_id                 = azurerm_subnet.aks_nodes.id
  network_security_group_id = azurerm_network_security_group.aks_nsg.id
}

resource "azurerm_public_ip" "agw_pip" {
  name                = "pip-agw-grid-waf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_application_gateway" "waf_ingress" {
  name                = "agw-grid-waf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  sku {
    name     = "WAF_v2"
    tier     = "WAF_v2"
    capacity = 2
  }

  gateway_ip_configuration {
    name      = "agw-ipcfg"
    subnet_id = azurerm_subnet.ingress_waf.id
  }

  frontend_port {
    name = "https-443"
    port = 443
  }

  frontend_ip_configuration {
    name                 = "agw-public-fe"
    public_ip_address_id = azurerm_public_ip.agw_pip.id
  }

  backend_address_pool {
    name = "aks-ingress-pool"
  }

  backend_http_settings {
    name                  = "http-8080"
    cookie_based_affinity = "Disabled"
    port                  = 8080
    protocol              = "Http"
    request_timeout       = 30
  }

  http_listener {
    name                           = "listener-443"
    frontend_ip_configuration_name = "agw-public-fe"
    frontend_port_name             = "https-443"
    protocol                       = "Http"
  }

  request_routing_rule {
    name                       = "route-to-aks"
    priority                   = 100
    rule_type                  = "Basic"
    http_listener_name         = "listener-443"
    backend_address_pool_name  = "aks-ingress-pool"
    backend_http_settings_name = "http-8080"
  }
}

resource "azurerm_container_registry" "acr" {
  name                          = "acrgridtelemetryprod"
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  sku                           = "Premium"
  admin_enabled                 = false
  public_network_access_enabled = false
}

resource "azurerm_user_assigned_identity" "workload_mi" {
  name                = "id-grid-telemetry-workload"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_kubernetes_cluster" "aks" {
  name                      = "aks-grid-telemetry-prod"
  location                  = azurerm_resource_group.rg.location
  resource_group_name       = azurerm_resource_group.rg.name
  dns_prefix                = "aks-grid-telemetry"
  kubernetes_version        = "1.31"
  sku_tier                  = "Standard"
  private_cluster_enabled   = true
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name                 = "system"
    vm_size              = "Standard_D4ds_v5"
    vnet_subnet_id       = azurerm_subnet.aks_nodes.id
    auto_scaling_enabled = true
    min_count            = 2
    max_count            = 4
    zones                = ["1", "2", "3"]
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = "cilium"
    service_cidr        = "10.240.0.0/16"
    dns_service_ip      = "10.240.0.10"
  }

  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }
}

resource "azurerm_kubernetes_cluster_node_pool" "workload" {
  name                  = "workload"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.aks.id
  vm_size               = "Standard_D8ds_v5"
  vnet_subnet_id        = azurerm_subnet.aks_nodes.id
  auto_scaling_enabled  = true
  min_count             = 3
  max_count             = 12
  zones                 = ["1", "2", "3"]
}

resource "azurerm_servicebus_namespace" "sb" {
  name                          = "sb-grid-telemetry"
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  sku                           = "Premium"
  capacity                      = 1
  premium_messaging_partitions  = 1
  public_network_access_enabled = false
}

resource "azurerm_postgresql_flexible_server" "db" {
  name                          = "psql-grid-telemetry"
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  version                       = "16"
  sku_name                      = var.postgres_sku
  storage_mb                    = 131072
  public_network_access_enabled = false
  zone                          = "1"

  high_availability {
    mode                      = "ZoneRedundant"
    standby_availability_zone = "2"
  }
}

resource "azurerm_key_vault" "kv" {
  name                          = "kv-grid-telemetry"
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  public_network_access_enabled = false
  purge_protection_enabled      = true
}

resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-grid-ops"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
}

resource "azurerm_private_endpoint" "pe_db" {
  name                = "pe-psql-grid-telemetry"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.data_pe.id

  private_service_connection {
    name                           = "psc-psql-grid"
    private_connection_resource_id = azurerm_postgresql_flexible_server.db.id
    is_manual_connection           = false
    subresource_names              = ["postgresqlServer"]
  }
}

resource "azurerm_private_endpoint" "pe_kv" {
  name                = "pe-kv-grid-telemetry"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.data_pe.id

  private_service_connection {
    name                           = "psc-kv-grid"
    private_connection_resource_id = azurerm_key_vault.kv.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }
}

resource "azurerm_private_endpoint" "pe_acr" {
  name                = "pe-acr-grid-telemetry"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.data_pe.id

  private_service_connection {
    name                           = "psc-acr-grid"
    private_connection_resource_id = azurerm_container_registry.acr.id
    is_manual_connection           = false
    subresource_names              = ["registry"]
  }
}

resource "azurerm_private_endpoint" "pe_sb" {
  name                = "pe-sb-grid-telemetry"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.data_pe.id

  private_service_connection {
    name                           = "psc-sb-grid"
    private_connection_resource_id = azurerm_servicebus_namespace.sb.id
    is_manual_connection           = false
    subresource_names              = ["namespace"]
  }
}

resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
}

resource "azurerm_role_assignment" "workload_kv_secrets" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.workload_mi.principal_id
}

resource "azurerm_role_assignment" "workload_sb_sender" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_user_assigned_identity.workload_mi.principal_id
}
