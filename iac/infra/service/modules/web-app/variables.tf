variable "app_name" {
  description = "Application name"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the resource group the app is attaching to"
  type        = string
}

variable "sku_name" {
  description = "App service sku name"
  type        = string
}

variable "always_on" {
  description = "If this Web App is always on?"
  type        = bool
  default     = true
}

variable "app_command_line" {
  description = "The App command line to launch"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the web app"
  type        = map(string)
}

variable "tags" {
  description = "Application tags"
  type        = map(string)
}

variable "node_version" {
  description = "Node.js version for the application stack"
  type        = string
  default     = "20-lts"
}
