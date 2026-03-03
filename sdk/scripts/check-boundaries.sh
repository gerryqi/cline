#!/usr/bin/env bash
set -euo pipefail

violations="$(
	rg --no-heading --line-number 'from "@cline/(llms|agents|core)/|from '\''@cline/(llms|agents|core)/|import\("@cline/(llms|agents|core)/|import\('\''@cline/(llms|agents|core)/' \
		-g '*.ts' \
		-g '*.tsx' \
		-g '*.js' \
		-g '*.jsx' \
		-g '*.mts' \
		-g '*.cts' \
		-g '!**/dist/**' \
		-g '!**/node_modules/**' \
		. | rg -v '@cline/core/server' || true
)"

if [[ -n "$violations" ]]; then
	echo "Cross-workspace deep imports are forbidden (except @cline/core/server):"
	echo "$violations"
	exit 1
fi

echo "Boundary check passed."
