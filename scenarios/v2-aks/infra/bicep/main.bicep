param location string = 'westeurope'
param postgresSku string = 'GP_Standard_D4ds_v5'

resource spokeVnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-grid-prod'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.40.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'snet-aks-nodes'
        properties: { addressPrefix: '10.40.4.0/22' }
      }
      {
        name: 'snet-ingress-waf'
        properties: { addressPrefix: '10.40.10.0/24' }
      }
      {
        name: 'snet-data-pe'
        properties: { addressPrefix: '10.40.2.0/24' }
      }
    ]
  }
}

resource wafGateway 'Microsoft.Network/applicationGateways@2024-01-01' = {
  name: 'agw-grid-waf'
  location: location
  sku: { name: 'WAF_v2' }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrgridtelemetryprod'
  location: location
  sku: { name: 'Premium' }
}

resource workloadMi 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-grid-telemetry-workload'
  location: location
}

resource aksCluster 'Microsoft.ContainerService/managedClusters@2024-05-01' = {
  name: 'aks-grid-telemetry-prod'
  location: location
  sku: { name: 'Base' }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: 'sb-grid-telemetry'
  location: location
  sku: { name: 'Premium' }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-grid-telemetry'
  location: location
  sku: { name: postgresSku }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-grid-telemetry'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-grid-ops'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
  }
}
