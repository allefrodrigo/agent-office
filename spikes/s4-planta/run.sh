#!/bin/bash
# usage: run.sh <view iso|2d> <terreo antes|lounge|copa> <outprefix> <zoom>
set -e
W=${SPIKE_WT:-/Users/mac-allef/Playground/agents-2d/.agent-office/worktrees/margaret-s4-planta}
VIEW=$1; TER=$2; OUT=$3; Z=${4:-1}
SETUP=$(cat $(dirname $0)/setup.js); CAM=$(cat $(dirname $0)/cam.js)
E1="$CAM; $SETUP; __s4cam(1, 16, 13, $Z)"
E2="__s4cam(2, 16, 13, $Z)"
E3="__s4cam(0, 16, 13, $Z)"
cd $W
AGENT_OFFICE_DATA_DIR=$(mktemp -d) AGENT_OFFICE_VIEW=$VIEW AGENT_OFFICE_SPIKE_TERREO=$TER \
AGENT_OFFICE_SHOTS="$OUT:5000,7000,9000" AGENT_OFFICE_EVAL="$E1|||$E2|||$E3" \
npx electron . 2>&1 | grep -E "shot|eval|rror" | head -20
