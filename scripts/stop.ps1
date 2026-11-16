$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..\compose.yaml'
& docker compose -f $composeFile down
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Kanban stopped. Database volume preserved.'
