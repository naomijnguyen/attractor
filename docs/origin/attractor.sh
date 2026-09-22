#!/bin/bash
# Title        attractor (origin) — the first version, preserved
# Purpose      Historical artifact, not runnable software. This is the earliest
#              surviving attractor: a read-only shell client that curled the
#              claude-chat Worker and drew basin weights as ASCII bars. The
#              engine was TypeScript in the Worker; this was only the viewer.
#              Kept because it is the link between claude-chat and this repo.
# Author       Jennifer Naomi Nguyen
# Canonical    copy of claude-chat worker/src/attractor @ 2026-03-02 — do not edit
#              Its living descendant is cli/attractor in this repo.
# Updated      2026-09-19
# Dependencies none — DO NOT RUN. The endpoint is redacted, and the keyword
#              print below is a syntax error before Python 3.12 (nested same-type
#              quotes in an f-string), which cli/attractor later fixed.
#
# Preserved verbatim except API_URL, redacted from a live deployment URL.
# See cli/attractor for what six months changed.

#!/bin/bash
# ═══════════════════════════════════════════════
# attractor — View the Jen Attractor status
# ═══════════════════════════════════════════════
# Usage:  attractor          (show current state)
#         attractor history   (show evolution over time)

API_URL="https://REDACTED.workers.dev"  # was a live deployment
TOKEN_FILE="$HOME/.claude/attractor-token"

# Check for auth token
if [ ! -f "$TOKEN_FILE" ]; then
  echo "No token found. Run this first:"
  echo "  curl -s -X POST $API_URL/api/auth/login -H 'Content-Type: application/json' -d '{\"password\":\"YOUR_PASSWORD\"}' | jq -r .token > $TOKEN_FILE"
  exit 1
fi
TOKEN=$(cat "$TOKEN_FILE")

if [ "$1" = "history" ]; then
  # Show evolution over time
  curl -s "$API_URL/api/attractor/history" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json

data = json.load(sys.stdin)
history = data.get('history', [])

if not history:
    print('No history yet.')
    sys.exit()

# Get all basin IDs from the first snapshot
basin_ids = [b['id'] for b in history[0]['basins']]

# Header
print(f\"{'Timestamp':<22}\", end='')
for bid in basin_ids:
    label = bid[:10].title()
    print(f'{label:>12}', end='')
print()
print('-' * (22 + 12 * len(basin_ids)))

# Rows
for snap in history:
    ts = snap['timestamp'][:16].replace('T', ' ')
    print(f'{ts:<22}', end='')
    weights = {b['id']: b['weight'] for b in snap['basins']}
    for bid in basin_ids:
        w = weights.get(bid, 0)
        bar = round(w * 10) * '|'
        print(f'{w*100:>6.0f}% {bar:<4}', end='')
    print()
"
else
  # Show current state
  curl -s "$API_URL/api/attractor" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json

data = json.load(sys.stdin)
if not data.get('initialized'):
    print('Attractor not initialized yet.')
    sys.exit()

d = data['state']
phase = d['phase']
entropy = d['entropy']
traj = d['meta']['recentTrajectory']
updates = d['updateCount']
dominant = d['meta']['dominantBasin']

print()
print('  The Jen Attractor')
print('  ' + '=' * 40)
print(f'  Phase {phase} | Entropy: {entropy:.3f} | {traj.upper()}')
print(f'  Updates: {updates} | Dominant: {dominant}')
print()

# Sort basins by weight
basins = sorted(d['basins'], key=lambda x: -x['weight'])

# Find max weight for bar scaling
max_w = max(b['weight'] for b in basins)

for b in basins:
    label = b['label']
    weight = b['weight']
    pct = weight * 100
    convos = b['conversationCount']
    conns = b['connections']

    # Trend arrow from trajectory
    t = b['trajectory']
    if len(t) >= 2:
        diff = t[-1] - t[-2]
        arrow = ' ^^' if diff > 0.05 else ' ^' if diff > 0 else ' v' if diff < -0.05 else ' ~' if diff < 0 else ' ='
    else:
        arrow = ''

    # Visual bar
    bar_len = int((weight / 1.0) * 30)
    bar = '#' * bar_len + '.' * (30 - bar_len)

    print(f'  {label:<18} {pct:5.1f}%{arrow}  [{bar}]  ({convos} convos)')

    # Show connections indented
    if conns:
        print(f'                     -> {', '.join(conns)}')

# Emerging patterns
if d.get('emerging'):
    print()
    print('  Emerging patterns:')
    for e in d['emerging']:
        print(f'    * {e}')

# Keywords spotlight — show top basin's keywords
print()
top = basins[0]
print(f'  Top keywords ({top[\"label\"]}):')
kws = top['keywords'][:6]
print(f'    {', '.join(kws)}')
print()
"
fi
