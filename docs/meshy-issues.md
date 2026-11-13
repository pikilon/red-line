# Meshy Realistic Assets — Known Issues

Tracked on branch `feat/meshy-realistic-assets` (base commit `fa275e5`, PR #494).

## Open Issues

1. **Buildings remain visible through fog of war**
   - In the game view (`localhost:5173/?viewer`), buildings appear fully lit/visible even inside unexplored/shrouded fog-of-war areas instead of being hidden or darkened by fog.
   - Likely related to Meshy GLB materials or how `client/src/render/features/terrainModels.ts` / `client/src/render/features/renderers/civil.ts` / `client/src/render/entities.ts` integrate with fog-of-war visibility/shading.

2. **Grass renders as solid black**
   - Grass terrain patches render pitch black (while dirt and roads are visible).
   - Likely related to the regenerated `client/public/textures/grass.webp` (from `tools/asset-pipeline/meshy_terrain_textures.py`) or its format/alpha/color channels when sampled by the terrain shader/renderer.
