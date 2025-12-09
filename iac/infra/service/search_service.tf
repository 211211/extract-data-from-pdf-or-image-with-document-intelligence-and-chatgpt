resource "azurerm_search_service" "default" {
  name                = var.app_name
  resource_group_name = data.azurerm_resource_group.default.name
  location            = data.azurerm_resource_group.default.location
  sku                 = var.search_sku

  # Enable semantic search capability
  semantic_search_sku = "standard"

  # Replicas and partitions for scaling
  replica_count   = 1
  partition_count = 1

  tags = local.common_tags
}
