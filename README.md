# Telecom Prepaid BSS

Prepaid telecom Business Support System on the ERPAI platform.

[![Scheduled](https://github.com/shas232/telecom-prepaid-bss/actions/workflows/scheduled.yml/badge.svg)](https://github.com/shas232/telecom-prepaid-bss/actions/workflows/scheduled.yml)

## Scheduled workflows

The 11 scheduled Node workflows (fraud-scan, compute-counters, loyalty-accrual,
commission-settlement, plan-expiry, period-rollover, low-stock-alert,
cdr-reconcile, unbilled-cdr-report, scheduled-reports, shrinkage-recon) now run
on GitHub Actions — see `.github/workflows/scheduled.yml`. The macOS `launchd`
plists are legacy/fallback only.

See `scripts/README-workflows.md` for the script catalog and cadence.
