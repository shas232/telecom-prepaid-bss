#!/bin/bash
for n in \
  fraud-scan \
  compute-counters \
  loyalty-accrual \
  plan-expiry \
  period-rollover \
  commission-settlement \
  low-stock-alert \
  cdr-reconcile \
  unbilled-cdr-report \
  scheduled-reports \
  shrinkage-recon; do
  launchctl unload ~/Library/LaunchAgents/com.telecom.$n.plist 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.telecom.$n.plist
done
echo "Unloaded all telecom launchd jobs."
