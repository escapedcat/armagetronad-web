#!/bin/sh
# Apply the repository settings this project relies on, idempotently:
#
#   sh web/tools/apply-repo-settings.sh            # needs `gh auth status` OK, repo admin
#
# WHY A SCRIPT. The 2026-09-03 security audit's one live finding was that main
# had no protection while CI deploys on merge: a bad merge ships. Protection is
# a repository SETTING, which no pull request can carry -- so the setting is
# kept here as code (.github/rulesets/main.json) and this script makes GitHub
# match it. Run it after changing the JSON; running it twice changes nothing.
#
# WHAT IT SETS.
#   1. A branch RULESET on the default branch (rulesets are GitHub's current
#      mechanism; classic branch protection is the old one): changes reach main
#      only through a pull request (0 approvals required -- a solo maintainer
#      cannot approve his own PR); the PR build check must be green; no
#      force-push; no deletion. bypass_actors is EMPTY on purpose: it binds the
#      admin too, which is the point.
#   2. Dependabot vulnerability ALERTS on. (.github/dependabot.yml already
#      handles version bumps; alerts are a separate switch and were off.)
#   3. Dependabot automated security fixes on.
#
# ADDING A REQUIRED CHECK. The context string must be the check-run's exact
# name as GitHub reports it (`gh api repos/<r>/commits/<sha>/check-runs`), and
# the workflow that produces it must run on EVERY pull request -- a required
# check that never runs on a docs-only PR wedges that PR. When checks.yml
# (dedicated byte pin, shellcheck) has merged, add its two job names here and
# re-run this script.
set -eu
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
JSON=$(dirname "$0")/../../.github/rulesets/main.json
NAME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$JSON")

EXISTING=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$NAME\") | .id" | head -1)
if [ -n "$EXISTING" ]; then
  gh api -X PUT "repos/$REPO/rulesets/$EXISTING" --input "$JSON" --jq '"ruleset updated: id \(.id) enforcement \(.enforcement)"'
else
  gh api -X POST "repos/$REPO/rulesets" --input "$JSON" --jq '"ruleset created: id \(.id) enforcement \(.enforcement)"'
fi
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null && echo "dependabot vulnerability alerts: on"
gh api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null && echo "dependabot automated security fixes: on"
echo "verify: alerts $(gh api -i "repos/$REPO/vulnerability-alerts" 2>/dev/null | head -1 | awk '{print $2}') (204 = on); rulesets $(gh api "repos/$REPO/rulesets" --jq 'length')"
