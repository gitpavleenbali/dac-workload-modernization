param location string = 'westeurope'
param postgresSku string = 'GP_Standard_D2ds_v5'

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
        name: 'snet-vm-app'
        properties: { addressPrefix: '10.40.1.0/24' }
      }
      {
        name: 'AzureBastionSubnet'
        properties: { addressPrefix: '10.40.0.0/26' }
      }
      {
        name: 'snet-data-pe'
        properties: { addressPrefix: '10.40.2.0/24' }
      }
    ]
  }
}

resource ingressLb 'Microsoft.Network/loadBalancers@2024-01-01' = {
  name: 'lb-grid-telemetry'
  location: location
  sku: { name: 'Standard' }
}

resource opsBastion 'Microsoft.Network/bastionHosts@2024-01-01' = {
  name: 'bas-grid-ops'
  location: location
  sku: { name: 'Standard' }
}

resource appVm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-grid-telemetry-01'
  location: location
  properties: {
    hardwareProfile: { vmSize: 'Standard_D4s_v5' }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-grid-telemetry'
  location: location
  sku: { name: postgresSku, tier: 'GeneralPurpose' }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-grid-telemetry'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-grid-ops'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
  }
}
