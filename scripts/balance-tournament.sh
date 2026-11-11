#!/usr/bin/env bash
# Runs the balance tournaments of docs/balance/ (spec 05 §8, AC-05-22).
# Usage: scripts/balance-tournament.sh <out-dir> [jobs]
# Writes <out-dir>/personalities-<map>.json (4 personality pairs, Medium) and
# <out-dir>/difficulties-<map>.json (balanced vs balanced, all 4x4 levels).
set -euo pipefail
out=${1:?usage: balance-tournament.sh <out-dir> [jobs]}
jobs=${2:-6}
maps=(first-line river-port landscape-lab demo-town demo-forest demo-ground demo-coast demo-bridges demo-destruction demo-cover hostomel)
seeds='[1,2,3,4,5,6,7,8,9,10]'
bin=./target/release/headless
mkdir -p "$out"
cfg=$(mktemp -d)
for map in "${maps[@]}"; do
  echo "{\"map\":\"$map\",\"maxTicks\":27000,\"seeds\":$seeds,\"ai0\":[\"ukraine-balanced\",\"ukraine-rush\"],\"ai1\":[\"russia-balanced\",\"russia-rush\"]}" > "$cfg/personalities-$map.json"
  echo "{\"map\":\"$map\",\"maxTicks\":27000,\"seeds\":$seeds,\"ai0\":[\"ukraine-balanced\"],\"ai1\":[\"russia-balanced\"],\"difficulty0\":[\"easy\",\"medium\",\"hard\",\"brutal\"],\"difficulty1\":[\"easy\",\"medium\",\"hard\",\"brutal\"]}" > "$cfg/difficulties-$map.json"
done
ls "$cfg"/*.json | xargs -P "$jobs" -I{} sh -c 'n=$(basename {}); '"$bin"' tournament {} > '"$out"'/$n'
rm -rf "$cfg"
