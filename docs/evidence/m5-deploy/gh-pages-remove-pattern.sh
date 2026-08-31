#!/bin/sh
# A/B for the ONE flag M5 task 4 had to add to the deploy that the plan did not
# call for: gh-pages' -v / --remove pattern.
#
# THE DEFECT, IN ONE SENTENCE. `npx gh-pages -d dist -f --nojekyll` -- the exact
# recipe M5's plan and recon specify -- publishes this repository's client
# WITHOUT ITS ENTRY POINT, prints "Published", and exits 0.
#
# THE MECHANISM, THREE PARTS, ALL THREE NEEDED.
#
#  1. gh-pages clears the branch before copying by globbing its own checkout
#     with the -v pattern (default ".") and `git rm`-ing what comes back. It
#     passes no `dot` option to globby, so globby's default `dot: false` applies
#     and NO DOTFILE IS EVER IN THAT LIST. (lib/index.js, the block logging
#     "Removing files"; the pattern default is `remove: '.'` in `exports.defaults`.)
#
#  2. When the gh-pages branch does not exist yet, gh-pages creates it with
#     `git checkout --orphan`, which keeps the working tree AND the index of the
#     default branch. So the branch starts as a full copy of the source tree,
#     and by (1) every dotfile in it survives the clearing step -- including the
#     repository's root .gitignore.
#
#  3. gh-pages then runs `git add .`, which honours that surviving .gitignore.
#     Line 63 of ours is a bare `*.html`, aimed at the generated docs under
#     src/doc/ (the same rule web/shell.html and web/index.html are excepted
#     from). It matches armagetronad.html and index.html. `git add` says nothing
#     when it skips an ignored path, so the deploy reports success.
#
# This is not a hypothetical: the first real deploy of this repo published
# .wasm + .js + .data, thirteen stray dotfiles, and no page, and the only
# symptom was a 404. See docs/evidence/m5-deploy/README.md.
#
# WHAT THIS SCRIPT PROVES. Same rig, same publish set, one flag different:
#   A  -f --nojekyll                        -> 0 html files, dotfile litter
#   B  -f --nojekyll -v "{**/*,**/.*}"      -> exactly the six expected entries
# and B is run twice, once with the gh-pages branch absent (the orphan path of
# (2)) and once with it present, because those are different code paths in
# gh-pages and only the first one is the first-deploy case.
#
# The rig is a local bare repo, not GitHub: the defect is entirely in what
# gh-pages commits, so no network and no Pages account is needed to see it.
#
# Usage:  sh docs/evidence/m5-deploy/gh-pages-remove-pattern.sh [workdir]
#         (workdir defaults to a fresh mktemp -d; it is NOT deleted afterwards)
set -eu

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
WORK=${1:-$(mktemp -d)}
PATTERN='{**/*,**/.*}'

echo "repo=$REPO"
echo "work=$WORK"
echo "gh-pages version: $(cd "$REPO/web" && npx --yes gh-pages@6 --version)"

# ---- the rig ------------------------------------------------------------
# A source tree carrying the two ingredients that matter: this repository's own
# root .gitignore (for its bare *.html rule) and a few dotfiles at the depths
# the real broken deploy left them at. find-cache-dir walks up for a
# node_modules, so the rig needs one or gh-pages throws before it starts.
mkrig() {
  rig=$1
  rm -rf "$rig"
  mkdir -p "$rig/src-repo/conan" "$rig/src-repo/language" "$rig/src-repo/src"
  cd "$rig/src-repo"
  git init -q -b main .
  git config user.name  "$(git -C "$REPO" config user.name)"
  git config user.email "$(git -C "$REPO" config user.email)"
  cp "$REPO/.gitignore" .
  cp "$REPO/.clang-format" .
  cp "$REPO/conan/.gitignore"    conan/.gitignore
  cp "$REPO/language/.gitignore" language/.gitignore
  cp "$REPO/src/.clangd"         src/.clangd
  echo "source file" > README
  echo '{"name":"ghp-rig","version":"0.0.0","private":true}' > package.json
  mkdir -p node_modules
  git add -A -f . >/dev/null
  git commit -qm "source tree"
  git init -q --bare "$rig/origin.git"
  git remote add origin "$rig/origin.git"
  git push -q origin main
  git -C "$rig/origin.git" symbolic-ref HEAD refs/heads/main
}

# The publish set: the four names web/Makefile's client link emits, plus the
# redirect web/package.json copies in. Contents are placeholders -- this
# measures which paths get committed, not what is in them.
mkdir -p "$WORK/dist"
for f in armagetronad.html armagetronad.js armagetronad.wasm armagetronad.data index.html; do
  echo "$f" > "$WORK/dist/$f"
done

show() { git -C "$1/origin.git" ls-tree -r --name-only gh-pages; }
count_html() { show "$1" | grep -c '\.html$' || true; }

# ---- A: the plan's recipe, branch absent --------------------------------
mkrig "$WORK/a"
echo
echo "=== A: -f --nojekyll (branch absent) ==============================="
npx --yes gh-pages@6 -d "$WORK/dist" -f --nojekyll -m "A" 2>&1 | tail -1
show "$WORK/a"
echo "html files published: $(count_html "$WORK/a")   <-- expect 0, the defect"

# ---- B1: the fix, same rig, branch now present --------------------------
echo
echo "=== B1: -v \"$PATTERN\" (branch present, holding A's litter) ========"
npx --yes gh-pages@6 -d "$WORK/dist" -f --nojekyll -v "$PATTERN" -m "B1" 2>&1 | tail -1
show "$WORK/a"
echo "html files published: $(count_html "$WORK/a")   <-- expect 2"

# ---- B2: the fix on the first-deploy path -------------------------------
mkrig "$WORK/b"
echo
echo "=== B2: -v \"$PATTERN\" (branch absent -- the orphan path) =========="
npx --yes gh-pages@6 -d "$WORK/dist" -f --nojekyll -v "$PATTERN" -m "B2" 2>&1 | tail -1
show "$WORK/b"
echo "html files published: $(count_html "$WORK/b")   <-- expect 2"
echo "commit parents: [$(git -C "$WORK/b/origin.git" log -1 --format=%P gh-pages)]  <-- expect empty, -f is --no-history"

echo
echo "=== verdict ========================================================"
a=$(show "$WORK/a" | sort | tr '\n' ' ')
b=$(show "$WORK/b" | sort | tr '\n' ' ')
want=".nojekyll armagetronad.data armagetronad.html armagetronad.js armagetronad.wasm index.html "
if [ "$a" = "$want" ] && [ "$b" = "$want" ]; then
  echo "PASS: both fixed runs published exactly: $want"
else
  echo "FAIL"; echo "  B1: $a"; echo "  B2: $b"; echo "  want: $want"; exit 1
fi
