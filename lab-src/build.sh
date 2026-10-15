#!/bin/sh
# usage: sh build.sh   (bundles src/main.ts → ../lab/lab.js, versioning the I-95 asset URLs)
V=$(cd ../assets/i95 && python3 -c "import hashlib,os,json;print(json.dumps({f:hashlib.md5(open(f,'rb').read()).hexdigest()[:10] for f in sorted(os.listdir('.'))}))")
npx esbuild src/main.ts --bundle --minify --format=esm --target=es2020 --define:__I95V__="$V" --outfile=../lab/lab.js
