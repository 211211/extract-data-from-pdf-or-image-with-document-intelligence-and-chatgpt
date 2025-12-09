data "azurerm_client_config" "current" {}

data "azurerm_resource_group" "default" {
  name = var.resource_group_name
}
