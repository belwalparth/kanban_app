#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker compose -f "$script_dir/../compose.yaml" up --build --detach --wait
printf '%s\n' 'Kanban is running at http://localhost:8000'
