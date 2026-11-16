$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..\compose.yaml'
& docker compose -f $composeFile up --build --detach --wait
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Kanban is running at http://localhost:8000'
