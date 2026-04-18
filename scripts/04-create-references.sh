#!/bin/zsh
# Creates all reference columns (inter-table relationships).
# Uses the /v1/agent/app/reference-columns batch endpoint.

set -e
cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")
FAILED=()

# Resolve a table name to its ID
tid() {
  echo "$IDS_JSON" | jq -r --arg n "$1" '.[$n] // empty'
}

# Create a reference column
#   $1 = ref column display name
#   $2 = source table name (where column is added)
#   $3 = target table name (referenced)
#   $4 = required (true/false)
#   $5 = multipleRecords (true/false)
add_ref() {
  local colname="$1" src="$2" dst="$3" req="${4:-false}" multi="${5:-false}"
  local src_id=$(tid "$src") dst_id=$(tid "$dst")
  if [ -z "$src_id" ] || [ -z "$dst_id" ]; then
    echo "  ✗ $src → $dst ($colname): missing id(s)"
    FAILED+=("$src→$dst.$colname")
    return
  fi
  # Ref type to use: ref (single) or ref_array (many-to-many)
  local reftype="ref"
  [ "$multi" = "true" ] && reftype="ref_array"

  local body
  body=$(jq -nc \
    --arg name "$colname" \
    --arg refId "$dst_id" \
    --arg rtype "$reftype" \
    --argjson req "$req" \
    '{
      columns: [{
        name: $name,
        type: $rtype,
        refTable: {_id: $refId},
        required: $req
      }]
    }')
  local res
  res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$src_id/column/bulk" -d "$body")
  # Handle rate limit
  local retry=0
  while [ "$(echo "$res" | jq -r '.status // 0' 2>/dev/null)" = "429" ] && [ $retry -lt 5 ]; do
    sleep 3
    retry=$((retry+1))
    res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$src_id/column/bulk" -d "$body")
  done
  local ok=$(echo "$res" | jq -r '.success // false' 2>/dev/null)
  if [ "$ok" = "true" ]; then
    echo "  ✓ $src.$colname → $dst"
  else
    echo "  ✗ $src.$colname → $dst: $(echo "$res" | jq -c '.message // .' 2>/dev/null | head -c 200)"
    FAILED+=("$src→$dst.$colname")
  fi
  sleep 1.3
}

echo "=== Customer Domain ==="
add_ref "Customer" "Customer Identifications" "Customers" true false
add_ref "Customer" "Customer Lifecycle Events" "Customers" true false
add_ref "Parent Customer" "Account Hierarchy" "Customers" true false
add_ref "Child Customer" "Account Hierarchy" "Customers" true false

echo "=== Subscriber Domain ==="
add_ref "Customer" "Subscriptions" "Customers" true false
add_ref "Subscription" "Subscription Status History" "Subscriptions" true false
add_ref "Assigned Subscription" "MSISDN Pool" "Subscriptions" false false
add_ref "Allocated To Partner" "SIM Inventory" "Distribution Partners" false false
add_ref "Active Subscription" "SIM Inventory" "Subscriptions" false false

echo "=== Catalog Domain ==="
add_ref "Bundle" "Bundle Components" "Bundles" true false
add_ref "Offering" "Bundle Components" "Product Offerings" true false
add_ref "Product Offering" "Tariff Plans" "Product Offerings" true false
add_ref "Tariff Plan" "Plan Allowances" "Tariff Plans" true false
add_ref "Service" "Plan Allowances" "Services" false false
add_ref "Tariff Plan" "Rate Cards" "Tariff Plans" false false

echo "=== Plan Assignment & Bonus ==="
add_ref "Subscription" "Subscription Plan Assignments" "Subscriptions" true false
add_ref "Tariff Plan" "Subscription Plan Assignments" "Tariff Plans" true false
add_ref "Subscription" "Bonus Grants" "Subscriptions" true false

echo "=== Wallet & Recharge ==="
add_ref "Customer" "Wallets" "Customers" true false
add_ref "Wallet" "Wallet Transactions" "Wallets" true false
add_ref "Wallet" "Recharges" "Wallets" true false
add_ref "Distribution Partner" "Recharges" "Distribution Partners" false false
add_ref "Allocated Partner" "Recharge Vouchers" "Distribution Partners" false false
add_ref "Redeemed By Recharge" "Recharge Vouchers" "Recharges" false false
add_ref "From Subscription" "Balance Transfers" "Subscriptions" true false
add_ref "To Subscription" "Balance Transfers" "Subscriptions" true false

echo "=== Charging & Usage ==="
add_ref "Subscription" "Charging Sessions" "Subscriptions" true false
add_ref "Charging Session" "Usage Transactions" "Charging Sessions" true false
add_ref "Subscription" "Usage Transactions" "Subscriptions" true false
add_ref "Balance" "Usage Transactions" "Balances" false false
add_ref "Charging Session" "Call Detail Records" "Charging Sessions" true false
add_ref "Subscription" "Call Detail Records" "Subscriptions" true false
add_ref "Customer" "Call Detail Records" "Customers" false false
add_ref "Tariff Plan" "Call Detail Records" "Tariff Plans" false false
add_ref "Subscription" "Balances" "Subscriptions" true false
add_ref "Subscription Plan Assignment" "Balances" "Subscription Plan Assignments" true false

echo "=== Promotions & Supplementary ==="
add_ref "Promotion" "Promotion Redemptions" "Promotions" true false
add_ref "Customer" "Promotion Redemptions" "Customers" true false
add_ref "Subscription" "Promotion Redemptions" "Subscriptions" false false
add_ref "Owner Subscription" "Friends and Family Groups" "Subscriptions" true false
add_ref "FF Group" "FF Members" "Friends and Family Groups" true false
add_ref "Owner Customer" "Closed User Groups" "Customers" false false
add_ref "CUG" "CUG Members" "Closed User Groups" true false
add_ref "Subscription" "CUG Members" "Subscriptions" true false

echo "=== Partners ==="
add_ref "Partner" "Partner Commissions" "Distribution Partners" true false
add_ref "Recharge" "Partner Commissions" "Recharges" false false
add_ref "Partner" "Partner Contracts" "Distribution Partners" true false

echo "=== Channels, Orders, Cases ==="
add_ref "Customer" "Customer Interactions" "Customers" false false
add_ref "Subscription" "Customer Interactions" "Subscriptions" false false
add_ref "Channel" "Customer Interactions" "Channels" false false
add_ref "Customer" "Orders" "Customers" true false
add_ref "Subscription" "Orders" "Subscriptions" false false
add_ref "Channel" "Orders" "Channels" false false
add_ref "Order" "Order Items" "Orders" true false
add_ref "Product Offering" "Order Items" "Product Offerings" false false
add_ref "Tariff Plan" "Order Items" "Tariff Plans" false false
add_ref "Customer" "Cases" "Customers" true false
add_ref "Subscription" "Cases" "Subscriptions" false false
add_ref "Channel" "Cases" "Channels" false false

echo "=== Notifications ==="
add_ref "Template" "Notifications Sent" "Notification Templates" false false
add_ref "Customer" "Notifications Sent" "Customers" false false
add_ref "Subscription" "Notifications Sent" "Subscriptions" false false
add_ref "Channel" "Notifications Sent" "Channels" false false

echo ""
echo "=== Summary ==="
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED refs: ${#FAILED[@]}"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
else
  echo "All references created successfully."
fi
