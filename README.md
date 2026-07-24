# The Last Promise

A 3D first-person psychological horror puzzle game built with Three.js and Vite.

## Requirements

*   Node.js (v18 or higher)
*   npm

## Installation & Running

1. Open your terminal in this directory (`TheLastPromise`).
2. Run the following command to install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. The game will automatically open in your default browser at `http://localhost:3000`.

## The Agenda / Objective
You play as Arjun, returning to your abandoned village to fulfill a broken promise to your sister, Meera. Her restless spirit now haunts the area.
**Your goal is to:**
1. Explore the village and find the key to unlock the Forest Gate.
2. Traverse the Forest Path while avoiding Meera's Ghost.
3. Collect all 4 of Meera's Diary Pages to understand what happened to her.
4. Unlock the Final Ritual Room to free her soul (Good Ending).
If Meera catches you, you will be trapped forever (Bad Ending).

## Controls
*   **WASD:** Move
*   **Shift:** Sprint
*   **E:** Interact (Read notes, pick up keys, open doors)
*   **F:** Toggle Flashlight

## Assets & 3D Models (For Developers)
This build is configured with Vite and uses `GLTFLoader` to load the ghost model from `public/models/ghost.glb`. To swap in a different model:
1. Download `.gltf` or `.glb` models (e.g., from Sketchfab).
2. Place them in the `public/models` directory.
3. Point the `gltfLoader.load(...)` call in `buildEnvironment()` (`src/main.js`) at the new file.

**Current ghost model attribution**: `public/models/ghost.glb` is the "RiggedFigure" sample asset from the [Khronos Group glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) repository, © 2017 Cesium, licensed [CC-BY 4.0 International](https://creativecommons.org/licenses/by/4.0/). It's a plain, untextured test rig (no gendered branding/clothing), tinted pale in code to read as a spirit — a free, directly-downloadable placeholder used to verify the animated-3D-model pipeline. Swap in a proper character model before shipping for real.

**Trees**: the standing forest trees are procedural (instanced trunk + foliage cones, built in code — not a downloaded model). Photoreal photoscan trees were evaluated but are hundreds of MB of geometry, impractical for the web. The scattered dead **logs** on the ground are real photoscan props from [Poly Haven](https://polyhaven.com/) (`dead_tree_trunk`, `dead_tree_trunk_02`), CC0. To use higher-fidelity standing trees, drop a web-optimized (game-ready, low-to-mid poly) `.glb` into `public/models/` and point `buildForest()`/a GLTF loader in `src/main.js` at it.

**Grass** is real instanced blade geometry (not a texture), tiling around the player with vertex-shader wind. **Graphics effects** (bloom, flashlight shadows, atmospheric fog, ambient occlusion) are toggleable in the in-game Settings menu.
