#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

for tool in node npm flexcli; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Fehlt: $tool. Benötigt werden Node.js >= 20, npm und FlexCLI (npm install -g @eniac/flexcli)." >&2
    exit 1
  fi
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js >= 20 erforderlich"); process.exit(1); }'

echo "FlexDesigner muss für die Installation laufen."
npm ci --include=dev
npm run build
npm test
npm run plugin:validate

ID="$(node -p 'require("./src/core").UUID')"
PLUGIN="$PWD/$ID.plugin"
PACKAGE="$PWD/$ID.flexplugin"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/klipper-build.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT

# Never package the working copy's config.json (credentials) or logs. Pack from
# staging: older FlexCLI versions ignore --output and write beside the plugin.
mkdir -p "$STAGING/$ID.plugin"
cp "$PLUGIN/manifest.json" "$STAGING/$ID.plugin/"
cp -R "$PLUGIN/backend" "$PLUGIN/resources" "$PLUGIN/ui" "$STAGING/$ID.plugin/"
printf '{}\n' > "$STAGING/$ID.plugin/config.json"
flexcli plugin pack --path "$STAGING/$ID.plugin"
test -s "$STAGING/$ID.flexplugin"
mv -f "$STAGING/$ID.flexplugin" "$PACKAGE"
echo "Paket erstellt: $PACKAGE"

# No --force: keep existing installations/configuration safe. Some FlexCLI
# versions log failed server responses but still exit 0; check confirmation too.
RESULT="$(flexcli plugin install --path "$PACKAGE")"
printf '%s\n' "$RESULT"
if [[ "$RESULT" != *"Install command successful:"* ]]; then
  echo "Installation nicht bestätigt. FlexDesigner starten bzw. eine bestehende Installation dort prüfen. Das Paket bleibt unter $PACKAGE erhalten." >&2
  exit 1
fi
echo "Build und Installation erfolgreich abgeschlossen."
