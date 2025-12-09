resource "azurerm_cosmosdb_account" "default" {
  name                = "${local.full_name}-cosmosdb"
  location            = data.azurerm_resource_group.default.location
  offer_type          = "Standard"
  resource_group_name = data.azurerm_resource_group.default.name
  kind                = "GlobalDocumentDB"

  consistency_policy {
    consistency_level       = "BoundedStaleness"
    max_interval_in_seconds = 10
    max_staleness_prefix    = 200
  }

  geo_location {
    failover_priority = 0
    location          = data.azurerm_resource_group.default.location
  }

  # Enable continuous backup for point-in-time restore
  backup {
    type                = "Continuous"
    tier                = "Continuous7Days"
  }

  tags = local.common_tags
}

resource "azurerm_cosmosdb_sql_database" "default" {
  name                = var.cosmosdb_db_name
  resource_group_name = data.azurerm_resource_group.default.name
  account_name        = azurerm_cosmosdb_account.default.name
}

resource "azurerm_cosmosdb_sql_container" "chat_history" {
  name                  = var.cosmosdb_container_name
  resource_group_name   = data.azurerm_resource_group.default.name
  account_name          = azurerm_cosmosdb_account.default.name
  database_name         = azurerm_cosmosdb_sql_database.default.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1
  throughput            = 400

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    excluded_path {
      path = "/content/*"
    }
  }

  default_ttl = -1
}
