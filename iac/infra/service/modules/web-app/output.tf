output "app_service_id" {
  value = azurerm_linux_web_app.default.id
}

output "principal_id" {
  value = azurerm_linux_web_app.default.identity[0].principal_id
}

output "default_hostname" {
  value = azurerm_linux_web_app.default.default_hostname
}

output "app_url" {
  value = "https://${azurerm_linux_web_app.default.default_hostname}"
}
