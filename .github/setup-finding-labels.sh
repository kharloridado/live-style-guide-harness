#!/usr/bin/env bash
# Run once per repo: creates the finding, handover and deliverable labels. Requires gh v2.94.0+.
set -euo pipefail
REPO="${1:?usage: setup-finding-labels.sh owner/repo}"
gh label create finding   -R "$REPO" -c "#B60205" -d "Design-conformance finding" --force
gh label create bug       -R "$REPO" -c "#D73A4A" -d "Finding filed as a bug" --force
gh label create handover  -R "$REPO" -c "#0E8A16" -d "Code handover for OutSystems" --force
gh label create task      -R "$REPO" -c "#0052CC" --force
gh label create deliverable -R "$REPO" -c "#C5DEF5" -d "A deliverable PR" --force
for t in a11y brand token consistency; do gh label create "$t" -R "$REPO" -c "#1D76DB" --force; done
gh label create sev:blocker -R "$REPO" -c "#B60205" --force
gh label create sev:high    -R "$REPO" -c "#D93F0B" --force
gh label create sev:medium  -R "$REPO" -c "#FBCA04" --force
gh label create sev:low     -R "$REPO" -c "#0E8A16" --force
for s in acknowledged accepted-as-designed fixed-in-design waived; do gh label create "status:$s" -R "$REPO" -c "#5319E7" --force; done
echo "Finding labels created on $REPO"
