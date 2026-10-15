#!/bin/sh
# bundles src → <repo>/game/game.js and copies index.html to <repo>/index.html
R=${1:-/home/claude/holdout-repo}
V=$(cd $R/assets/i95 && python3 -c "import hashlib,os,json;print(json.dumps({f:hashlib.md5(open(f,'rb').read()).hexdigest()[:10] for f in sorted(os.listdir('.'))}))")
npx esbuild src/main.ts --bundle --minify --format=esm --target=es2020 --define:__I95V__="$V" --outfile=$R/game/game.js --log-level=warning
cp index.html $R/index.html
