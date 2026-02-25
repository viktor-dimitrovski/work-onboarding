#!/usr/bin/env bash
set -euo pipefail

systemctl status onboarding-backend onboarding-frontend --no-pager

echo
echo "Recent backend logs:"
journalctl -u onboarding-backend -n 50 --no-pager

echo
echo "Recent frontend logs:"
journalctl -u onboarding-frontend -n 50 --no-pager
