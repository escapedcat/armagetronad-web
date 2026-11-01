#!/usr/bin/env bash
# Open (or refresh) one pull request that merges upstream into main.
#
# Called by .github/workflows/upstream-watch.yml. A PR replaces the old drift
# issue because an issue the bot opened, and its comments, notified nobody: the
# owner does not watch this repo. A REVIEW REQUEST always notifies, so the PR
# is opened by github-actions with the owner as reviewer.
#
# TWO TOKENS, ON PURPOSE.
#   GH_TOKEN    the workflow's own token: opens, edits and comments on the PR.
#               As the author it can ask the owner for review; a PR opened
#               with the owner's own token could not, and would notify no one.
#   PUSH_TOKEN  the owner's fine-grained token (secret UPSTREAM_PR_TOKEN):
#               pushes the merge commit. GitHub starts no workflows for events
#               made with the workflow token, so without this push the checks
#               would never run on the PR.
# A new PR therefore takes two pushes: the plain upstream head first (the PR
# needs its branch to exist), then the merge commit with PUSH_TOKEN, which is
# the "synchronize" that starts the checks.
#
# A merge that conflicts cannot be pushed as a commit; the PR is then a draft
# on the plain upstream head, and its body names the conflicted files.
#
# Env: GH_TOKEN, PUSH_TOKEN, GITHUB_REPOSITORY, REVIEWER. Optional OUT (scratch dir).
set -euo pipefail

PR_BRANCH=upstream-merge
OUT=${OUT:-$(mktemp -d)}
BOT_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
PUSH_URL="https://x-access-token:${PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

node web/tools/check-upstream.mjs --json > "$OUT/report.json"
node web/tools/check-upstream.mjs --markdown > "$OUT/body.md"
node web/tools/check-upstream.mjs

field() { node -e "const r=require(process.argv[1]); console.log($1)" "$OUT/report.json"; }
behind=$(field r.commitsBehind)
head=$(field r.upstreamHead)
conflicts=$(field r.conflicts.length)
security=$(field r.security.length)

if [ "$behind" = 0 ]; then
    echo "Up to date with upstream; no PR."
    exit 0
fi

# The newest PR from this branch, open, closed or merged. Its body says which
# upstream head it was written for: the same head means it was already
# proposed (and, if closed, turned down), so nothing new to say.
gh pr list --head "$PR_BRANCH" --state all --limit 1 --json number,state,body > "$OUT/last.json"
last_number=$(node -e "const p=require(process.argv[1])[0]; console.log(p ? p.number : '')" "$OUT/last.json")
last_state=$(node -e "const p=require(process.argv[1])[0]; console.log(p ? p.state : '')" "$OUT/last.json")
if [ -n "$last_number" ] && node -e "process.exit(require(process.argv[1])[0].body.includes(process.argv[2]) ? 0 : 1)" \
        "$OUT/last.json" "<!-- upstream-head: ${head} -->"; then
    echo "Upstream head ${head:0:12} already proposed in #${last_number} (${last_state}); nothing to do."
    exit 0
fi

if [ "$conflicts" = 0 ]; then
    git -c user.name='github-actions[bot]' \
        -c user.email='41898283+github-actions[bot]@users.noreply.github.com' \
        merge --no-ff --no-edit -m "Merge upstream legacy_0.2.9 (${head:0:12})" "upstream/legacy_0.2.9"
    target=$(git rev-parse HEAD)
else
    target=$head
fi

title="Merge upstream legacy_0.2.9: ${behind} commit(s), ${security} security-relevant"
[ "$conflicts" = 0 ] || title="$title (conflicts)"

if [ "$last_state" = OPEN ]; then
    git push --force "$PUSH_URL" "${target}:refs/heads/${PR_BRANCH}"
    gh pr edit "$last_number" --title "$title" --body-file "$OUT/body.md" --add-reviewer "$REVIEWER"
    if [ "$conflicts" = 0 ]; then gh pr ready "$last_number" || true; else gh pr ready --undo "$last_number" || true; fi
    # A comment on a PR the owner was asked to review reaches them; a force
    # push alone may not.
    gh pr comment "$last_number" --body "Upstream moved to \`${head:0:12}\`: now ${behind} commit(s) behind, ${security} security-relevant. The description is updated."
    echo "Updated #${last_number}."
    exit 0
fi

git push --force "$BOT_URL" "${head}:refs/heads/${PR_BRANCH}"
draft=()
[ "$conflicts" = 0 ] || draft=(--draft)
url=$(gh pr create --base main --head "$PR_BRANCH" --title "$title" --body-file "$OUT/body.md" \
    --reviewer "$REVIEWER" "${draft[@]}")
echo "Opened $url"
if [ "$target" != "$head" ]; then
    git push --force "$PUSH_URL" "${target}:refs/heads/${PR_BRANCH}"
fi
