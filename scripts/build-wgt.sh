#!/bin/bash
# Builds dist/TVHome.wgt (native Tizen web app) from app/ + native/.
# Signing: author cert path/password from TVHOME_AUTHOR_P12 / TVHOME_AUTHOR_PWD, Tizen "public"
# distributor (what TizenBrew's own releases use). Needs: npm i -g https://github.com/reisxd/tizen.js/tarball/main
set -e
cd "$(dirname "$0")/.."
: "${TVHOME_AUTHOR_P12:?set TVHOME_AUTHOR_P12}"; : "${TVHOME_AUTHOR_PWD:?set TVHOME_AUTHOR_PWD}"
rm -rf build dist && mkdir -p build dist
cp app/index.html app/style.css app/app.js app/config.js build/
cp native/config.xml native/icon.png build/
(cd build && tizenjs build . -t wgt -o ../dist/TVHome.wgt --author "$TVHOME_AUTHOR_P12" --authorPwd "$TVHOME_AUTHOR_PWD" -p public)
rm -rf build
echo "built dist/TVHome.wgt"
