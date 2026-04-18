#!/bin/zsh
# Save the 3 new custom pages to ERPAI's custom-pages registry.

set -e
cd "$(dirname "$0")"
BASE_URL="https://api.erpai.studio"
TOKEN="erp_pat_live_REDACTED"
APP_ID="afe8c4540708da6ca9e6fe79"

save_page() {
  local slug="$1"
  local name="$2"
  local desc="$3"
  local icon="$4"
  local file="$5"

  python3 -c "
import json, re
html = open('$file').read()
# Strip window.ERPAI injection block
clean = re.sub(r'<script>\s*\nwindow\.ERPAI\s*=\s*\{[^}]+\};\s*\n</script>\s*\n?', '', html, count=1)
clean = clean.lstrip()
payload = {
  'name': '$name',
  'slug': '$slug',
  'description': '$desc',
  'html': clean,
  'icon': '$icon',
  'category': 'Overview',
}
json.dump(payload, open('/tmp/page-payload.json', 'w'))
"

  echo "Saving: $name"
  curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/page-payload.json \
    "$BASE_URL/v1/agent/app/custom-pages?appId=$APP_ID" \
    | jq '{success, id: .data._id, name: .data.name, slug: .data.slug}'
  echo ""
  sleep 1
}

save_page \
  "customer-360" \
  "Customer 360" \
  "Complete customer profile: subscriptions, balances, wallet, KYC, recharges, cases, lifecycle, recent activity." \
  "UserSearch" \
  "../custom-pages/customer-360.html"

save_page \
  "cdr-settlement" \
  "CDR Settlement Report" \
  "Daily Call Detail Records with service/rating-group breakdowns, hourly volume, termination cause analysis, and CSV export." \
  "FileSpreadsheet" \
  "../custom-pages/cdr-settlement.html"

save_page \
  "usage-heatmap" \
  "Usage Patterns Heatmap" \
  "Day-of-week × hour-of-day heatmap of network usage. Filter by metric (events / data / voice / SMS) to see peak patterns." \
  "Activity" \
  "../custom-pages/usage-heatmap.html"

echo "Done. Refresh ERPAI sidebar — 3 new pages under Overview."
