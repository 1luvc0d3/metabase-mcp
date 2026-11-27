#!/usr/bin/env bash
# Decides whether a pull request may be auto-merged. Used by .github/workflows/auto-merge.yml,
# which runs it from main (pull_request_target), so a PR can't change the rules that judge it.
# It reads the PR through the API and never checks out or runs PR code.
#
# Eligible:
#   Dependabot (DEPS and ECOSYSTEM come from dependabot/fetch-metadata):
#     - npm dev dependencies, minor or patch
#     - npm runtime dependencies, patch only
#     - GitHub Actions, minor or patch, unless the PR touches publish.yml (PR CI never runs it,
#       so passing checks say nothing about it)
#   Maintenance routine LTS bumps: a claude/* branch in this repo, opened by the repo owner,
#   whose only change is the `metabase:` matrix line in nightly.yml, replaced by a line of
#   plain version tags. That value is interpolated into a `docker run` command, so the
#   pattern is strict.
#
# Everything else waits for a human. GitHub still merges only once the required checks pass.
#
# Usage: REPO=owner/name PR=123 [DEPS=<json>] [ECOSYSTEM=npm_and_yarn] auto-merge-eligible.sh
# Prints eligible=true|false and reason=..., and appends them to $GITHUB_OUTPUT when set.
set -euo pipefail

: "${REPO:?REPO is required}" "${PR:?PR is required}"

eligible=false
reason="not an auto-merge category"

pr_json=$(gh api "repos/$REPO/pulls/$PR")
author=$(jq -r '.user.login' <<<"$pr_json")
head_repo=$(jq -r '.head.repo.full_name // ""' <<<"$pr_json")
head_ref=$(jq -r '.head.ref' <<<"$pr_json")
draft=$(jq -r '.draft' <<<"$pr_json")
state=$(jq -r '.state' <<<"$pr_json")
files=$(gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '.[].filename')

LINE_RE='^        metabase: \[v[0-9]+(\.[0-9]+){1,3}, v[0-9]+(\.[0-9]+){1,3}, latest\]$'

if [ "$state" != open ]; then
  reason="PR is $state"
elif [ "$draft" = true ]; then
  reason="draft"
elif [ "$author" = 'dependabot[bot]' ]; then
  deps=${DEPS:-[]}
  [ -n "$deps" ] || deps='[]'
  ecosystem=${ECOSYSTEM:-}
  if [ "$ecosystem" = github_actions ] && grep -qx '.github/workflows/publish.yml' <<<"$files"; then
    reason="GitHub Actions update touches publish.yml"
  else
    ok=$(jq --arg eco "$ecosystem" '
      length > 0 and all(.[];
        if $eco == "github_actions" then
          .updateType == "version-update:semver-minor" or .updateType == "version-update:semver-patch"
        elif $eco == "npm_and_yarn" then
          (.dependencyType == "direct:development"
            and (.updateType == "version-update:semver-minor" or .updateType == "version-update:semver-patch"))
          or (.dependencyType == "direct:production" and .updateType == "version-update:semver-patch")
        else false end)' <<<"$deps")
    if [ "$ok" = true ]; then
      eligible=true
      reason="Dependabot $ecosystem update within the auto-merge rules"
    else
      reason="Dependabot update outside the auto-merge rules (major, runtime minor, indirect or unknown)"
    fi
  fi
elif [[ "$head_ref" == claude/* ]]; then
  if [ "$head_repo" != "$REPO" ]; then
    reason="claude/* branch from a fork"
  elif [ "$author" != "${REPO%%/*}" ]; then
    reason="claude/* branch not opened by the repo owner"
  elif [ "$files" != ".github/workflows/nightly.yml" ]; then
    reason="changes files other than nightly.yml"
  else
    patch=$(gh api "repos/$REPO/pulls/$PR/files" --jq '.[0].patch // ""')
    removed=$(grep -c '^-' <<<"$patch" || true)
    added=$(grep -c '^+' <<<"$patch" || true)
    removed_ok=$(grep '^-' <<<"$patch" | sed 's/^-//' | grep -cE "$LINE_RE" || true)
    added_ok=$(grep '^+' <<<"$patch" | sed 's/^+//' | grep -cE "$LINE_RE" || true)
    if [ "$removed" = 1 ] && [ "$added" = 1 ] && [ "$removed_ok" = 1 ] && [ "$added_ok" = 1 ]; then
      eligible=true
      reason="nightly LTS pin bump"
    else
      reason="nightly.yml change is not just a version-pin bump"
    fi
  fi
fi

echo "eligible=$eligible"
echo "reason=$reason"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "eligible=$eligible"
    echo "reason=$reason"
  } >>"$GITHUB_OUTPUT"
fi
