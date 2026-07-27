// Core Azure infra for the Agentic AI Governance engine.
// Deploy once by hand (or via the `infra` job in deploy.yml) into an existing
// resource group; day-to-day CI/CD only touches the backend Container App's
// image (`az containerapp update`) and the Static Web App content, both of
// which this template does NOT own — see infra/README.md §"What CI/CD updates".
//
// Secrets are NOT set here. Key Vault is created empty; populate it out of
// band (`az keyvault secret set`, README §"Populate secrets") with real
// values, then re-run this template (or `az containerapp update`) so the
// Container Apps secret refs resolve. This avoids ever putting a real secret
// value into a deployment's parameter history.

targetScope = 'resourceGroup'

@description('Short environment tag, e.g. dev, staging, prod. Used in resource names.')
@minLength(2)
@maxLength(10)
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('PostgreSQL Flexible Server admin login (not the app user — used for the server itself).')
param postgresAdminLogin string = 'pgadmin'

@description('PostgreSQL Flexible Server admin password. Pass at deploy time (--parameters postgresAdminPassword=...); never commit a real value.')
@secure()
param postgresAdminPassword string

@description('SKU for the Container Registry.')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@description('SKU for the Static Web App.')
@allowed(['Free', 'Standard'])
param staticWebAppSku string = 'Free'

@description('vCPU/memory for the backend Container App. Kept modest — see plan §9 cost ballpark.')
param backendCpu string = '0.5'
param backendMemory string = '1Gi'

@description('vCPU/memory for the LiteLLM proxy Container App.')
param litellmCpu string = '0.25'
param litellmMemory string = '0.5Gi'

@description('Placeholder image used only on first provision, before CI has ever pushed a real backend image. CI immediately replaces this via `az containerapp update`.')
param placeholderImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var namePrefix = 'gov-${environmentName}'
var uniqueSuffix = uniqueString(resourceGroup().id, environmentName)

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Identity — one user-assigned identity shared by both Container Apps.
// Grants: AcrPull on the registry, Key Vault Secrets User on the vault.
// Nothing in the container image or GitHub Actions workflow ever holds a
// credential for either of these directly (plan §5/§6).
// ---------------------------------------------------------------------------

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-identity'
  location: location
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${namePrefix}-kv-${uniqueSuffix}'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    // Key Vault Secrets User
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
  }
}

// ---------------------------------------------------------------------------
// Container Registry
// ---------------------------------------------------------------------------

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: replace('${namePrefix}acr${uniqueSuffix}', '-', '')
  location: location
  sku: { name: acrSku }
  properties: {
    adminUserEnabled: false // OIDC + managed identity only, no admin credentials
  }
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, appIdentity.id, 'AcrPull')
  scope: containerRegistry
  properties: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    // AcrPull
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

// ---------------------------------------------------------------------------
// Database — one Flexible Server, two databases (app + LiteLLM), matching
// plan §2's "same Flexible Server, own database" for the proxy.
// ---------------------------------------------------------------------------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${namePrefix}-pg-${uniqueSuffix}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource postgresFirewallAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource appDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'agentic_ai_governance'
}

resource litellmDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'litellm'
}

// ---------------------------------------------------------------------------
// Container Apps environment
// ---------------------------------------------------------------------------

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// LiteLLM proxy — internal ingress only, the backend is its one caller.
resource litellmApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: '${namePrefix}-litellm'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      ingress: {
        external: false
        targetPort: 4000
      }
      secrets: [
        {
          name: 'litellm-master-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/LITELLM-MASTER-KEY'
          identity: appIdentity.id
        }
        {
          name: 'litellm-database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/LITELLM-DATABASE-URL'
          identity: appIdentity.id
        }
        {
          name: 'judge-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JUDGE-API-KEY'
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'litellm'
          image: 'ghcr.io/berriai/litellm:main-latest'
          resources: {
            cpu: json(litellmCpu)
            memory: litellmMemory
          }
          env: [
            { name: 'LITELLM_MASTER_KEY', secretRef: 'litellm-master-key' }
            { name: 'DATABASE_URL', secretRef: 'litellm-database-url' }
            { name: 'JUDGE_API_KEY', secretRef: 'judge-api-key' }
            { name: 'STORE_MODEL_IN_DB', value: 'True' }
          ]
        }
      ]
      // Same rationale as the backend: cheap to keep warm, avoids a cold
      // start mid-audit-run when the backend calls out to the judge model.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Backend API — minReplicas: 1 is a correctness requirement, not a
// cold-start optimization (plan §6: BackgroundTask + SSE state live
// in-process and do not survive scale-to-zero).
resource backendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: '${namePrefix}-backend'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      // Multiple revisions, traffic pinned to the latest *validated* one.
      // CI creates each new revision with 0% traffic, smoke-tests it via
      // its direct revision FQDN, and only then shifts 100% — so a failed
      // smoke test leaves the previous revision serving all traffic with
      // nothing to explicitly "roll back" (plan §7's auto-revert).
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 8000
        // The SSE progress stream needs an open pipe (plan §6) — no
        // response buffering, and Container Apps' own idle timeout on the
        // platform side is already generous enough for this workload.
        transport: 'http'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DATABASE-URL'
          identity: appIdentity.id
        }
        {
          name: 'secret-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/SECRET-KEY'
          identity: appIdentity.id
        }
        {
          name: 'judge-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JUDGE-API-KEY'
          identity: appIdentity.id
        }
        {
          name: 'judge-endpoint'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JUDGE-ENDPOINT'
          identity: appIdentity.id
        }
        {
          name: 'litellm-master-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/LITELLM-MASTER-KEY'
          identity: appIdentity.id
        }
        {
          name: 'hr-gateway-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/HR-GATEWAY-API-KEY'
          identity: appIdentity.id
        }
        {
          name: 'techvest-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TECHVEST-API-KEY'
          identity: appIdentity.id
        }
        {
          name: 'target-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TARGET-API-KEY'
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: placeholderImage
          resources: {
            cpu: json(backendCpu)
            memory: backendMemory
          }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'SECRET_KEY', secretRef: 'secret-key' }
            { name: 'JUDGE_API_KEY', secretRef: 'judge-api-key' }
            { name: 'JUDGE_ENDPOINT', secretRef: 'judge-endpoint' }
            { name: 'LITELLM_MASTER_KEY', secretRef: 'litellm-master-key' }
            { name: 'HR_GATEWAY_API_KEY', secretRef: 'hr-gateway-api-key' }
            { name: 'TECHVEST_API_KEY', secretRef: 'techvest-api-key' }
            { name: 'TARGET_API_KEY', secretRef: 'target-api-key' }
            { name: 'LITELLM_PROXY_URL', value: 'http://${litellmApp.name}' }
            { name: 'AI_MODEL_PROVIDER', value: 'azure_foundry' }
            { name: 'TARGET_MODEL_PROVIDER', value: 'azure_foundry' }
            { name: 'SECRETS_PROVIDER', value: 'azure_key_vault' }
            { name: 'AZURE_KEY_VAULT_URL', value: keyVault.properties.vaultUri }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/v1/health', port: 8000 }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// Migration job — run explicitly (`az containerapp job start`) before a
// backend deploy goes live, never automatically at container boot
// (plan §6: migrations run as a job, not at boot).
resource migrationJob 'Microsoft.App/jobs@2023-05-01' = {
  name: '${namePrefix}-migrate'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      manualTriggerConfig: {
        replicaCompletionCount: 1
        parallelism: 1
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DATABASE-URL'
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: placeholderImage
          command: ['.venv/bin/python', '-m', 'alembic', 'upgrade', 'head']
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Frontend — Static Web App. No container: SWA's own GitHub Actions
// integration builds frontend/ and deploys dist/ directly (plan §4).
// ---------------------------------------------------------------------------

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${namePrefix}-frontend'
  location: location
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {
    // Deploys are pushed by the SWA GitHub Action (deploy.yml), not by this
    // template — no repositoryUrl/branch wired here to avoid a second,
    // competing deployment source.
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs — feed these into GitHub Actions repo variables (README §"Wire
// outputs into GitHub").
// ---------------------------------------------------------------------------

output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output backendAppName string = backendApp.name
output litellmAppName string = litellmApp.name
output migrationJobName string = migrationJob.name
output containerAppsEnvironmentName string = containerAppsEnvironment.name
output staticWebAppName string = staticWebApp.name
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
output managedIdentityClientId string = appIdentity.properties.clientId
output backendFqdn string = backendApp.properties.configuration.ingress.fqdn
