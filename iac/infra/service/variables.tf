variable "app_name" {
  description = "App name"
  type        = string
  default     = "ai-native-chat"
}

variable "resource_group_name" {
  description = "Name of the resource group the app is attaching to"
  type        = string
  default     = "rg-ai-native-chat-dev"
}

variable "sku_name" {
  description = "App service sku name"
  type        = string
  default     = "S1"
}

variable "custom_domain" {
  description = "Custom domain to configure in the app service"
  type        = string
  default     = null
}

variable "subscription_id" {
  description = "Azure subscription id"
  type        = string
  default     = "aad28fa9-e78e-4b8d-b9ab-3ef2a289c6a6"
}

# CosmosDB variables
variable "cosmosdb_db_name" {
  description = "CosmosDB database name"
  type        = string
  default     = "pdfextractor"
}

variable "cosmosdb_container_name" {
  description = "Container name where the chat history is stored"
  type        = string
  default     = "chat_history"
}

# Search variables
variable "search_index_name" {
  description = "Azure Cognitive Search index name"
  type        = string
  default     = "documents"
}

variable "search_sku" {
  description = "Azure Cognitive Search SKU"
  type        = string
  default     = "standard"
}

# Document Intelligence variables
variable "document_intelligence_sku" {
  description = "Azure Document Intelligence (Form Recognizer) SKU"
  type        = string
  default     = "S0"
}
