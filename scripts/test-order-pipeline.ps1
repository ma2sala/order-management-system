# Tests the order-creation pipeline directly against the backend, bypassing
# the browser entirely. Run this from the project root in PowerShell while
# `npm start` is running in another terminal.
#
# What it does, step by step:
#   1. Logs in as the demo waiter to get a JWT.
#   2. Fetches a real table id and a real menu item id (so the order is valid).
#   3. Posts a new order using that token.
#   4. Prints the raw JSON response, including createdAt exactly as the
#      database stored it, and the server terminal will show the new
#      [orders] log lines from orderController.js at the same moment.
#
# Watch the terminal running `npm start` while this runs -- if you see the
# "[orders] barista_channel currently has 0 connected socket(s)" line, the
# Barista Display's socket never joined the room (a login/auth/role issue
# on that screen), which is the single most likely explanation for orders
# reaching the database but never appearing live.

$base = "http://localhost:4000"

Write-Host "`n--- 1. Logging in as waiter ---"
$loginBody = @{ email = "waiter@demo.com"; password = "password123" } | ConvertTo-Json
$loginResp = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResp.token
Write-Host "Token acquired: $($token.Substring(0,20))..."

$headers = @{ Authorization = "Bearer $token" }

Write-Host "`n--- 2. Fetching a real table id ---"
$tables = Invoke-RestMethod -Uri "$base/api/tables" -Headers $headers
$tableId = $tables[0].id
Write-Host "Using table: $($tables[0].label) ($tableId)"

Write-Host "`n--- 3. Fetching a real menu item id ---"
$categories = Invoke-RestMethod -Uri "$base/api/categories" -Headers $headers
$firstItem = $categories | ForEach-Object { $_.menuItems } | Where-Object { $_ } | Select-Object -First 1
if (-not $firstItem) {
  # top-level category had no direct items -- dig into the first child instead
  $firstItem = $categories | ForEach-Object { $_.children } | ForEach-Object { $_.menuItems } | Where-Object { $_ } | Select-Object -First 1
}
$menuItemId = $firstItem.id
Write-Host "Using menu item: $($firstItem.name) ($menuItemId)"

Write-Host "`n--- 4. Posting a test order ---"
$orderBody = @{
  tableId = $tableId
  items   = @(@{ menuItemId = $menuItemId; quantity = 1 })
} | ConvertTo-Json -Depth 5

$orderResp = Invoke-RestMethod -Uri "$base/api/orders" -Method Post -Body $orderBody -ContentType "application/json" -Headers $headers

Write-Host "`n--- Order created ---"
Write-Host "id:        $($orderResp.id)"
Write-Host "createdAt: $($orderResp.createdAt)"
Write-Host "status:    $($orderResp.status)"
Write-Host "`nFull response:"
$orderResp | ConvertTo-Json -Depth 5

Write-Host "`n--- Now check the terminal running 'npm start' for the [orders] log lines ---"
Write-Host "If 'barista_channel currently has 0 connected socket(s)' appears, the"
Write-Host "Barista Display's socket never joined that room -- check its login/console."
