#!/bin/zsh
# Seeds realistic test data into all tables.
# Order matters: reference data first, then catalog, then inventory, then customers/subs,
# then plan assignments + balances. Diameter simulator populates usage separately.

cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")
SEED_IDS_FILE="$(dirname "$0")/../.seed-ids.json"
echo '{}' > "$SEED_IDS_FILE"

# ---------- helpers ----------

tid() { echo "$IDS_JSON" | jq -r --arg n "$1" '.[$n]'; }

# Look up column IDs for a table. Returns JSON map {colName: colId}
colmap() {
  local tname="$1"
  local t=$(tid "$tname")
  curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/app-builder/table/$t" \
    | jq '((.columnsMetaData // .data.columnsMetaData) // []) | map({(.name): .id}) | add'
}

# Insert a single record. Args: tablename, cells_json (using column NAMES as keys).
# Returns the record _id.
insert() {
  local tname="$1" cells_by_name="$2"
  local t=$(tid "$tname")
  local cm=$(colmap "$tname")
  # Translate cell NAMES to column IDs
  local cells_by_id=$(echo "$cells_by_name" | jq -c --argjson m "$cm" '
    to_entries | map(select(.key as $k | $m[$k]) | {key: $m[.key], value: .value}) | from_entries
  ')
  local body=$(jq -nc --argjson c "$cells_by_id" '{cells: $c}')
  local res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$t/record" -d "$body")
  # Rate limit retry
  local retry=0
  while [ "$(echo "$res" | jq -r '.status // 0' 2>/dev/null)" = "429" ] && [ $retry -lt 5 ]; do
    sleep 3; retry=$((retry+1))
    res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$t/record" -d "$body")
  done
  # Extract record ID. Response shapes we've seen:
  #   {success:true, id:"<uuid>", data:[{_id:"<recId>", cells:{...}}]}  — newer single/bulk
  #   {success:true, data:{_id:"<recId>", ...}}                          — older single
  local rid=$(echo "$res" | jq -r 'try .data[0]._id catch null // try .data._id catch null // ._id // empty' 2>/dev/null)
  if [ -z "$rid" ] || [ "$rid" = "null" ]; then
    local ok=$(echo "$res" | jq -r '.success // false' 2>/dev/null)
    if [ "$ok" = "true" ]; then
      # Record was created but we can't extract ID — use operation ID as placeholder
      rid=$(echo "$res" | jq -r '.id // empty' 2>/dev/null)
    fi
  fi
  if [ -z "$rid" ] || [ "$rid" = "null" ]; then
    echo "    FAIL $tname: $(echo "$res" | jq -c '.message // .error // .' 2>/dev/null | head -c 300)" >&2
    return 1
  fi
  echo "$rid"
  sleep 1.1
}

# Bulk insert. Args: tablename, records_json_array where each record has NAME keys.
bulk_insert() {
  local tname="$1" records="$2"
  local t=$(tid "$tname")
  local cm=$(colmap "$tname")
  local remapped=$(echo "$records" | jq -c --argjson m "$cm" '
    map({
      cells: (.cells | to_entries | map(select(.key as $k | $m[$k]) | {key: $m[.key], value: .value}) | from_entries)
    })
  ')
  local body=$(jq -nc --argjson arr "$remapped" '{arr: $arr}')
  local res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$t/record-bulk" -d "$body")
  local retry=0
  while [ "$(echo "$res" | jq -r '.status // 0' 2>/dev/null)" = "429" ] && [ $retry -lt 5 ]; do
    sleep 3; retry=$((retry+1))
    res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$t/record-bulk" -d "$body")
  done
  echo "$res"
  sleep 1.1
}

save_id() {
  local key="$1" val="$2"
  local current=$(cat "$SEED_IDS_FILE")
  echo "$current" | jq --arg k "$key" --arg v "$val" '.[$k] = $v' > "$SEED_IDS_FILE"
}

get_id() { cat "$SEED_IDS_FILE" | jq -r --arg k "$1" '.[$k] // empty'; }

NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

echo "=== Services (5) ==="
SVC_DATA=$(insert "Services" '{"Service Code":"DATA_GPRS","Service Name":"Mobile Data","Service Family":[1],"Default Rating Group":10,"Default Service Context":[1],"Unit Type":[1],"Description":"4G/5G mobile data"}')
save_id "svc_data" "$SVC_DATA"; echo "  Data: $SVC_DATA"
SVC_VONNET=$(insert "Services" '{"Service Code":"VOICE_ONNET","Service Name":"Voice On-net","Service Family":[2],"Default Rating Group":100,"Default Service Context":[2],"Unit Type":[2],"Description":"Calls within our network"}')
save_id "svc_vonnet" "$SVC_VONNET"; echo "  Voice On-net: $SVC_VONNET"
SVC_VOFFNET=$(insert "Services" '{"Service Code":"VOICE_OFFNET","Service Name":"Voice Off-net","Service Family":[2],"Default Rating Group":101,"Default Service Context":[2],"Unit Type":[2],"Description":"Calls to other operators"}')
save_id "svc_voffnet" "$SVC_VOFFNET"; echo "  Voice Off-net: $SVC_VOFFNET"
SVC_SMSDOM=$(insert "Services" '{"Service Code":"SMS_DOM","Service Name":"SMS Domestic","Service Family":[3],"Default Rating Group":200,"Default Service Context":[3],"Unit Type":[3],"Description":"Domestic SMS"}')
save_id "svc_smsdom" "$SVC_SMSDOM"; echo "  SMS Dom: $SVC_SMSDOM"
SVC_SMSINT=$(insert "Services" '{"Service Code":"SMS_INTL","Service Name":"SMS International","Service Family":[3],"Default Rating Group":201,"Default Service Context":[3],"Unit Type":[3],"Description":"International SMS"}')
save_id "svc_smsint" "$SVC_SMSINT"; echo "  SMS Intl: $SVC_SMSINT"

echo "=== Channels (5) ==="
CH_USSD=$(insert "Channels" '{"Channel Code":"USSD","Channel Name":"USSD Self-Care","Channel Type":[1],"Enabled":true}')
save_id "ch_ussd" "$CH_USSD"
CH_APP=$(insert "Channels" '{"Channel Code":"APP","Channel Name":"Mobile App","Channel Type":[4],"Enabled":true}')
save_id "ch_app" "$CH_APP"
CH_SMS=$(insert "Channels" '{"Channel Code":"SMS","Channel Name":"SMS","Channel Type":[2],"Enabled":true}')
save_id "ch_sms" "$CH_SMS"
CH_IVR=$(insert "Channels" '{"Channel Code":"IVR","Channel Name":"IVR","Channel Type":[3],"Enabled":true}')
save_id "ch_ivr" "$CH_IVR"
CH_RETAIL=$(insert "Channels" '{"Channel Code":"RETAIL","Channel Name":"Retail Shop","Channel Type":[6],"Enabled":true}')
save_id "ch_retail" "$CH_RETAIL"
echo "  Channels: 5"

echo "=== Tax Rates (2) ==="
insert "Tax Rates" '{"Tax Code":"VAT_IN","Tax Name":"Indian GST","Rate Percent":18,"Applies To":[4],"Region":"IN"}' >/dev/null && echo "  VAT 18%"
insert "Tax Rates" '{"Tax Code":"VAT_US","Tax Name":"US Sales Tax","Rate Percent":8,"Applies To":[4],"Region":"US"}' >/dev/null && echo "  VAT 8%"

echo "=== Network Elements (6) ==="
insert "Network Elements" '{"Element Code":"PGW-01","Element Type":[1],"FQDN":"pgw01.op.com","IP Address":"10.1.1.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
insert "Network Elements" '{"Element Code":"SMSC-01","Element Type":[3],"FQDN":"smsc01.op.com","IP Address":"10.1.2.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
insert "Network Elements" '{"Element Code":"MSC-01","Element Type":[4],"FQDN":"msc01.op.com","IP Address":"10.1.3.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
insert "Network Elements" '{"Element Code":"HSS-01","Element Type":[6],"FQDN":"hss01.op.com","IP Address":"10.1.4.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
insert "Network Elements" '{"Element Code":"PCF-01","Element Type":[8],"FQDN":"pcf01.op.com","IP Address":"10.1.5.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
insert "Network Elements" '{"Element Code":"SMF-01","Element Type":[9],"FQDN":"smf01.op.com","IP Address":"10.1.6.10","Diameter Realm":"op.com","Region":"North","Status":[1]}' >/dev/null
echo "  Network Elements: 6"

echo "=== Notification Templates (5) ==="
insert "Notification Templates" '{"Template Code":"WELCOME_SMS","Template Name":"Welcome SMS","Trigger Event":[8],"Channel Type":[1],"Body":"Welcome to our network, {name}! Your MSISDN {msisdn} is active. Dial *123# to check balance.","Variables":"name,msisdn","Language":[1],"Enabled":true}' >/dev/null
insert "Notification Templates" '{"Template Code":"LOW_BAL_20","Template Name":"Low Balance 20%","Trigger Event":[1],"Channel Type":[1],"Body":"Your plan is 80% used. Remaining: {remaining} {unit}. Top-up via *123# to continue.","Variables":"remaining,unit","Language":[1],"Enabled":true}' >/dev/null
insert "Notification Templates" '{"Template Code":"RECHARGE_OK","Template Name":"Recharge Success","Trigger Event":[3],"Channel Type":[1],"Body":"Recharge of {amount} successful. New balance: {balance}. Thank you!","Variables":"amount,balance","Language":[1],"Enabled":true}' >/dev/null
insert "Notification Templates" '{"Template Code":"PLAN_ACTIVATED","Template Name":"Plan Activated","Trigger Event":[4],"Channel Type":[1],"Body":"Your plan {plan_name} is active. Valid till {expiry}. Enjoy!","Variables":"plan_name,expiry","Language":[1],"Enabled":true}' >/dev/null
insert "Notification Templates" '{"Template Code":"PLAN_DEPLETED","Template Name":"Plan Depleted","Trigger Event":[6],"Channel Type":[1],"Body":"Your {bucket} is fully consumed. Reload via *123# or dial 121 for options.","Variables":"bucket","Language":[1],"Enabled":true}' >/dev/null
echo "  Templates: 5"

echo "=== Distribution Partners (3) ==="
P1=$(insert "Distribution Partners" '{"Partner Code":"PTR-0001","Partner Name":"City Mobile Shop","Partner Type":[1],"Tier":[1],"Region":"North","Contact Person":"Rajesh Kumar","Contact Phone":"919999111100","Contact Email":"rajesh@citymobile.com","Status":[3],"Onboarded Date":"2024-01-15","Wallet Balance":5000}')
save_id "p1" "$P1"
P2=$(insert "Distribution Partners" '{"Partner Code":"PTR-0002","Partner Name":"QuickRecharge Super Dealer","Partner Type":[2],"Tier":[1],"Region":"South","Contact Person":"Anita Singh","Contact Phone":"919999222200","Contact Email":"anita@quickrecharge.com","Status":[3],"Onboarded Date":"2023-08-20","Wallet Balance":25000}')
save_id "p2" "$P2"
P3=$(insert "Distribution Partners" '{"Partner Code":"PTR-0003","Partner Name":"PayApp Digital Channel","Partner Type":[3],"Tier":[2],"Region":"National","Contact Person":"Vikram Desai","Contact Phone":"919999333300","Contact Email":"vikram@payapp.com","Status":[3],"Onboarded Date":"2024-06-01","Wallet Balance":50000}')
save_id "p3" "$P3"
echo "  Partners: 3"

echo "=== Product Offerings (3) ==="
OFF_STARTER=$(insert "Product Offerings" '{"Offering Code":"OFF-STARTER","Offering Name":"Starter 2GB","Description":"2GB data + 100 min voice + 50 SMS for 28 days","Offering Type":[1],"Base Price":5,"Validity Days":28,"Grace Period Days":3,"Status":[2],"Renewal Type":[3],"Launch Date":"2024-01-01"}')
save_id "off_starter" "$OFF_STARTER"
OFF_ULT=$(insert "Product Offerings" '{"Offering Code":"OFF-ULT10","Offering Name":"Ultimate 10GB","Description":"10GB data + 300 min voice + 100 SMS for 30 days","Offering Type":[1],"Base Price":15,"Validity Days":30,"Grace Period Days":3,"Status":[2],"Renewal Type":[3],"Launch Date":"2024-01-01"}')
save_id "off_ult" "$OFF_ULT"
OFF_UNL=$(insert "Product Offerings" '{"Offering Code":"OFF-UNL","Offering Name":"Unlimited Monthly","Description":"Unlimited data (FUP 50GB) + unlimited on-net voice + 300 SMS for 30 days","Offering Type":[1],"Base Price":30,"Validity Days":30,"Grace Period Days":3,"Status":[2],"Renewal Type":[3],"Launch Date":"2024-01-01"}')
save_id "off_unl" "$OFF_UNL"
echo "  Offerings: 3"

echo "=== Tariff Plans (3) ==="
# Column mapping: Product Offering, Plan Code, Plan Name, Price, Currency[USD=1], Plan Type[Monthly=3], Validity Days, Status[Active=2]
TP_STARTER=$(insert "Tariff Plans" "{\"Product Offering\":[\"$OFF_STARTER\"],\"Plan Code\":\"TP-STARTER\",\"Plan Name\":\"Starter 2GB Pack\",\"Price\":5,\"Currency\":[1],\"Plan Type\":[3],\"Validity Days\":28,\"Priority On Charge\":10,\"Region\":\"Global\",\"Status\":[2]}")
save_id "tp_starter" "$TP_STARTER"
TP_ULT=$(insert "Tariff Plans" "{\"Product Offering\":[\"$OFF_ULT\"],\"Plan Code\":\"TP-ULT10\",\"Plan Name\":\"Ultimate 10GB Pack\",\"Price\":15,\"Currency\":[1],\"Plan Type\":[3],\"Validity Days\":30,\"Priority On Charge\":10,\"Region\":\"Global\",\"Status\":[2]}")
save_id "tp_ult" "$TP_ULT"
TP_UNL=$(insert "Tariff Plans" "{\"Product Offering\":[\"$OFF_UNL\"],\"Plan Code\":\"TP-UNL\",\"Plan Name\":\"Unlimited Monthly Pack\",\"Price\":30,\"Currency\":[1],\"Plan Type\":[3],\"Validity Days\":30,\"Priority On Charge\":10,\"Region\":\"Global\",\"Status\":[2]}")
save_id "tp_unl" "$TP_UNL"
echo "  Tariff Plans: 3"

echo "=== Plan Allowances (9 — 3 per plan) ==="
# Starter: 2GB data, 100 min voice on-net, 50 SMS
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_STARTER\"],\"Service\":[\"$SVC_DATA\"],\"Rating Group\":10,\"Service Context\":[1],\"Allowance Label\":\"Starter 2GB Data\",\"Unit Type\":[1],\"Initial Amount\":2048,\"Overage Action\":[1],\"Priority\":1}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_STARTER\"],\"Service\":[\"$SVC_VONNET\"],\"Rating Group\":100,\"Service Context\":[2],\"Allowance Label\":\"Starter 100 min Voice\",\"Unit Type\":[2],\"Initial Amount\":100,\"Overage Action\":[2],\"Overage Rate\":0.05,\"Priority\":2}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_STARTER\"],\"Service\":[\"$SVC_SMSDOM\"],\"Rating Group\":200,\"Service Context\":[3],\"Allowance Label\":\"Starter 50 SMS\",\"Unit Type\":[3],\"Initial Amount\":50,\"Overage Action\":[2],\"Overage Rate\":0.02,\"Priority\":3}" >/dev/null

# Ultimate 10GB: 10GB data, 300 min voice (combined on/off-net), 100 SMS
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_ULT\"],\"Service\":[\"$SVC_DATA\"],\"Rating Group\":10,\"Service Context\":[1],\"Allowance Label\":\"Ultimate 10GB Data\",\"Unit Type\":[1],\"Initial Amount\":10240,\"Overage Action\":[2],\"Overage Rate\":0.001,\"Priority\":1}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_ULT\"],\"Service\":[\"$SVC_VONNET\"],\"Rating Group\":100,\"Service Context\":[2],\"Allowance Label\":\"Ultimate 300 min Voice\",\"Unit Type\":[2],\"Initial Amount\":300,\"Overage Action\":[2],\"Overage Rate\":0.03,\"Priority\":2}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_ULT\"],\"Service\":[\"$SVC_SMSDOM\"],\"Rating Group\":200,\"Service Context\":[3],\"Allowance Label\":\"Ultimate 100 SMS\",\"Unit Type\":[3],\"Initial Amount\":100,\"Overage Action\":[2],\"Overage Rate\":0.01,\"Priority\":3}" >/dev/null

# Unlimited: 50GB FUP data, unlimited on-net voice (encoded as 999999), 300 SMS
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_UNL\"],\"Service\":[\"$SVC_DATA\"],\"Rating Group\":10,\"Service Context\":[1],\"Allowance Label\":\"Unlimited 50GB FUP\",\"Unit Type\":[1],\"Initial Amount\":51200,\"Overage Action\":[3],\"Priority\":1}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_UNL\"],\"Service\":[\"$SVC_VONNET\"],\"Rating Group\":100,\"Service Context\":[2],\"Allowance Label\":\"Unlimited On-net Voice\",\"Unit Type\":[2],\"Initial Amount\":999999,\"Overage Action\":[3],\"Priority\":2}" >/dev/null
insert "Plan Allowances" "{\"Tariff Plan\":[\"$TP_UNL\"],\"Service\":[\"$SVC_SMSDOM\"],\"Rating Group\":200,\"Service Context\":[3],\"Allowance Label\":\"Unlimited 300 SMS\",\"Unit Type\":[3],\"Initial Amount\":300,\"Overage Action\":[2],\"Overage Rate\":0.01,\"Priority\":3}" >/dev/null
echo "  Plan Allowances: 9"

echo "=== Rate Cards (5 PAYG) ==="
insert "Rate Cards" "{\"Rate Card Code\":\"RC-DATA-PAYG\",\"Tariff Plan\":[\"$TP_STARTER\"],\"Rating Group\":10,\"Service Context\":[1],\"Unit Type\":[1],\"Price Per Unit\":0.002,\"Peak Off Peak\":[1],\"Effective From\":\"2024-01-01\"}" >/dev/null
insert "Rate Cards" "{\"Rate Card Code\":\"RC-VOICE-ONNET\",\"Tariff Plan\":[\"$TP_STARTER\"],\"Rating Group\":100,\"Service Context\":[2],\"Unit Type\":[2],\"Price Per Unit\":0.05,\"Peak Off Peak\":[1],\"Effective From\":\"2024-01-01\"}" >/dev/null
insert "Rate Cards" "{\"Rate Card Code\":\"RC-VOICE-OFFNET\",\"Tariff Plan\":[\"$TP_STARTER\"],\"Rating Group\":101,\"Service Context\":[2],\"Unit Type\":[2],\"Price Per Unit\":0.08,\"Peak Off Peak\":[1],\"Effective From\":\"2024-01-01\"}" >/dev/null
insert "Rate Cards" "{\"Rate Card Code\":\"RC-SMS-DOM\",\"Tariff Plan\":[\"$TP_STARTER\"],\"Rating Group\":200,\"Service Context\":[3],\"Unit Type\":[3],\"Price Per Unit\":0.02,\"Peak Off Peak\":[1],\"Effective From\":\"2024-01-01\"}" >/dev/null
insert "Rate Cards" "{\"Rate Card Code\":\"RC-SMS-INTL\",\"Tariff Plan\":[\"$TP_STARTER\"],\"Rating Group\":201,\"Service Context\":[3],\"Unit Type\":[3],\"Price Per Unit\":0.15,\"Peak Off Peak\":[1],\"Effective From\":\"2024-01-01\"}" >/dev/null
echo "  Rate Cards: 5"

echo "=== Recharge Vouchers (30 mixed) ==="
for i in {1..10}; do
  insert "Recharge Vouchers" "{\"Voucher Serial\":\"V5-$(printf '%06d' $i)\",\"PIN\":\"$(printf '%08d' $((RANDOM*10+i)))\",\"Denomination\":5,\"Currency\":[1],\"Batch ID\":\"BATCH-001\",\"Status\":[2],\"Expiry Date\":\"2027-12-31\"}" >/dev/null
done
for i in {1..10}; do
  insert "Recharge Vouchers" "{\"Voucher Serial\":\"V10-$(printf '%06d' $i)\",\"PIN\":\"$(printf '%08d' $((RANDOM*10+i)))\",\"Denomination\":10,\"Currency\":[1],\"Batch ID\":\"BATCH-002\",\"Status\":[2],\"Expiry Date\":\"2027-12-31\"}" >/dev/null
done
for i in {1..10}; do
  insert "Recharge Vouchers" "{\"Voucher Serial\":\"V20-$(printf '%06d' $i)\",\"PIN\":\"$(printf '%08d' $((RANDOM*10+i)))\",\"Denomination\":20,\"Currency\":[1],\"Batch ID\":\"BATCH-003\",\"Status\":[2],\"Expiry Date\":\"2027-12-31\"}" >/dev/null
done
echo "  Vouchers: 30"

echo "=== Customers (20) ==="
# Save customer IDs into a bash array for later use
CUST_IDS=()
NAMES=("Amit Sharma" "Priya Patel" "Ravi Kumar" "Sneha Gupta" "Arjun Reddy" "Neha Iyer" "Karthik Menon" "Anjali Singh" "Rohit Verma" "Deepika Rao" \
       "Vijay Nair" "Kavya Pillai" "Suresh Bhat" "Meera Desai" "Ajay Saxena" "Pooja Joshi" "Nikhil Agarwal" "Shruti Bansal" "Harsh Chopra" "Riya Kapoor")
for i in {1..20}; do
  name="${NAMES[$i]}"
  phone="919812$(printf '%06d' $i)"
  email=$(echo "${name:l}" | tr ' ' '.').com
  email="${email// /}@example.com"
  type_idx=1  # Individual
  segment_idx=$((RANDOM % 3 + 1))  # mix
  lang_idx=$((RANDOM % 2 + 1))
  cust=$(insert "Customers" "{\"Name\":\"$name\",\"Email\":\"${name:l}@example.com\",\"Phone\":\"$phone\",\"Customer Type\":[$type_idx],\"Segment\":[$segment_idx],\"Status\":[1],\"Language\":[$lang_idx],\"KYC Status\":[3],\"Onboarded Date\":\"2024-$(printf '%02d' $((RANDOM % 12 + 1)))-$(printf '%02d' $((RANDOM % 28 + 1)))\"}")
  CUST_IDS+=("$cust")
done
save_id "customers" "$(printf '%s\n' "${CUST_IDS[@]}" | jq -R . | jq -sc .)"
echo "  Customers: ${#CUST_IDS[@]}"

echo "=== Subscriptions (25 — some customers get 2 SIMs) ==="
SUB_IDS=()
sub_num=0
for cust in "${CUST_IDS[@]}"; do
  # First subscription for every customer
  sub_num=$((sub_num + 1))
  msisdn="91981${NOW:2:1}$(printf '%06d' $sub_num)"
  imsi="40468$(printf '%010d' $sub_num)"
  iccid="8991012$(printf '%011d' $sub_num)"
  sub=$(insert "Subscriptions" "{\"Customer\":[\"$cust\"],\"MSISDN\":\"$msisdn\",\"IMSI\":\"$imsi\",\"ICCID\":\"$iccid\",\"APN\":\"internet\",\"Subscription Type\":[3],\"Status\":[1],\"Activation Date\":\"2024-$(printf '%02d' $((RANDOM % 12 + 1)))-$(printf '%02d' $((RANDOM % 28 + 1)))\",\"Home Network\":\"OP\",\"Roaming Enabled\":\"__NO__\"}")
  SUB_IDS+=("$sub")

  # 25% of customers get a second SIM
  if [ $((RANDOM % 4)) -eq 0 ] && [ ${#SUB_IDS[@]} -lt 25 ]; then
    sub_num=$((sub_num + 1))
    msisdn="91982${NOW:2:1}$(printf '%06d' $sub_num)"
    imsi="40468$(printf '%010d' $sub_num)"
    iccid="8991012$(printf '%011d' $sub_num)"
    sub=$(insert "Subscriptions" "{\"Customer\":[\"$cust\"],\"MSISDN\":\"$msisdn\",\"IMSI\":\"$imsi\",\"ICCID\":\"$iccid\",\"APN\":\"internet\",\"Subscription Type\":[3],\"Status\":[1],\"Activation Date\":\"2024-$(printf '%02d' $((RANDOM % 12 + 1)))-$(printf '%02d' $((RANDOM % 28 + 1)))\",\"Home Network\":\"OP\",\"Roaming Enabled\":\"__NO__\"}")
    SUB_IDS+=("$sub")
  fi
done
save_id "subscriptions" "$(printf '%s\n' "${SUB_IDS[@]}" | jq -R . | jq -sc .)"
echo "  Subscriptions: ${#SUB_IDS[@]}"

echo "=== Wallets (20 — one per customer) ==="
WALLET_IDS=()
for i in {1..20}; do
  cust="${CUST_IDS[$i]}"
  wcode="WLT-$(printf '%06d' $i)"
  starting_balance=$((RANDOM % 50 + 10))  # $10-$60
  wid=$(insert "Wallets" "{\"Customer\":[\"$cust\"],\"Wallet Code\":\"$wcode\",\"Currency\":[1],\"Current Balance\":$starting_balance,\"Lifetime Recharge\":$starting_balance,\"Lifetime Spend\":0,\"Last Recharge Date\":\"$NOW\",\"Status\":[1]}")
  WALLET_IDS+=("$wid")
done
save_id "wallets" "$(printf '%s\n' "${WALLET_IDS[@]}" | jq -R . | jq -sc .)"
echo "  Wallets: ${#WALLET_IDS[@]}"

echo "=== Subscription Plan Assignments (one per subscription) ==="
# Distribute plans: 30% Starter, 50% Ultimate, 20% Unlimited
SPA_IDS=()
TARIFF_USED=()
IDX=0
for sub in "${SUB_IDS[@]}"; do
  IDX=$((IDX+1))
  mod=$((IDX % 10))
  if [ $mod -lt 3 ]; then
    tp="$TP_STARTER"; price=5; valid=28
  elif [ $mod -lt 8 ]; then
    tp="$TP_ULT"; price=15; valid=30
  else
    tp="$TP_UNL"; price=30; valid=30
  fi
  TARIFF_USED+=("$tp")
  eff="2026-04-01"
  spa=$(insert "Subscription Plan Assignments" "{\"Subscription\":[\"$sub\"],\"Tariff Plan\":[\"$tp\"],\"Effective From\":\"$eff\",\"Activation Source\":[1],\"Renewal Count\":0,\"Status\":[1],\"Price Paid\":$price}")
  SPA_IDS+=("$spa")
done
save_id "plan_assignments" "$(printf '%s\n' "${SPA_IDS[@]}" | jq -R . | jq -sc .)"
save_id "tariff_per_sub" "$(printf '%s\n' "${TARIFF_USED[@]}" | jq -R . | jq -sc .)"
echo "  Plan Assignments: ${#SPA_IDS[@]}"

echo "=== Balances (3 per subscription: data, voice, SMS) ==="
BAL_COUNT=0
for i in {1..25}; do
  sub="${SUB_IDS[$i]}"
  spa="${SPA_IDS[$i]}"
  tp="${TARIFF_USED[$i]}"
  # Determine initial amounts based on tariff
  if [ "$tp" = "$TP_STARTER" ]; then
    data_init=2048; voice_init=100; sms_init=50
  elif [ "$tp" = "$TP_ULT" ]; then
    data_init=10240; voice_init=300; sms_init=100
  else
    data_init=51200; voice_init=999999; sms_init=300
  fi
  # Data balance
  insert "Balances" "{\"Subscription\":[\"$sub\"],\"Subscription Plan Assignment\":[\"$spa\"],\"Balance Code\":\"BAL-${i}-DATA\",\"Rating Group\":10,\"Service Context\":[1],\"Allowance Label\":\"Data\",\"Unit Type\":[1],\"Initial Amount\":$data_init,\"Used Amount\":0,\"Remaining Amount\":$data_init,\"Cycle Start\":\"2026-04-01\",\"Cycle End\":\"2026-05-01\",\"Status\":[1]}" >/dev/null
  insert "Balances" "{\"Subscription\":[\"$sub\"],\"Subscription Plan Assignment\":[\"$spa\"],\"Balance Code\":\"BAL-${i}-VOICE\",\"Rating Group\":100,\"Service Context\":[2],\"Allowance Label\":\"Voice On-net\",\"Unit Type\":[2],\"Initial Amount\":$voice_init,\"Used Amount\":0,\"Remaining Amount\":$voice_init,\"Cycle Start\":\"2026-04-01\",\"Cycle End\":\"2026-05-01\",\"Status\":[1]}" >/dev/null
  insert "Balances" "{\"Subscription\":[\"$sub\"],\"Subscription Plan Assignment\":[\"$spa\"],\"Balance Code\":\"BAL-${i}-SMS\",\"Rating Group\":200,\"Service Context\":[3],\"Allowance Label\":\"SMS Domestic\",\"Unit Type\":[3],\"Initial Amount\":$sms_init,\"Used Amount\":0,\"Remaining Amount\":$sms_init,\"Cycle Start\":\"2026-04-01\",\"Cycle End\":\"2026-05-01\",\"Status\":[1]}" >/dev/null
  BAL_COUNT=$((BAL_COUNT + 3))
done
echo "  Balances: $BAL_COUNT"

echo ""
echo "=== Seed complete ==="
cat "$SEED_IDS_FILE" | jq '. | keys'
