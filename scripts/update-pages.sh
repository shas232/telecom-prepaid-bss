#!/bin/zsh
# Update all 4 pages (they already exist — use PUT to update HTML).

set -e
cd "$(dirname "$0")"
BASE_URL="https://api.erpai.studio"
TOKEN="erp_pat_live_REDACTED"
APP_ID="afe8c4540708da6ca9e6fe79"

# Fetch current page IDs
PAGES_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/agent/app/custom-pages?appId=$APP_ID")
echo "$PAGES_JSON" | jq -r '.response.data[] | "\(.slug)|\(._id)"' > /tmp/page-ids.txt

update_page() {
  local slug="$1"
  local file="$2"
  local page_id=$(grep "^$slug|" /tmp/page-ids.txt | cut -d'|' -f2)
  if [ -z "$page_id" ]; then
    echo "  ✗ $slug: no existing page found"; return
  fi

  python3 -c "
import json, re
html = open('$file').read()
clean = re.sub(r'<script>\s*\nwindow\.ERPAI\s*=\s*\{[^}]+\};\s*\n</script>\s*\n?', '', html, count=1)
clean = clean.lstrip()
json.dump({'html': clean}, open('/tmp/page-payload.json', 'w'))
"

  local resp=$(curl -s -X PUT \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/page-payload.json \
    "$BASE_URL/v1/agent/app/custom-pages/$page_id?appId=$APP_ID")
  local ok=$(echo "$resp" | jq -r '.success // false')
  echo "  ${ok:+✓} $slug → $page_id"
  sleep 1
}

update_page "prepaid-customer-balances" "../custom-pages/balance-dashboard.html"
update_page "customer-360"              "../custom-pages/customer-360.html"
update_page "cdr-settlement"            "../custom-pages/cdr-settlement.html"
update_page "usage-heatmap"             "../custom-pages/usage-heatmap.html"

echo ""
echo "Done. Hard-refresh the sidebar tabs (Cmd+Shift+R)."
