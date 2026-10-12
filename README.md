# Holdout

Browser zombie-apocalypse squad game: base management, overwatch command, first-person control.
Static site (three.js r128). Assets are meshopt-compressed `.glb` with WebP textures in `assets/`,
loaded per screen: lobby packs at boot, field packs + the picked map on Deploy.

**Texture quality** (Log tab → Graphics): High = 2K inside the packs. Ultra = 4K maps in `assets/tex4k/`
(manifest `tex4k.json`) streamed in after the 2K ones show; default on desktop, off on touch devices.
If the GPU loses its context (out of memory) the game drops to High and reloads.

## Credits
- Operators: "Modular Casual Soldier" kit · Survivalist by Slayver (CGTrader)
- Viewmodels: "Animated AKs-74u" by Vlasov Daniil (CC BY 4.0) · "Mark 23 Animated (Free)" by BarcodeGames / notatree
- Zombie + rifle animations: Mixamo
- Kenney city/car/survival/nature kits (CC0) · textures: ambientCG and Poly Haven (CC0)
- Metro district: user-supplied CityGenerator export, textured with CC0 ambientCG / Poly Haven maps

Third-party models keep their own licenses; check redistribution terms before making this public.


## Streaming architecture
```
boot (~12 MB): lobby packs ─► menu in ~3 s
Deploy: field packs + Metro mats_lo.glb (0.7 MB) ─► playing
        └─ 3D Tiles quadtree (assets/metro/tileset.json, 85 tiles, meshopt) streams by camera / screen error
        └─ background: mats_ktx2.glb (Basis KTX2, GPU-compressed) swaps into shared materials (WebP fallback: mats.glb)
repeat visits: sw.js serves every content-hashed asset (?v=hash) from Cache Storage
```
- Tiles: L0 1 tile (90k tris) → L3 8×8 full detail (6.2M tris total). Tiles carry geometry only; materials resolve by name from the library.
- 3DTilesRendererJS 0.3.46 and three r128's KTX2Loader are bundled (`assets/lib/`) against the game's global THREE.
- `HOLDOUT_MANIFEST` in index.html maps every asset to its content hash; tileset content URIs are hashed too.
