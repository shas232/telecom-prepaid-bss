#!/bin/zsh
# Populates refTable.columnId on every existing ref column so that the
# "Column to Show" is set — refs will display human-readable values.

cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")

# Desired display column per target table (by target table name, column name).
typeset -A DISPLAY_COL=(
  "Customers"                     "Name"
  "Customer Identifications"      "ID Number"
  "Subscriptions"                 "MSISDN"
  "Subscription Status History"   "To Status"
  "MSISDN Pool"                   "MSISDN"
  "SIM Inventory"                 "ICCID"
  "Services"                      "Service Name"
  "Product Offerings"             "Offering Name"
  "Bundles"                       "Bundle Name"
  "Tariff Plans"                  "Plan Name"
  "Plan Allowances"               "Allowance Label"
  "Rate Cards"                    "Rate Card Code"
  "Tax Rates"                     "Tax Name"
  "Subscription Plan Assignments" "Balance Code"
  "Bonus Grants"                  "Bonus Code"
  "Wallets"                       "Wallet Code"
  "Wallet Transactions"           "Transaction Code"
  "Recharges"                     "Recharge Code"
  "Recharge Vouchers"             "Voucher Serial"
  "Balance Transfers"             "Transfer Code"
  "Charging Sessions"             "Session ID"
  "Usage Transactions"            "Message Type"
  "Call Detail Records"           "CDR Code"
  "Balances"                      "Balance Code"
  "Promotions"                    "Promotion Name"
  "Friends and Family Groups"     "Group Name"
  "FF Members"                    "Member MSISDN"
  "Closed User Groups"            "CUG Name"
  "Distribution Partners"         "Partner Name"
  "Partner Contracts"             "Contract Number"
  "Channels"                      "Channel Name"
  "Customer Interactions"         "Interaction Code"
  "Orders"                        "Order Code"
  "Cases"                         "Subject"
  "Notification Templates"        "Template Name"
  "Business Rules"                "Rule Name"
  "Network Elements"              "Element Code"
  "Promotion Redemptions"         "Redeemed At"
)

# Cache target_table_id → display_col_id
typeset -A DISPLAY_COL_ID=()

# Pre-resolve all target display column IDs
echo "Resolving target display columns..."
for tname in ${(k)DISPLAY_COL}; do
  colname="${DISPLAY_COL[$tname]}"
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$tname" '.[$n] // empty')
  [ -z "$tid" ] && continue
  col_id=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/app-builder/table/$tid" \
    | jq -r --arg n "$colname" '(.columnsMetaData // .data.columnsMetaData // [])[] | select(.name == $n) | .id' | head -1)
  if [ -z "$col_id" ]; then
    # Fallback: use ID column
    col_id="ID"
  fi
  DISPLAY_COL_ID[$tid]="$col_id"
  echo "  $tname → $colname ($col_id)"
  sleep 0.5
done

echo ""
echo "Fixing ref columns across all tables..."
FIXED=0
FAILED=0

echo "$IDS_JSON" | jq -r 'keys[]' | while IFS= read -r table_name; do
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$table_name" '.[$n]')
  [ "$tid" = "null" ] && continue

  # Find all ref columns on this table where refTable.colId is not set
  refs=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/app-builder/table/$tid" \
    | jq -c '[(.columnsMetaData // .data.columnsMetaData // [])[] | select((.type == "ref" or .type == "ref_array") and (.refTable.colId == null or .refTable.colId == ""))] | map({id, name, refTableId: .refTable._id})')

  count=$(echo "$refs" | jq 'length')
  [ "$count" = "0" ] && continue

  for i in $(seq 0 $((count-1))); do
    col_id=$(echo "$refs" | jq -r ".[$i].id")
    col_name=$(echo "$refs" | jq -r ".[$i].name")
    target_tid=$(echo "$refs" | jq -r ".[$i].refTableId")
    display_col=${DISPLAY_COL_ID[$target_tid]:-ID}

    body=$(jq -nc --arg refId "$target_tid" --arg colId "$display_col" '{refTable: {_id: $refId, colId: $colId}}')
    res=$(curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$tid/column/$col_id" -d "$body")
    # 429 retry
    retry=0
    while [ "$(echo "$res" | jq -r '.status // 0' 2>/dev/null)" = "429" ] && [ $retry -lt 5 ]; do
      sleep 3; retry=$((retry+1))
      res=$(curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        "$BASE_URL/v1/app-builder/table/$tid/column/$col_id" -d "$body")
    done
    ok=$(echo "$res" | jq -r '.success // false' 2>/dev/null)
    if [ "$ok" = "true" ]; then
      echo "  ✓ $table_name.$col_name → (display: $display_col)"
      FIXED=$((FIXED+1))
    else
      echo "  ✗ $table_name.$col_name: $(echo "$res" | jq -c '.message // .' | head -c 150)"
      FAILED=$((FAILED+1))
    fi
    sleep 1.1
  done
done

echo ""
echo "=== Summary ==="
echo "Fixed: $FIXED"
echo "Failed: $FAILED"
