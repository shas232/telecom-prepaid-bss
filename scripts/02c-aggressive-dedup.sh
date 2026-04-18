#!/bin/zsh
# Aggressive dedup — for every table, find duplicate-name non-system columns
# and delete all but one (preferring the typed email/phone/url over plain text).
# Uses per-table loop without set -e so we don't bail on one failure.

cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")
TOTAL_DELETED=0

# Safely iterate table names (can have spaces)
echo "$IDS_JSON" | jq -r 'keys[]' | while IFS= read -r table_name; do
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$table_name" '.[$n]')
  [ -z "$tid" ] || [ "$tid" = "null" ] && continue

  meta=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/app-builder/table/$tid")
  # Skip if response is not JSON
  if ! echo "$meta" | jq -e '.' >/dev/null 2>&1; then
    echo "[$table_name] non-JSON response, skipping"
    continue
  fi

  # Build the list of column IDs to delete
  ids_to_delete=$(echo "$meta" | jq -c '
    ((.columnsMetaData // .data.columnsMetaData) // [])
    | map(select(.id as $id | ["ID","CTDT","UTDT","CTBY","UTBY","DFT","SFID"] | index($id) | not))
    | group_by(.name)
    | map(select(length > 1)
        | (map(.type)) as $t
        | if ($t | contains(["email"])) or ($t | contains(["phone"])) or ($t | contains(["url"]))
          then map(select(.type == "text")) | map(.id)
          else .[1:] | map(.id)
          end
      )
    | add // []
  ')

  n=$(echo "$ids_to_delete" | jq 'length')
  [ "$n" = "0" ] && continue

  echo "[$table_name] $n to delete: $(echo "$ids_to_delete" | jq -c .)"
  for cid in $(echo "$ids_to_delete" | jq -r '.[]'); do
    r=$(curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$BASE_URL/v1/app-builder/table/$tid/column/$cid")
    ok=$(echo "$r" | jq -r '.success // false' 2>/dev/null)
    if [ "$ok" = "true" ]; then
      TOTAL_DELETED=$((TOTAL_DELETED + 1))
    else
      echo "   ✗ $cid: $r"
    fi
    sleep 1.2
  done
done

echo ""
echo "Total deleted: $TOTAL_DELETED"
