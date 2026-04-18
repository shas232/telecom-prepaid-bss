#!/bin/zsh
# Cleans up duplicate columns produced by partial earlier runs.
# For each table, if a column NAME appears twice and one is "text" while the other
# is email/phone/url, delete the "text" version. Else keep the first.

set -e
cd "$(dirname "$0")"
source ./env.sh

IDS_JSON=$(cat "$IDS_FILE")
TOTAL_DELETED=0

# Iterate through every table
for table_name in $(echo "$IDS_JSON" | jq -r 'keys[]'); do
  tid=$(echo "$IDS_JSON" | jq -r --arg n "$table_name" '.[$n]')

  meta=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/v1/app-builder/table/$tid")

  # Get dupes as (name, type, id)
  # Group by name, keep names with count > 1, exclude system cols
  dupes=$(echo "$meta" | jq -c '
    (.columnsMetaData // .data.columnsMetaData // [])
    | map(select(.id as $id | ["ID","CTDT","UTDT","CTBY","UTBY","DFT","SFID"] | index($id) | not))
    | group_by(.name)
    | map(select(length > 1))
  ')

  dupe_count=$(echo "$dupes" | jq 'length')
  if [ "$dupe_count" = "0" ]; then
    continue
  fi

  echo "[$table_name] found $dupe_count duplicate-name groups"

  ids_to_delete=$(echo "$dupes" | jq -c '
    map(
      (map(.type)) as $types
      | if ($types | contains(["email"])) or ($types | contains(["phone"])) or ($types | contains(["url"]))
        then map(select(.type == "text")) | map(.id)
        else .[1:] | map(.id)
        end
    ) | add // []
  ')

  n=$(echo "$ids_to_delete" | jq 'length')
  if [ "$n" = "0" ]; then continue; fi

  echo "  deleting $n columns one by one..."
  for cid in $(echo "$ids_to_delete" | jq -r '.[]'); do
    res=$(curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$BASE_URL/v1/app-builder/table/$tid/column/$cid")
    ok=$(echo "$res" | jq -r '.success // false' 2>/dev/null)
    if [ "$ok" = "true" ]; then
      TOTAL_DELETED=$((TOTAL_DELETED + 1))
    else
      echo "    ✗ $cid: $res"
    fi
    sleep 1.1
  done
  echo "  done"
done

echo ""
echo "Total duplicate columns deleted: $TOTAL_DELETED"
