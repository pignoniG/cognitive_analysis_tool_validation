# Vendored three.js

`three-slim.module.js` is three.js r186 (0.186.1, MIT, see `three.LICENSE`) reduced to the classes the presenter
uses, so the page runs without a network connection. It is the calibration presenter's build (cwtool
`docs/calibration-tool/vendor/`) with the classes for discs, groups and scene textures added. Rebuild it with:

```sh
echo "export { WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, SphereGeometry, CircleGeometry, RingGeometry, PlaneGeometry, MeshBasicMaterial, BackSide, DoubleSide, SRGBColorSpace, NoToneMapping, Texture, TextureLoader, Color, MathUtils, REVISION } from 'three';" > entry.js
npm i three@0.186.1 esbuild
npx esbuild entry.js --bundle --minify --format=esm --outfile=three-slim.module.js
```
