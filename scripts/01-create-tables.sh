#!/bin/zsh
# Creates all 38 tables in the telecom app.
# Writes resulting IDs to .table-ids.json as { "TableName": "id", ... }.
# Idempotent-ish: if a table with the same name exists, we skip creation and reuse its ID.

set -e
cd "$(dirname "$0")"
source ./env.sh

# Fetch existing tables to avoid duplicates
EXISTING=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/v1/app-builder/table?appId=$APP_ID&pageSize=200")

typeset -A TABLE_IDS

# Pre-populate with existing tables
while IFS=$'\t' read -r name id; do
  [ -n "$name" ] && TABLE_IDS[$name]="$id"
done < <(echo "$EXISTING" | jq -r '.data[] | [.name, ._id] | @tsv')

create_table() {
  local name="$1"
  local desc="$2"
  local icon="$3"
  local category="$4"
  local id_col_name="$5"
  local id_col_code="$6"

  if [ -n "${TABLE_IDS[$name]:-}" ]; then
    echo "  (exists) $name → ${TABLE_IDS[$name]}"
    return
  fi

  local body
  body=$(jq -n --arg name "$name" --arg appId "$APP_ID" --arg desc "$desc" \
    --arg icon "$icon" --arg category "$category" \
    --arg idColName "$id_col_name" --arg idColCode "$id_col_code" '{
      name: $name, appId: $appId, description: $desc, icon: $icon, category: $category,
      idColumn: { name: $idColName, columnCode: $idColCode }
    }')

  local res
  res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table" -d "$body")
  local tid
  tid=$(echo "$res" | jq -r '.data._id // .id // ._id // empty')
  if [ -z "$tid" ]; then
    echo "  FAILED: $name"
    echo "$res" | jq '.'
    exit 1
  fi
  TABLE_IDS[$name]="$tid"
  echo "  created: $name → $tid"
}

echo "=== Category 1: Customers ==="
create_table "Customers"                    "Master customer records"                                 "Users"       "Customers"               "Customer ID"       "CUST"
create_table "Customer Identifications"     "KYC documents per customer"                              "Shield"      "Customers"               "ID Record"         "CID"
create_table "Customer Lifecycle Events"    "Audit log of customer state transitions"                 "Clock"       "Customers"               "Event"             "CLE"
create_table "Account Hierarchy"            "Parent-child links (family/corporate)"                   "GitBranch"   "Customers"               "Link"              "HIER"

echo "=== Category 2: Subscribers & Resources ==="
create_table "Subscriptions"                "SIM/MSISDN records owned by a customer"                  "Phone"       "Subscribers"             "Subscription"      "SUB"
create_table "Subscription Status History"  "Audit of subscription state changes"                     "FileClock"   "Subscribers"             "History"           "SSH"
create_table "MSISDN Pool"                  "Inventory of phone numbers"                              "Hash"        "Subscribers"             "Number"            "NUM"
create_table "SIM Inventory"                "Physical SIM cards pre-assignment"                       "CreditCard"  "Subscribers"             "SIM"               "SIM"

echo "=== Category 3: Product Catalog ==="
create_table "Services"                     "Technical services (data, voice, SMS)"                   "Layers"      "Product Catalog"         "Service"           "SVC"
create_table "Product Offerings"            "Customer-facing plans"                                   "Package"     "Product Catalog"         "Offering"          "OFF"
create_table "Bundles"                      "Named combinations of offerings"                         "Boxes"       "Product Catalog"         "Bundle"            "BND"
create_table "Bundle Components"            "Offerings within a bundle"                               "List"        "Product Catalog"         "Component"         "BCP"

echo "=== Category 4: Tariff & Rating ==="
create_table "Tariff Plans"                 "Buyable tariff plans with price"                         "Tag"         "Tariff & Rating"         "Tariff"            "TAR"
create_table "Plan Allowances"              "Allowance per rating group per plan"                     "Gauge"       "Tariff & Rating"         "Allowance"         "ALW"
create_table "Rate Cards"                   "PAYG pricing when allowance=0"                           "DollarSign"  "Tariff & Rating"         "Rate"              "RTE"
create_table "Tax Rates"                    "VAT/GST per region"                                      "Percent"     "Tariff & Rating"         "Tax"               "TAX"

echo "=== Category 5: Plan Assignment & Bonuses ==="
create_table "Subscription Plan Assignments" "Current and historical plan assignments per subscription" "CalendarCheck" "Plans & Bonuses"     "Assignment"        "ASN"
create_table "Bonus Grants"                 "Ad-hoc free allowance grants"                            "Gift"        "Plans & Bonuses"         "Bonus"             "BON"

echo "=== Category 6: Wallet & Recharge ==="
create_table "Wallets"                      "Monetary balance per customer"                           "Wallet"      "Wallet & Recharge"       "Wallet"            "WLT"
create_table "Wallet Transactions"          "Audit log of wallet credits/debits"                      "ArrowUpDown" "Wallet & Recharge"       "Transaction"       "WTX"
create_table "Recharges"                    "Top-up events"                                           "Zap"         "Wallet & Recharge"       "Recharge"          "RCG"
create_table "Recharge Vouchers"            "Voucher inventory (PIN-based)"                           "Ticket"      "Wallet & Recharge"       "Voucher"           "VCR"
create_table "Balance Transfers"            "P2P gifting between subscriptions"                       "Send"        "Wallet & Recharge"       "Transfer"          "XFR"

echo "=== Category 7: Charging & Usage ==="
create_table "Charging Sessions"            "One per Diameter Session-Id"                             "Activity"    "Charging & Usage"        "Session"           "SES"
create_table "Usage Transactions"           "Each CCR message (Diameter event)"                       "Radio"       "Charging & Usage"        "Transaction"       "TXN"
create_table "Call Detail Records"          "Post-session flattened records"                          "FileText"    "Charging & Usage"        "CDR"               "CDR"
create_table "Balances"                     "Live remaining allowance per subscription×rating-group"  "Battery"     "Charging & Usage"        "Balance"           "BAL"

echo "=== Category 8: Promotions & Supplementary ==="
create_table "Promotions"                   "Campaign offers"                                         "Sparkles"    "Promotions & Supplementary" "Promo"          "PRO"
create_table "Promotion Redemptions"        "Who redeemed what"                                       "Award"       "Promotions & Supplementary" "Redemption"     "RED"
create_table "Friends and Family Groups"    "Per-subscription F&F circles"                            "Heart"       "Promotions & Supplementary" "FF Group"       "FFG"
create_table "FF Members"                   "Members of F&F groups"                                   "UserPlus"    "Promotions & Supplementary" "Member"         "FFM"
create_table "Closed User Groups"           "Corporate/community groups"                              "UsersRound"  "Promotions & Supplementary" "CUG"            "CUG"
create_table "CUG Members"                  "Members of Closed User Groups"                           "UserPlus"    "Promotions & Supplementary" "Member"         "CGM"

echo "=== Category 9: Partners ==="
create_table "Distribution Partners"        "Retail shops, dealers, app agents"                       "Store"       "Partners"                "Partner"           "PTR"
create_table "Partner Commissions"          "Per-recharge earnings"                                   "TrendingUp"  "Partners"                "Commission"        "COM"
create_table "Partner Contracts"            "Partner onboarding docs and SLAs"                        "FileSignature" "Partners"              "Contract"          "PCT"

echo "=== Category 10: Channels, Orders, Cases ==="
create_table "Channels"                     "Registry of customer interaction channels"               "Router"      "Channels & Orders"       "Channel"           "CHN"
create_table "Customer Interactions"        "Unified touch log across channels"                       "MessageCircle" "Channels & Orders"     "Interaction"       "INT"
create_table "Orders"                       "Orders (SIM, plan purchase, recharge)"                   "ShoppingCart" "Channels & Orders"      "Order"             "ORD"
create_table "Order Items"                  "Line items on orders"                                    "ListOrdered" "Channels & Orders"       "Item"              "ORI"
create_table "Cases"                        "Support tickets"                                         "Ticket"      "Channels & Orders"       "Case"              "CAS"

echo "=== Category 11: Platform ==="
create_table "Notification Templates"       "SMS/push/email templates"                                "BellRing"    "Platform"                "Template"          "TPL"
create_table "Notifications Sent"           "Notification delivery audit"                             "Bell"        "Platform"                "Notification"      "NOT"
create_table "Business Rules"               "Policy/rule engine config"                               "Settings2"   "Platform"                "Rule"              "RUL"
create_table "Audit Log"                    "System-wide event log"                                   "ScrollText"  "Platform"                "Entry"             "AUD"
create_table "Network Elements"             "PGW/MSC/SMSC/NF registry"                                "Network"     "Platform"                "Element"           "NE"

echo ""
echo "=== Summary ==="
echo "${#TABLE_IDS[@]} tables in map"

# Write IDs to JSON file
{
  echo '{'
  first=1
  for name in ${(k)TABLE_IDS}; do
    if [ $first -eq 1 ]; then first=0; else echo ','; fi
    printf '  %s: %s' "$(echo -n "$name" | jq -Rsa .)" "$(echo -n "${TABLE_IDS[$name]}" | jq -Rsa .)"
  done
  echo ''
  echo '}'
} > "$IDS_FILE"

echo "Wrote IDs to $IDS_FILE"
cat "$IDS_FILE" | jq '. | length as $n | "\($n) tables mapped"'
