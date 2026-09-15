#!/usr/bin/env bash
set -euo pipefail
npm install
npm run deploy:prod
echo "Then configure these runtime secrets in Cloudflare Workers > Settings > Variables & Secrets:"
echo "  APP_PASSCODE"
echo "  SESSION_SECRET"
