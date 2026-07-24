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
This professional build is configured with Vite and includes `GLTFLoader`. 
While it currently uses procedural geometry for instant, zero-setup testing, you can easily swap the primitive shapes for real 3D models:
1. Download `.gltf` or `.glb` models (e.g., from Sketchfab).
2. Place them in the `public/models` directory.
3. Use the instantiated `gltfLoader` in `src/main.js` to load them into the scene.
