# Deploying this infra

This is the one-time, by-hand setup from the deployment plan's §8 rollout
sequence (steps 2-6). Everything after this is what `.github/workflows/deploy.yml`
automates on every push to `main`. Nothing here can be run from this sandbox
(no Azure CLI, no subscription) — copy/paste these into a shell where you're
logged into the right Azure account.

## 0. Prerequisites

```bash
az login
az account set --subscription "<your-subscription-id-or-name>"
RG=governai-rg
LOCATION=eastus
az group create --name "$RG" --location "$LOCATION"
```

## 1. Provision core infra (Bicep)

```bash
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters environmentName=dev postgresAdminPassword='<generate-a-strong-one>'
```

Save the outputs — steps 3-6 below and the GitHub repo vars in §5 all come
from this:

```bash
az deployment group show -g "$RG" -n main --query properties.outputs
```

## 2. Populate secrets in Key Vault

The template creates an **empty** vault — nothing in this repo, this
template, or any deploy parameter ever carries a real secret value. Every
name below must match exactly what `main.bicep`'s Container App `secretRef`s
expect (they're upper-cased, hyphenated versions of the `.env` names — see
`backend/app/core/config.py` for what each one feeds):

```bash
KV=<keyVaultName output>

az keyvault secret set --vault-name "$KV" --name DATABASE-URL \
  --value "postgresql+psycopg://pgadmin:<password>@<postgresServerFqdn output>:5432/agentic_ai_governance?sslmode=require"

az keyvault secret set --vault-name "$KV" --name SECRET-KEY \
  --value "$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"

az keyvault secret set --vault-name "$KV" --name JUDGE-API-KEY --value "<azure-ai-foundry-key>"
az keyvault secret set --vault-name "$KV" --name JUDGE-ENDPOINT --value "<azure-ai-foundry-endpoint>"
az keyvault secret set --vault-name "$KV" --name LITELLM-MASTER-KEY --value "$(python -c 'import secrets; print(secrets.token_urlsafe(24))')"
az keyvault secret set --vault-name "$KV" --name LITELLM-DATABASE-URL \
  --value "postgresql://pgadmin:<password>@<postgresServerFqdn output>:5432/litellm?sslmode=require"

# Credentials for the audited external systems (only set the ones you have):
az keyvault secret set --vault-name "$KV" --name HR-GATEWAY-API-KEY --value "<...>"
az keyvault secret set --vault-name "$KV" --name TECHVEST-API-KEY --value "<...>"
az keyvault secret set --vault-name "$KV" --name TARGET-API-KEY --value "<...>"
```

Then re-apply the Bicep deployment (same command as step 1) so the Container
Apps pick up the now-resolvable secret refs, or just restart the revisions:

```bash
az containerapp revision restart --name <backendAppName output> -g "$RG"
az containerapp revision restart --name <litellmAppName output> -g "$RG"
```

## 3. Set up GitHub OIDC (no stored Azure secret)

```bash
APP_ID=$(az ad app create --display-name "governai-github-oidc" --query appId -o tsv)
az ad sp create --id "$APP_ID"

az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "governai-main-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<org>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Grant it Contributor on the resource group (scope it tighter later if you want).
az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/<subscription-id>/resourceGroups/$RG"
```

If you also want PR-triggered preview runs of the `test` job to authenticate
(they don't need to today — `test` never calls Azure), skip this; only jobs
that run on `push` to `main` need the credential, and the federated
credential's `subject` above already restricts it to exactly that branch.

## 4. Get the Static Web App deployment token

```bash
az staticwebapp secrets list \
  --name <staticWebAppName output> -g "$RG" \
  --query "properties.apiKey" -o tsv
```

## 5. Wire it all into GitHub

**Settings → Secrets and variables → Actions → Secrets:**

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | `$APP_ID` from step 3 |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | token from step 4 |

**Settings → Secrets and variables → Actions → Variables:**

| Variable | Value |
|---|---|
| `AZURE_RESOURCE_GROUP` | `$RG` |
| `ACR_NAME` | bicep output `containerRegistryLoginServer`, minus the `.azurecr.io` suffix |
| `ACR_LOGIN_SERVER` | bicep output `containerRegistryLoginServer` |
| `BACKEND_APP_NAME` | bicep output `backendAppName` |
| `MIGRATION_JOB_NAME` | bicep output `migrationJobName` |
| `BACKEND_STABLE_FQDN` | bicep output `backendFqdn` |

**Settings → Environments:** create a `production` environment (the workflow's
deploy jobs target it). Add required reviewers here if you want a manual
approval gate before `deploy-backend`/`migrate` run — the workflow doesn't
assume one, but the environment is where you'd add it without touching YAML.

## 6. First real deploy

Push to `main`, or run the workflow manually (`workflow_dispatch`). Watch it
in the Actions tab — `smoke-test`'s last step only shifts traffic once the
new revision's own health check passes; until then the previous revision
keeps serving 100% of traffic (see `deploy.yml`'s comments).

## What CI/CD updates vs. what stays manual

| Changes on every push to `main` | Provisioned once, only touched here |
|---|---|
| Backend container image (new tag, new revision) | Resource group, ACR, Key Vault, Postgres server |
| Which revision gets 100% traffic | Container Apps environment, the apps' shape/secrets wiring |
| Static Web App content | Static Web App resource itself |
| Database schema (via the migration job) | Managed identity + role assignments |

If you need to change a Container App's secret wiring, scale rule, or add a
new external system's credential, that's a `main.bicep` edit + re-deploy —
`deploy.yml` only ever touches the image and the traffic split.

## Cost

See the deployment plan's §9 — roughly $90-150/month for this infra at the
sizes in `main.bicep`, not counting Azure AI Foundry token spend.
