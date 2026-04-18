#!/bin/zsh
# Sets the primary (display) column for each table so that refs show
# human-readable values instead of auto-sequence IDs.

set -e
cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")

# Desired primary column names per table (by column name).
# Format: "Table Name|Primary Column Name"
declare -a primaries=(
  "Customers|Name"
  "Customer Identifications|ID Number"
  "Subscriptions|MSISDN"
  "Subscription Status History|To Status"
  "MSISDN Pool|MSISDN"
  "SIM Inventory|ICCID"
  "Services|Service Name"
  "Product Offerings|Offering Name"
  "Bundles|Bundle Name"
  "Tariff Plans|Plan Name"
  "Plan Allowances|Allowance Label"
  "Rate Cards|Rate Card Code"
  "Tax Rates|Tax Name"
  "Bonus Grants|Bonus Code"
  "Wallets|Wallet Code"
  "Wallet Transactions|Transaction Code"
  "Recharges|Recharge Code"
  "Recharge Vouchers|Voucher Serial"
  "Balance Transfers|Transfer Code"
  "Charging Sessions|Session ID"
  "Call Detail Records|CDR Code"
  "Balances|Balance Code"
  "Promotions|Promotion Name"
  "Friends and Family Groups|Group Name"
  "FF Members|Member MSISDN"
  "Closed User Groups|CUG Name"
  "Distribution Partners|Partner Name"
  "Partner Contracts|Contract Number"
  "Channels|Channel Name"
  "Customer Interactions|Interaction Code"
  "Orders|Order Code"
  "Cases|Subject"
  "Notification Templates|Template Name"
  "Business Rules|Rule Name"
  "Network Elements|Element Code"
)

for entry in "${primaries[@]}"; do
  table_name="${entry%%|*}"
  col_name="${entry##*|}"

  tid=$(echo "$IDS_JSON" | jq -r --arg n "$table_name" '.[$n] // empty')
  if [ -z "$tid" ]; then
    echo "  SKIP $table_name (no id)"; continue
  fi

  # Find the column ID for the desired name (API returns at top level, not .data)
  col_id=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/v1/app-builder/table/$tid" \
    | jq -r --arg n "$col_name" '(.columnsMetaData // .data.columnsMetaData // [])[] | select(.name == $n) | .id' | head -1)

  if [ -z "$col_id" ]; then
    echo "  ✗ $table_name — column '$col_name' not found"
    continue
  fi

  res=$(curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$tid/primary-column" \
    -d "{\"columnId\": \"$col_id\"}")

  ok=$(echo "$res" | jq -r '.success // false')
  if [ "$ok" = "true" ]; then
    echo "  ✓ $table_name → $col_name ($col_id)"
  else
    echo "  ✗ $table_name → $col_name: $(echo "$res" | jq -c '.message // .')"
  fi
  sleep 1.1
done

echo "Done."
