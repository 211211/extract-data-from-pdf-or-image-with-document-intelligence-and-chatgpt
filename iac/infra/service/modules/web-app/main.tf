locals {
  full_name  = var.app_name
  app_domain = var.app_name
}

resource "azurerm_service_plan" "default" {
  name                = "${local.full_name}-service-plan"
  location            = data.azurerm_resource_group.default.location
  resource_group_name = data.azurerm_resource_group.default.name
  os_type             = "Linux"
  sku_name            = var.sku_name

  tags = var.tags
}

resource "azurerm_linux_web_app" "default" {
  name                = local.app_domain
  location            = data.azurerm_resource_group.default.location
  resource_group_name = data.azurerm_resource_group.default.name
  service_plan_id     = azurerm_service_plan.default.id

  site_config {
    always_on        = var.always_on
    app_command_line = var.app_command_line

    application_stack {
      node_version = var.node_version
    }
  }

  app_settings = var.environment_variables

  identity {
    type = "SystemAssigned"
  }

  logs {
    detailed_error_messages = true
    failed_request_tracing  = true

    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 50
      }
    }
  }

  tags = var.tags
}
