locals {
  full_name         = var.app_name
  custom_domain_url = var.custom_domain != null ? "https://${var.custom_domain}" : null
  app_host          = "${var.app_name}.azurewebsites.net"
  app_url           = "https://${local.app_host}/"

  common_tags = {
    APPLICATION   = "ai-native-enterprise-chat"
    CONTACT-APP   = "your-email@example.com"
    COST-CENTER   = "portfolio"
    CREATED-DATE  = "12/05/2024"
    DESCRIPTION   = "AI Native Enterprise Chat Application - ChatGPT-like platform with RAG"
    FUNCTION      = "application"
    LANDSCAPE     = "development"
    PROJECT       = "ai-native-enterprise-chat"
  }
}

module "web_app" {
  source = "./modules/web-app"

  app_name            = var.app_name
  resource_group_name = var.resource_group_name
  sku_name            = var.sku_name
  node_version        = "20-lts"
  app_command_line    = "node dist/main.js"

  environment_variables = {
    # Node environment
    NODE_ENV = "production"

    # Azure OpenAI Configuration
    AZURE_OPENAI_API_INSTANCE_NAME              = "aoa-zeu-gpt-dev"
    AZURE_OPENAI_API_DEPLOYMENT_NAME            = "gpt-4o"
    AZURE_OPENAI_API_VERSION                    = "2024-02-15-preview"
    OPENAI_API_KEY                              = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.azure_openai_api_key.versionless_id})"
    AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME = "text-embedding-ada-002"

    # Azure Document Intelligence
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = azurerm_cognitive_account.document_intelligence.endpoint
    AZURE_DOCUMENT_INTELLIGENCE_KEY      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.azure_document_intelligence_key.versionless_id})"

    # Azure Cognitive Search
    AZURE_SEARCH_ENDPOINT    = "https://${azurerm_search_service.default.name}.search.windows.net"
    AZURE_SEARCH_API_KEY     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.azure_search_api_key.versionless_id})"
    AZURE_SEARCH_INDEX_NAME  = var.search_index_name
    AZURE_SEARCH_API_VERSION = "2023-11-01"

    # CosmosDB (optional - for chat persistence)
    AZURE_COSMOSDB_URI            = azurerm_cosmosdb_account.default.endpoint
    AZURE_COSMOSDB_KEY            = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.azure_cosmosdb_key.versionless_id})"
    AZURE_COSMOSDB_DB_NAME        = var.cosmosdb_db_name
    AZURE_COSMOSDB_CONTAINER_NAME = var.cosmosdb_container_name

    # App Settings
    PORT       = "8080"
    SWAGGER_UI = "true"
  }

  tags = local.common_tags
}
