#!/bin/sh
# PostToolUse on Write/Edit: validate layout, municipality, site and fixture JSON against schema/, and lint Writer
# records, so a file that breaks the contract is reported to Claude the moment it is written.
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$file" in
  */data/layouts/*/index.json) exit 0 ;;
  */data/layouts/*.json|*/data/municipalities/*.json|*/data/sites/*.json|*/schema/fixtures/*.json)
    out=$(cd "$root" && pnpm -F agents -s validate "$file" 2>&1) || { printf '%s\n' "$out" >&2; exit 2; } ;;
  */data/writer/*.json)
    out=$(cd "$root" && pnpm -F agents -s lint-writer "$file" 2>&1) || { printf '%s\n' "$out" >&2; exit 2; } ;;
esac
exit 0
