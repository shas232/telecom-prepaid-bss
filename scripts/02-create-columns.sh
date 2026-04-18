#!/bin/zsh
# Bulk-creates all non-reference columns across all tables.
# Reference columns are created separately in 03-create-references.sh.

set -e
cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")
FAILED=()

add_cols() {
  local table_name="$1"
  local arr_json="$2"
  local tid
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$table_name" '.[$n] // empty')
  if [ -z "$tid" ]; then
    echo "  SKIP $table_name (no id)"; return
  fi

  # Idempotency: skip if table already has non-system columns beyond idColumn
  local existing
  existing=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/v1/app-builder/table/$tid" \
    | jq -r '[.data.columnsMetaData[]? | select(.id != "ID" and .id != "CTDT" and .id != "UTDT" and .id != "CTBY" and .id != "UTBY")] | length')
  if [ "${existing:-0}" -gt 1 ]; then
    echo "  (has cols) $table_name — skipping"
    return
  fi
  # Normalize column definitions:
  #  - Remap legacy types (checkbox→boolean, multi_select→multi-select, rating→number, text+subType→proper type)
  #  - Add sequential IDs to select/multi-select options
  local fixed
  fixed=$(echo "$arr_json" | jq -c '
    [.[]
     | if .type == "checkbox" then .type = "boolean" else . end
     | if .type == "multi_select" then .type = "multi-select" else . end
     | if .type == "rating" then .type = "number" | .tooltip = ((.tooltip // "") + " (0-5 rating)") else . end
     | if .type == "text" and .subType == "email" then .type = "email" | del(.subType) else . end
     | if .type == "text" and .subType == "phone" then .type = "phone" | del(.subType) else . end
     | if .type == "text" and .subType == "url"   then .type = "url"   | del(.subType) else . end
     | if .options then .options = [.options | to_entries[] | {id: (.key+1), name: .value.name}] else . end
    ]')
  local body
  body=$(jq -nc --argjson arr "$fixed" '{columns: $arr}')
  local res
  res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "$BASE_URL/v1/app-builder/table/$tid/column/bulk" -d "$body")
  # Handle rate limit
  local retry=0
  while [ "$(echo "$res" | jq -r '.status // 0')" = "429" ] && [ $retry -lt 5 ]; do
    sleep 2
    retry=$((retry+1))
    res=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      "$BASE_URL/v1/app-builder/table/$tid/column/bulk" -d "$body")
  done
  local ok
  ok=$(echo "$res" | jq -r '.success // false')
  if [ "$ok" = "true" ]; then
    local cnt
    cnt=$(echo "$arr_json" | jq 'length')
    echo "  ✓ $table_name ($cnt cols)"
  else
    echo "  ✗ $table_name"
    echo "$res" | jq '.' | head -20
    FAILED+=("$table_name")
  fi
  sleep 1.1  # rate limit: 60 req/min
}

echo "=== Category 1: Customers ==="

add_cols "Customers" '[
  {"name":"Name","type":"text","required":true},
  {"name":"Email","type":"text","subType":"email"},
  {"name":"Phone","type":"text","subType":"phone"},
  {"name":"Address","type":"long_text"},
  {"name":"Customer Type","type":"select","options":[{"name":"Individual"},{"name":"Corporate"},{"name":"Family"}]},
  {"name":"Segment","type":"select","options":[{"name":"Prepaid Consumer"},{"name":"Prepaid Business"},{"name":"Student"},{"name":"Senior"},{"name":"Youth"}]},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Suspended"},{"name":"Churned"},{"name":"Pending KYC"}]},
  {"name":"Language","type":"select","options":[{"name":"English"},{"name":"Hindi"},{"name":"Spanish"},{"name":"French"},{"name":"Arabic"}]},
  {"name":"KYC Status","type":"select","options":[{"name":"Unverified"},{"name":"In Progress"},{"name":"Verified"},{"name":"Rejected"}]},
  {"name":"Onboarded Date","type":"date"},
  {"name":"Churn Date","type":"date"},
  {"name":"Lifetime Value","type":"number","currency":true}
]'

add_cols "Customer Identifications" '[
  {"name":"ID Type","type":"select","required":true,"options":[{"name":"Passport"},{"name":"National ID"},{"name":"Driver License"},{"name":"Voter ID"},{"name":"Aadhaar"}]},
  {"name":"ID Number","type":"text","required":true},
  {"name":"Issuing Authority","type":"text"},
  {"name":"Issue Date","type":"date"},
  {"name":"Expiry Date","type":"date"},
  {"name":"Verified","type":"checkbox"},
  {"name":"Verification Date","type":"date"},
  {"name":"Scan URL","type":"text","subType":"url"},
  {"name":"Notes","type":"long_text"}
]'

add_cols "Customer Lifecycle Events" '[
  {"name":"Event Type","type":"select","required":true,"options":[{"name":"Activated"},{"name":"Suspended"},{"name":"Reactivated"},{"name":"Churned"},{"name":"Reinstated"},{"name":"Merged"},{"name":"KYC Updated"}]},
  {"name":"Event Date","type":"date","required":true},
  {"name":"Reason","type":"text"},
  {"name":"Triggered By","type":"select","options":[{"name":"System"},{"name":"CSR"},{"name":"Customer"},{"name":"Fraud Rule"},{"name":"Regulator"}]},
  {"name":"Previous Status","type":"text"},
  {"name":"New Status","type":"text"},
  {"name":"Notes","type":"long_text"}
]'

add_cols "Account Hierarchy" '[
  {"name":"Relationship Type","type":"select","required":true,"options":[{"name":"Family Head"},{"name":"Family Member"},{"name":"Corporate Master"},{"name":"Corporate Employee"}]},
  {"name":"Billing Responsibility","type":"select","options":[{"name":"Parent Pays"},{"name":"Child Pays"},{"name":"Split"}]},
  {"name":"Effective From","type":"date"},
  {"name":"Effective To","type":"date"},
  {"name":"Notes","type":"long_text"}
]'

echo "=== Category 2: Subscribers & Resources ==="

add_cols "Subscriptions" '[
  {"name":"MSISDN","type":"text","required":true,"tooltip":"Phone number incl. country code, e.g. 919812345678"},
  {"name":"IMSI","type":"text","tooltip":"International Mobile Subscriber Identity"},
  {"name":"ICCID","type":"text","tooltip":"SIM card serial"},
  {"name":"APN","type":"text"},
  {"name":"Subscription Type","type":"select","options":[{"name":"Prepaid Voice"},{"name":"Prepaid Data"},{"name":"Prepaid Hybrid"}]},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Active"},{"name":"Suspended"},{"name":"Terminated"},{"name":"Port Out"},{"name":"Port In Pending"}]},
  {"name":"Activation Date","type":"date"},
  {"name":"Termination Date","type":"date"},
  {"name":"Last Usage Date","type":"date"},
  {"name":"Home Network","type":"text"},
  {"name":"Roaming Enabled","type":"checkbox"},
  {"name":"Notes","type":"long_text"}
]'

add_cols "Subscription Status History" '[
  {"name":"From Status","type":"text"},
  {"name":"To Status","type":"text","required":true},
  {"name":"Changed At","type":"date","required":true},
  {"name":"Reason","type":"text"},
  {"name":"Changed By","type":"text"}
]'

add_cols "MSISDN Pool" '[
  {"name":"MSISDN","type":"text","required":true},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Available"},{"name":"Reserved"},{"name":"Assigned"},{"name":"Quarantined"},{"name":"Blocked"}]},
  {"name":"Tier","type":"select","options":[{"name":"Standard"},{"name":"Gold"},{"name":"Platinum"},{"name":"Vanity"}]},
  {"name":"Reservation Expiry","type":"date"},
  {"name":"Last Assigned Date","type":"date"},
  {"name":"Notes","type":"long_text"}
]'

add_cols "SIM Inventory" '[
  {"name":"ICCID","type":"text","required":true},
  {"name":"IMSI","type":"text"},
  {"name":"Batch ID","type":"text"},
  {"name":"Vendor","type":"text"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"In Stock"},{"name":"Allocated"},{"name":"Activated"},{"name":"Returned"},{"name":"Damaged"}]},
  {"name":"Warehouse Location","type":"text"},
  {"name":"Received Date","type":"date"}
]'

echo "=== Category 3: Product Catalog ==="

add_cols "Services" '[
  {"name":"Service Code","type":"text","required":true},
  {"name":"Service Name","type":"text","required":true},
  {"name":"Service Family","type":"select","required":true,"options":[{"name":"Data"},{"name":"Voice"},{"name":"Messaging"},{"name":"Content"},{"name":"Value Added"}]},
  {"name":"Default Rating Group","type":"number"},
  {"name":"Default Service Context","type":"select","options":[{"name":"32251@3gpp.org"},{"name":"32260@3gpp.org"},{"name":"32274@3gpp.org"},{"name":"32270@3gpp.org"}]},
  {"name":"Unit Type","type":"select","required":true,"options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"},{"name":"Seconds"}]},
  {"name":"Description","type":"long_text"}
]'

add_cols "Product Offerings" '[
  {"name":"Offering Code","type":"text","required":true},
  {"name":"Offering Name","type":"text","required":true},
  {"name":"Description","type":"long_text"},
  {"name":"Offering Type","type":"select","options":[{"name":"Plan"},{"name":"Booster"},{"name":"Top-up Bonus"},{"name":"Add-on"}]},
  {"name":"Base Price","type":"number","currency":true},
  {"name":"Validity Days","type":"number"},
  {"name":"Grace Period Days","type":"number"},
  {"name":"Status","type":"select","options":[{"name":"Draft"},{"name":"Active"},{"name":"Retired"}]},
  {"name":"Renewal Type","type":"select","options":[{"name":"One Time"},{"name":"Auto Renew"},{"name":"On Demand"}]},
  {"name":"Segment Eligibility","type":"multi_select","options":[{"name":"Prepaid Consumer"},{"name":"Prepaid Business"},{"name":"Student"},{"name":"Senior"},{"name":"Youth"}]},
  {"name":"Launch Date","type":"date"},
  {"name":"Retire Date","type":"date"}
]'

add_cols "Bundles" '[
  {"name":"Bundle Code","type":"text","required":true},
  {"name":"Bundle Name","type":"text","required":true},
  {"name":"Bundle Price","type":"number","currency":true},
  {"name":"Discount vs Components","type":"number"},
  {"name":"Validity Days","type":"number"},
  {"name":"Status","type":"select","options":[{"name":"Draft"},{"name":"Active"},{"name":"Retired"}]}
]'

add_cols "Bundle Components" '[
  {"name":"Quantity","type":"number"},
  {"name":"Sequence","type":"number"},
  {"name":"Notes","type":"text"}
]'

echo "=== Category 4: Tariff & Rating ==="

add_cols "Tariff Plans" '[
  {"name":"Plan Code","type":"text","required":true},
  {"name":"Plan Name","type":"text","required":true},
  {"name":"Price","type":"number","required":true,"currency":true},
  {"name":"Currency","type":"select","options":[{"name":"USD"},{"name":"INR"},{"name":"EUR"},{"name":"GBP"}]},
  {"name":"Plan Type","type":"select","options":[{"name":"Daily"},{"name":"Weekly"},{"name":"Monthly"},{"name":"Annual"},{"name":"One Time Pack"},{"name":"Recurring Pack"},{"name":"PAYG"}]},
  {"name":"Validity Days","type":"number","required":true},
  {"name":"Auto Renew Default","type":"checkbox"},
  {"name":"Priority On Charge","type":"number","tooltip":"Lower number depletes first (boosters)"},
  {"name":"Region","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Draft"},{"name":"Active"},{"name":"Retired"}]}
]'

add_cols "Plan Allowances" '[
  {"name":"Rating Group","type":"number","required":true,"tooltip":"10=data general, 100/101/102=voice, 200/201=SMS"},
  {"name":"Service Context","type":"select","options":[{"name":"32251@3gpp.org"},{"name":"32260@3gpp.org"},{"name":"32274@3gpp.org"},{"name":"32270@3gpp.org"}]},
  {"name":"Allowance Label","type":"text","required":true},
  {"name":"Unit Type","type":"select","required":true,"options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"},{"name":"Seconds"}]},
  {"name":"Initial Amount","type":"number","required":true},
  {"name":"Overage Action","type":"select","options":[{"name":"Block"},{"name":"Charge From Wallet"},{"name":"Continue Free"}]},
  {"name":"Overage Rate","type":"number","currency":true},
  {"name":"Priority","type":"number"}
]'

add_cols "Rate Cards" '[
  {"name":"Rate Card Code","type":"text","required":true},
  {"name":"Rating Group","type":"number","required":true},
  {"name":"Service Context","type":"select","options":[{"name":"32251@3gpp.org"},{"name":"32260@3gpp.org"},{"name":"32274@3gpp.org"},{"name":"32270@3gpp.org"}]},
  {"name":"Unit Type","type":"select","required":true,"options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"}]},
  {"name":"Price Per Unit","type":"number","required":true,"currency":true},
  {"name":"Peak Off Peak","type":"select","options":[{"name":"All"},{"name":"Peak"},{"name":"Off Peak"}]},
  {"name":"Peak Start Hour","type":"number"},
  {"name":"Peak End Hour","type":"number"},
  {"name":"Effective From","type":"date"},
  {"name":"Effective To","type":"date"}
]'

add_cols "Tax Rates" '[
  {"name":"Tax Code","type":"text","required":true},
  {"name":"Tax Name","type":"text","required":true},
  {"name":"Rate Percent","type":"number","required":true},
  {"name":"Applies To","type":"select","options":[{"name":"Recharge"},{"name":"Plan Purchase"},{"name":"PAYG"},{"name":"All"}]},
  {"name":"Region","type":"text"},
  {"name":"Effective From","type":"date"},
  {"name":"Effective To","type":"date"}
]'

echo "=== Category 5: Plan Assignment & Bonuses ==="

add_cols "Subscription Plan Assignments" '[
  {"name":"Effective From","type":"date","required":true},
  {"name":"Effective To","type":"date","tooltip":"Empty = currently active"},
  {"name":"Activation Source","type":"select","options":[{"name":"Customer Self Care"},{"name":"CSR"},{"name":"Auto Renew"},{"name":"Promotion"},{"name":"Welcome Pack"},{"name":"Partner"}]},
  {"name":"Renewal Count","type":"number"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Active"},{"name":"Expired"},{"name":"Cancelled"},{"name":"Suspended"}]},
  {"name":"Cancelled Reason","type":"text"},
  {"name":"Price Paid","type":"number","currency":true}
]'

add_cols "Bonus Grants" '[
  {"name":"Bonus Code","type":"text","required":true},
  {"name":"Rating Group","type":"number","required":true},
  {"name":"Unit Type","type":"select","options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"},{"name":"Money"}]},
  {"name":"Amount","type":"number","required":true},
  {"name":"Validity Days","type":"number"},
  {"name":"Granted Reason","type":"select","options":[{"name":"Loyalty"},{"name":"Compensation"},{"name":"Promo"},{"name":"Referral"},{"name":"Win Back"}]},
  {"name":"Granted By","type":"text"},
  {"name":"Granted Date","type":"date"},
  {"name":"Expiry Date","type":"date"},
  {"name":"Consumed Amount","type":"number"}
]'

echo "=== Category 6: Wallet & Recharge ==="

add_cols "Wallets" '[
  {"name":"Wallet Code","type":"text","required":true},
  {"name":"Currency","type":"select","options":[{"name":"USD"},{"name":"INR"},{"name":"EUR"}]},
  {"name":"Current Balance","type":"number","currency":true},
  {"name":"Lifetime Recharge","type":"number","currency":true},
  {"name":"Lifetime Spend","type":"number","currency":true},
  {"name":"Last Recharge Date","type":"date"},
  {"name":"Last Usage Date","type":"date"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Frozen"},{"name":"Closed"}]}
]'

add_cols "Wallet Transactions" '[
  {"name":"Transaction Code","type":"text","required":true},
  {"name":"Transaction Type","type":"select","required":true,"options":[{"name":"Recharge"},{"name":"Plan Purchase"},{"name":"PAYG Debit"},{"name":"Refund"},{"name":"Bonus"},{"name":"Adjustment"},{"name":"Transfer In"},{"name":"Transfer Out"},{"name":"Reversal"}]},
  {"name":"Amount","type":"number","required":true,"currency":true},
  {"name":"Balance Before","type":"number","currency":true},
  {"name":"Balance After","type":"number","currency":true},
  {"name":"Reference ID","type":"text"},
  {"name":"Reference Type","type":"select","options":[{"name":"Recharge"},{"name":"Order"},{"name":"Usage Transaction"},{"name":"Balance Transfer"},{"name":"Bonus Grant"}]},
  {"name":"Timestamp","type":"date","required":true},
  {"name":"Initiated By","type":"text"},
  {"name":"Notes","type":"text"}
]'

add_cols "Recharges" '[
  {"name":"Recharge Code","type":"text","required":true},
  {"name":"Amount","type":"number","required":true,"currency":true},
  {"name":"Currency","type":"select","options":[{"name":"USD"},{"name":"INR"},{"name":"EUR"}]},
  {"name":"Channel","type":"select","required":true,"options":[{"name":"Voucher"},{"name":"USSD"},{"name":"App"},{"name":"Retail POS"},{"name":"IVR"},{"name":"Online"},{"name":"Bank Transfer"}]},
  {"name":"Voucher Serial","type":"text"},
  {"name":"Gateway Reference","type":"text"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Initiated"},{"name":"Successful"},{"name":"Failed"},{"name":"Reversed"}]},
  {"name":"Timestamp","type":"date","required":true},
  {"name":"Tax Amount","type":"number","currency":true},
  {"name":"Net Amount","type":"number","currency":true}
]'

add_cols "Recharge Vouchers" '[
  {"name":"Voucher Serial","type":"text","required":true},
  {"name":"PIN","type":"text"},
  {"name":"Denomination","type":"number","required":true,"currency":true},
  {"name":"Currency","type":"select","options":[{"name":"USD"},{"name":"INR"},{"name":"EUR"}]},
  {"name":"Batch ID","type":"text"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Generated"},{"name":"Distributed"},{"name":"Sold"},{"name":"Redeemed"},{"name":"Expired"},{"name":"Cancelled"}]},
  {"name":"Sold Date","type":"date"},
  {"name":"Redeemed Date","type":"date"},
  {"name":"Expiry Date","type":"date"}
]'

add_cols "Balance Transfers" '[
  {"name":"Transfer Code","type":"text","required":true},
  {"name":"Transfer Type","type":"select","required":true,"options":[{"name":"Money"},{"name":"Data MB"},{"name":"Voice Minutes"}]},
  {"name":"Amount","type":"number","required":true},
  {"name":"Fee","type":"number","currency":true},
  {"name":"Status","type":"select","options":[{"name":"Pending"},{"name":"Completed"},{"name":"Failed"},{"name":"Reversed"}]},
  {"name":"Timestamp","type":"date"},
  {"name":"Reason","type":"text"}
]'

echo "=== Category 7: Charging & Usage ==="

add_cols "Charging Sessions" '[
  {"name":"Session ID","type":"text","required":true,"tooltip":"From Diameter Session-Id AVP"},
  {"name":"Service Context","type":"select","options":[{"name":"32251@3gpp.org"},{"name":"32260@3gpp.org"},{"name":"32274@3gpp.org"},{"name":"32270@3gpp.org"}]},
  {"name":"Service Type","type":"select","options":[{"name":"Data"},{"name":"Voice On-net"},{"name":"Voice Off-net"},{"name":"Voice International"},{"name":"SMS Domestic"},{"name":"SMS International"},{"name":"MMS"}]},
  {"name":"Started At","type":"date","required":true},
  {"name":"Ended At","type":"date"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Active"},{"name":"Terminated"},{"name":"Abandoned"}]},
  {"name":"Termination Cause","type":"select","options":[{"name":"LOGOUT"},{"name":"SESSION_TIMEOUT"},{"name":"USER_MOVED"},{"name":"LINK_BROKEN"},{"name":"AUTH_EXPIRED"},{"name":"ADMIN_TERMINATED"},{"name":"SERVICE_NOT_PROVIDED"},{"name":"BAD_ANSWER"}]},
  {"name":"Calling Party","type":"text"},
  {"name":"Called Party","type":"text"},
  {"name":"APN","type":"text"},
  {"name":"Location Info","type":"text"},
  {"name":"RAT Type","type":"select","options":[{"name":"EUTRAN"},{"name":"UTRAN"},{"name":"GERAN"},{"name":"WLAN"},{"name":"NR"}]},
  {"name":"Request Count","type":"number"},
  {"name":"Total Used Amount","type":"number"},
  {"name":"Total Charged","type":"number","currency":true}
]'

add_cols "Usage Transactions" '[
  {"name":"Message Type","type":"select","required":true,"options":[{"name":"CCR-I"},{"name":"CCR-U"},{"name":"CCR-T"},{"name":"CCR-E"}]},
  {"name":"Request Number","type":"number"},
  {"name":"Timestamp","type":"date","required":true},
  {"name":"Rating Group","type":"number","required":true},
  {"name":"Service Identifier","type":"number"},
  {"name":"Used Amount","type":"number","tooltip":"MB for data, minutes for voice, count for SMS"},
  {"name":"Unit Type","type":"select","options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"}]},
  {"name":"Input Octets","type":"number"},
  {"name":"Output Octets","type":"number"},
  {"name":"CC Time Seconds","type":"number"},
  {"name":"Requested Amount","type":"number"},
  {"name":"Granted Amount","type":"number"},
  {"name":"Result Code","type":"number","tooltip":"2001=OK, 4012=credit limit reached"},
  {"name":"Validity Time","type":"number"},
  {"name":"FUI Action","type":"select","options":[{"name":"None"},{"name":"Terminate"},{"name":"Redirect"},{"name":"Restrict"}]},
  {"name":"FUI Redirect URL","type":"text","subType":"url"},
  {"name":"Calling Party","type":"text"},
  {"name":"Called Party","type":"text"},
  {"name":"APN","type":"text"},
  {"name":"Raw Event","type":"long_text"}
]'

add_cols "Call Detail Records" '[
  {"name":"CDR Code","type":"text","required":true},
  {"name":"Service Type","type":"select","options":[{"name":"Data"},{"name":"Voice On-net"},{"name":"Voice Off-net"},{"name":"Voice International"},{"name":"SMS Domestic"},{"name":"SMS International"}]},
  {"name":"Started At","type":"date"},
  {"name":"Ended At","type":"date"},
  {"name":"Duration Seconds","type":"number"},
  {"name":"Total Octets","type":"number"},
  {"name":"Total MB","type":"number"},
  {"name":"Total Minutes","type":"number"},
  {"name":"Total Units","type":"number"},
  {"name":"Rating Group","type":"number"},
  {"name":"Total Charged from Allowance","type":"number"},
  {"name":"Total Charged from Wallet","type":"number","currency":true},
  {"name":"Final Termination Cause","type":"text"},
  {"name":"Record Sequence Number","type":"number"},
  {"name":"Partner Involved","type":"text"}
]'

add_cols "Balances" '[
  {"name":"Balance Code","type":"text","required":true},
  {"name":"Rating Group","type":"number","required":true},
  {"name":"Service Context","type":"select","options":[{"name":"32251@3gpp.org"},{"name":"32260@3gpp.org"},{"name":"32274@3gpp.org"},{"name":"32270@3gpp.org"}]},
  {"name":"Allowance Label","type":"text"},
  {"name":"Unit Type","type":"select","options":[{"name":"MB"},{"name":"Minutes"},{"name":"Count"}]},
  {"name":"Initial Amount","type":"number","required":true},
  {"name":"Used Amount","type":"number"},
  {"name":"Remaining Amount","type":"number","tooltip":"Formula: initial - used; updated by charging engine"},
  {"name":"Reserved Amount","type":"number"},
  {"name":"Cycle Start","type":"date"},
  {"name":"Cycle End","type":"date"},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Active"},{"name":"Depleted"},{"name":"Expired"},{"name":"Suspended"}]}
]'

echo "=== Category 8: Promotions & Supplementary ==="

add_cols "Promotions" '[
  {"name":"Promotion Code","type":"text","required":true},
  {"name":"Promotion Name","type":"text","required":true},
  {"name":"Type","type":"select","options":[{"name":"Percent Discount"},{"name":"Fixed Discount"},{"name":"Bonus Allowance"},{"name":"Free Service"},{"name":"Cashback"}]},
  {"name":"Eligibility Rules","type":"long_text"},
  {"name":"Start Date","type":"date"},
  {"name":"End Date","type":"date"},
  {"name":"Max Redemptions Per Customer","type":"number"},
  {"name":"Total Budget","type":"number","currency":true},
  {"name":"Budget Consumed","type":"number","currency":true},
  {"name":"Status","type":"select","options":[{"name":"Draft"},{"name":"Active"},{"name":"Paused"},{"name":"Completed"},{"name":"Cancelled"}]}
]'

add_cols "Promotion Redemptions" '[
  {"name":"Redeemed At","type":"date","required":true},
  {"name":"Value Granted","type":"number"},
  {"name":"Reference Transaction","type":"text"},
  {"name":"Expiry Date","type":"date"},
  {"name":"Notes","type":"text"}
]'

add_cols "Friends and Family Groups" '[
  {"name":"Group Code","type":"text","required":true},
  {"name":"Group Name","type":"text","required":true},
  {"name":"Max Members","type":"number"},
  {"name":"Special Rate Card","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Disabled"}]}
]'

add_cols "FF Members" '[
  {"name":"Member MSISDN","type":"text","required":true},
  {"name":"Added Date","type":"date"},
  {"name":"On Net","type":"checkbox"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Removed"}]}
]'

add_cols "Closed User Groups" '[
  {"name":"CUG Code","type":"text","required":true},
  {"name":"CUG Name","type":"text","required":true},
  {"name":"CUG Type","type":"select","options":[{"name":"Corporate"},{"name":"Community"},{"name":"MVPN"}]},
  {"name":"Internal Rate Card","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Disabled"}]}
]'

add_cols "CUG Members" '[
  {"name":"Role","type":"select","options":[{"name":"Admin"},{"name":"Member"}]},
  {"name":"Added Date","type":"date"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Removed"}]}
]'

echo "=== Category 9: Partners ==="

add_cols "Distribution Partners" '[
  {"name":"Partner Code","type":"text","required":true},
  {"name":"Partner Name","type":"text","required":true},
  {"name":"Partner Type","type":"select","options":[{"name":"Retail Shop"},{"name":"Super Dealer"},{"name":"App Agent"},{"name":"Bank Channel"},{"name":"Online Portal"}]},
  {"name":"Tier","type":"select","options":[{"name":"Gold"},{"name":"Silver"},{"name":"Bronze"}]},
  {"name":"Region","type":"text"},
  {"name":"Contact Person","type":"text"},
  {"name":"Contact Phone","type":"text","subType":"phone"},
  {"name":"Contact Email","type":"text","subType":"email"},
  {"name":"Commission Scheme","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Prospect"},{"name":"Onboarding"},{"name":"Active"},{"name":"Suspended"},{"name":"Terminated"}]},
  {"name":"Onboarded Date","type":"date"},
  {"name":"Wallet Balance","type":"number","currency":true}
]'

add_cols "Partner Commissions" '[
  {"name":"Commission Type","type":"select","options":[{"name":"Percent"},{"name":"Fixed"},{"name":"Tiered"}]},
  {"name":"Base Amount","type":"number","currency":true},
  {"name":"Commission Amount","type":"number","required":true,"currency":true},
  {"name":"Accrued Date","type":"date"},
  {"name":"Settled Date","type":"date"},
  {"name":"Settlement Reference","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Accrued"},{"name":"Pending Settlement"},{"name":"Settled"},{"name":"Reversed"}]}
]'

add_cols "Partner Contracts" '[
  {"name":"Contract Number","type":"text","required":true},
  {"name":"Effective From","type":"date"},
  {"name":"Effective To","type":"date"},
  {"name":"Commission Structure","type":"long_text"},
  {"name":"SLA Targets","type":"long_text"},
  {"name":"Termination Clauses","type":"long_text"},
  {"name":"Signed Document URL","type":"text","subType":"url"},
  {"name":"Status","type":"select","options":[{"name":"Draft"},{"name":"Active"},{"name":"Expired"},{"name":"Terminated"}]}
]'

echo "=== Category 10: Channels, Orders, Cases ==="

add_cols "Channels" '[
  {"name":"Channel Code","type":"text","required":true},
  {"name":"Channel Name","type":"text","required":true},
  {"name":"Channel Type","type":"select","required":true,"options":[{"name":"USSD"},{"name":"SMS"},{"name":"IVR"},{"name":"Mobile App"},{"name":"Web Self Care"},{"name":"Retail"},{"name":"Chat"},{"name":"Social"},{"name":"WhatsApp"}]},
  {"name":"Enabled","type":"checkbox"},
  {"name":"Operating Hours","type":"text"},
  {"name":"Config JSON","type":"long_text"}
]'

add_cols "Customer Interactions" '[
  {"name":"Interaction Code","type":"text","required":true},
  {"name":"Interaction Type","type":"select","options":[{"name":"Balance Check"},{"name":"Recharge"},{"name":"Plan Purchase"},{"name":"Complaint"},{"name":"Query"},{"name":"Status Update"},{"name":"Self Care Action"}]},
  {"name":"Timestamp","type":"date","required":true},
  {"name":"Duration Seconds","type":"number"},
  {"name":"Outcome","type":"select","options":[{"name":"Resolved"},{"name":"Escalated"},{"name":"Pending"},{"name":"Failed"}]},
  {"name":"Agent ID","type":"text"},
  {"name":"Transcript","type":"long_text"},
  {"name":"CSAT Score","type":"rating"}
]'

add_cols "Orders" '[
  {"name":"Order Code","type":"text","required":true},
  {"name":"Order Type","type":"select","required":true,"options":[{"name":"New Activation"},{"name":"Plan Purchase"},{"name":"SIM Replacement"},{"name":"Port In"},{"name":"Port Out"},{"name":"Barring"},{"name":"Reactivation"}]},
  {"name":"Total Amount","type":"number","currency":true},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Draft"},{"name":"Submitted"},{"name":"In Progress"},{"name":"Fulfilled"},{"name":"Cancelled"},{"name":"Failed"}]},
  {"name":"Submitted At","type":"date"},
  {"name":"Fulfilled At","type":"date"},
  {"name":"Notes","type":"long_text"}
]'

add_cols "Order Items" '[
  {"name":"Quantity","type":"number","required":true},
  {"name":"Unit Price","type":"number","currency":true},
  {"name":"Total","type":"number","currency":true},
  {"name":"Notes","type":"text"}
]'

add_cols "Cases" '[
  {"name":"Case Code","type":"text","required":true},
  {"name":"Category","type":"select","options":[{"name":"Billing"},{"name":"Technical"},{"name":"Service Request"},{"name":"Complaint"},{"name":"Fraud"},{"name":"Other"}]},
  {"name":"Priority","type":"select","options":[{"name":"Low"},{"name":"Medium"},{"name":"High"},{"name":"Critical"}]},
  {"name":"Status","type":"select","required":true,"options":[{"name":"Open"},{"name":"In Progress"},{"name":"Resolved"},{"name":"Closed"},{"name":"Reopened"}]},
  {"name":"Subject","type":"text","required":true},
  {"name":"Description","type":"long_text"},
  {"name":"Assigned To","type":"text"},
  {"name":"Opened At","type":"date","required":true},
  {"name":"Resolved At","type":"date"},
  {"name":"Resolution Notes","type":"long_text"},
  {"name":"CSAT","type":"rating"}
]'

echo "=== Category 11: Platform ==="

add_cols "Notification Templates" '[
  {"name":"Template Code","type":"text","required":true},
  {"name":"Template Name","type":"text","required":true},
  {"name":"Trigger Event","type":"select","options":[{"name":"Low Balance"},{"name":"Plan Expiring"},{"name":"Recharge Success"},{"name":"Plan Activated"},{"name":"Promotion Eligible"},{"name":"Plan Depleted"},{"name":"KYC Pending"},{"name":"Welcome"},{"name":"Port Complete"}]},
  {"name":"Channel Type","type":"select","options":[{"name":"SMS"},{"name":"Push"},{"name":"Email"},{"name":"USSD"},{"name":"In-App"}]},
  {"name":"Subject","type":"text"},
  {"name":"Body","type":"long_text"},
  {"name":"Variables","type":"text","tooltip":"Comma-separated placeholder names like {name},{balance}"},
  {"name":"Language","type":"select","options":[{"name":"English"},{"name":"Hindi"},{"name":"Spanish"},{"name":"French"},{"name":"Arabic"}]},
  {"name":"Enabled","type":"checkbox"}
]'

add_cols "Notifications Sent" '[
  {"name":"Sent At","type":"date","required":true},
  {"name":"Delivered At","type":"date"},
  {"name":"Read At","type":"date"},
  {"name":"Status","type":"select","options":[{"name":"Queued"},{"name":"Sent"},{"name":"Delivered"},{"name":"Failed"},{"name":"Bounced"}]},
  {"name":"Content Snapshot","type":"long_text"}
]'

add_cols "Business Rules" '[
  {"name":"Rule Code","type":"text","required":true},
  {"name":"Rule Name","type":"text","required":true},
  {"name":"Rule Type","type":"select","options":[{"name":"Rating"},{"name":"Notification"},{"name":"Promotion"},{"name":"Fraud"},{"name":"Workflow"},{"name":"Routing"}]},
  {"name":"Trigger Condition","type":"long_text"},
  {"name":"Action","type":"long_text"},
  {"name":"Priority","type":"number"},
  {"name":"Enabled","type":"checkbox"}
]'

add_cols "Audit Log" '[
  {"name":"Timestamp","type":"date","required":true},
  {"name":"Actor","type":"text"},
  {"name":"Actor Type","type":"select","options":[{"name":"User"},{"name":"System"},{"name":"API Client"}]},
  {"name":"Entity Type","type":"text"},
  {"name":"Entity ID","type":"text"},
  {"name":"Action","type":"text"},
  {"name":"Before Value","type":"long_text"},
  {"name":"After Value","type":"long_text"},
  {"name":"Source Channel","type":"text"},
  {"name":"Request ID","type":"text"}
]'

add_cols "Network Elements" '[
  {"name":"Element Code","type":"text","required":true},
  {"name":"Element Type","type":"select","options":[{"name":"PGW"},{"name":"SGW"},{"name":"SMSC"},{"name":"MSC"},{"name":"MME"},{"name":"HSS"},{"name":"PCRF"},{"name":"PCF"},{"name":"SMF"},{"name":"UPF"},{"name":"AMF"},{"name":"NRF"},{"name":"AUSF"},{"name":"UDM"}]},
  {"name":"FQDN","type":"text"},
  {"name":"IP Address","type":"text"},
  {"name":"Diameter Realm","type":"text"},
  {"name":"Region","type":"text"},
  {"name":"Status","type":"select","options":[{"name":"Active"},{"name":"Maintenance"},{"name":"Offline"}]},
  {"name":"Last Heartbeat","type":"date"}
]'

echo ""
echo "=== Done ==="
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED: ${FAILED[@]}"
  exit 1
fi
echo "All column batches succeeded."
