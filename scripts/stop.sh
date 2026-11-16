#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker compose -f "$script_dir/../compose.yaml" down
printf '%s\n' 'Kanban stopped. Database volume preserved.'
