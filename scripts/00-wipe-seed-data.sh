#!/bin/zsh
# Wipes all records from tables that seed-data writes to.
# Leaves the schema (tables/columns/refs) intact.

cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")

TABLES_TO_WIPE=(
  "Balances"
  "Subscription Plan Assignments"
  "Wallets"
  "Subscriptions"
  "Customers"
  "Recharge Vouchers"
  "Rate Cards"
  "Plan Allowances"
  "Tariff Plans"
  "Product Offerings"
  "Distribution Partners"
  "Notification Templates"
  "Network Elements"
  "Tax Rates"
  "Channels"
  "Services"
)

for tname in "${TABLES_TO_WIPE[@]}"; do
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$tname" '.[$n]')
  [ -z "$tid" ] || [ "$tid" = "null" ] && continue

  # Fetch all records (paginate)
  ids=()
  page=1
  while true; do
    res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$tid/paged-record?pageNo=$page&pageSize=100" -d '{}')
    count=$(echo "$res" | jq -r '.data | length' 2>/dev/null)
    [ -z "$count" ] || [ "$count" = "null" ] || [ "$count" = "0" ] && break
    page_ids=($(echo "$res" | jq -r '.data[]._id'))
    ids+=("${page_ids[@]}")
    [ "$count" -lt 100 ] && break
    page=$((page + 1))
    sleep 1.1
  done

  if [ ${#ids[@]} -eq 0 ]; then
    echo "  $tname: empty"
    continue
  fi

  # Bulk delete by IDs
  body=$(jq -nc --argjson a "$(printf '%s\n' "${ids[@]}" | jq -R . | jq -sc .)" '{arr: $a}')
  res=$(curl -s -X DELETE -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$tid/record" -d "$body")
  ok=$(echo "$res" | jq -r '.success // false' 2>/dev/null)
  echo "  $tname: deleted ${#ids[@]} records (success=$ok)"
  sleep 1.2
done
echo "Done."
