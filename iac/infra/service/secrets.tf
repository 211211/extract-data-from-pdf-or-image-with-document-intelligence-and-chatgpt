# Key Vault for storing secrets
resource "azurerm_key_vault" "default" {
  name                = "kv-${local.full_name}"
  location            = data.azurerm_resource_group.default.location
  resource_group_name = data.azurerm_resource_group.default.name
  sku_name            = "standard"
  tenant_id           = data.azurerm_client_config.current.tenant_id

  # Enable soft delete and purge protection for production
  soft_delete_retention_days = 7
  purge_protection_enabled   = false

  tags = local.common_tags
}

# Access policy for the current deployment user/service principal
resource "azurerm_key_vault_access_policy" "deployer_access" {
  key_vault_id = azurerm_key_vault.default.id
  object_id    = data.azurerm_client_config.current.object_id
  tenant_id    = data.azurerm_client_config.current.tenant_id

  secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
}

# Access policy for the web app managed identity
resource "azurerm_key_vault_access_policy" "web_app_access" {
  key_vault_id = azurerm_key_vault.default.id
  object_id    = module.web_app.principal_id
  tenant_id    = data.azurerm_client_config.current.tenant_id

  secret_permissions = ["Get"]
}

# Azure OpenAI API Key (placeholder - manually set after deployment)
resource "azurerm_key_vault_secret" "azure_openai_api_key" {
  name         = "azure-openai-api-key"
  value        = "placeholder"
  key_vault_id = azurerm_key_vault.default.id

  depends_on = [azurerm_key_vault_access_policy.deployer_access]

  lifecycle {
    ignore_changes = [value]
  }
}

# CosmosDB Key
resource "azurerm_key_vault_secret" "azure_cosmosdb_key" {
  name         = "azure-cosmosdb-key"
  value        = azurerm_cosmosdb_account.default.primary_key
  key_vault_id = azurerm_key_vault.default.id

  depends_on = [azurerm_key_vault_access_policy.deployer_access]
}

# Document Intelligence Key
resource "azurerm_key_vault_secret" "azure_document_intelligence_key" {
  name         = "azure-document-intelligence-key"
  value        = azurerm_cognitive_account.document_intelligence.primary_access_key
  key_vault_id = azurerm_key_vault.default.id

  depends_on = [azurerm_key_vault_access_policy.deployer_access]
}

# Azure Search API Key
resource "azurerm_key_vault_secret" "azure_search_api_key" {
  name         = "azure-search-api-key"
  value        = azurerm_search_service.default.primary_key
  key_vault_id = azurerm_key_vault.default.id

  depends_on = [azurerm_key_vault_access_policy.deployer_access]
}
