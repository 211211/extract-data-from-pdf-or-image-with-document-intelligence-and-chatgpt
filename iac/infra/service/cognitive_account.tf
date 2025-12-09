# Azure Document Intelligence (formerly Form Recognizer)
resource "azurerm_cognitive_account" "document_intelligence" {
  name                = "${var.app_name}-docint"
  resource_group_name = data.azurerm_resource_group.default.name
  location            = data.azurerm_resource_group.default.location
  kind                = "FormRecognizer"
  sku_name            = var.document_intelligence_sku

  custom_subdomain_name      = "${var.app_name}-docint"
  dynamic_throttling_enabled = false
  fqdns                      = []

  network_acls {
    default_action = "Allow"
    ip_rules       = []
  }

  tags = local.common_tags
}
