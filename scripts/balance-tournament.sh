#!/usr/bin/env bash
# Runs the balance tournaments of docs/balance/ (spec 05 §8, AC-05-22).
# Usage: scripts/balance-tournament.sh <out-dir> [jobs] [factionA factionB]
# Factions default to `ukraine russia`; AI ids are `<faction>-balanced` and
# `<faction>-rush`. LIMITATION: the tournament config only picks the AI ids
# (ai0/ai1), not the start factions: each map fixes them (player 0 / player 1).
# A pair such as `usa russia` therefore only means something on maps whose
# players start as those factions; otherwise the AI plays the wrong side.
# Writes <out-dir>/personalities-<map>.json (4 personality pairs, Medium) and
# <out-dir>/difficulties-<map>.json (balanced vs balanced, all 4x4 levels).
set -euo pipefail
out=${1:?usage: balance-tournament.sh <out-dir> [jobs] [factionA factionB]}
jobs=${2:-6}
fa=${3:-ukraine}
fb=${4:-russia}
maps=(first-line river-port landscape-lab demo-town demo-forest demo-ground demo-coast demo-bridges demo-destruction demo-cover hostomel)
seeds='[1,2,3,4,5,6,7,8,9,10]'
bin=./target/release/headless
mkdir -p "$out"
cfg=$(mktemp -d)
for map in "${maps[@]}"; do
  echo "{\"map\":\"$map\",\"maxTicks\":27000,\"seeds\":$seeds,\"ai0\":[\"${fa}-balanced\",\"${fa}-rush\"],\"ai1\":[\"${fb}-balanced\",\"${fb}-rush\"]}" > "$cfg/personalities-$map.json"
  echo "{\"map\":\"$map\",\"maxTicks\":27000,\"seeds\":$seeds,\"ai0\":[\"${fa}-balanced\"],\"ai1\":[\"${fb}-balanced\"],\"difficulty0\":[\"easy\",\"medium\",\"hard\",\"brutal\"],\"difficulty1\":[\"easy\",\"medium\",\"hard\",\"brutal\"]}" > "$cfg/difficulties-$map.json"
done
ls "$cfg"/*.json | xargs -P "$jobs" -I{} sh -c 'n=$(basename {}); '"$bin"' tournament {} > '"$out"'/$n'
rm -rf "$cfg"
