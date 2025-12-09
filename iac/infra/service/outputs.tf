# Web App Outputs
output "app_url" {
  description = "The URL of the deployed web application"
  value       = module.web_app.app_url
}

output "app_hostname" {
  description = "The default hostname of the web application"
  value       = module.web_app.default_hostname
}

# CosmosDB Outputs
output "cosmosdb_endpoint" {
  description = "The endpoint of the CosmosDB account"
  value       = azurerm_cosmosdb_account.default.endpoint
}

output "cosmosdb_database_name" {
  description = "The name of the CosmosDB database"
  value       = azurerm_cosmosdb_sql_database.default.name
}

# Search Service Outputs
output "search_service_name" {
  description = "The name of the Azure Cognitive Search service"
  value       = azurerm_search_service.default.name
}

output "search_service_endpoint" {
  description = "The endpoint of the Azure Cognitive Search service"
  value       = "https://${azurerm_search_service.default.name}.search.windows.net"
}

# Document Intelligence Outputs
output "document_intelligence_endpoint" {
  description = "The endpoint of the Azure Document Intelligence service"
  value       = azurerm_cognitive_account.document_intelligence.endpoint
}

# Key Vault Outputs
output "key_vault_name" {
  description = "The name of the Key Vault"
  value       = azurerm_key_vault.default.name
}

output "key_vault_uri" {
  description = "The URI of the Key Vault"
  value       = azurerm_key_vault.default.vault_uri
}
