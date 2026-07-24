import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';

const noise = new SimplexNoise();

// --- GAME STATE ---
let camera, scene, renderer, controls, composer;
let raycaster, flashlight;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let sprint = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const playerRadius = 0.4; // approximate player collision radius for tree collision
let pagesCollected = 0;
const totalPages = 4; // Limit to 4 pages
let isGameOver = false;
let readingPage = false;
let pendingPage = null; // Track page being read
let headBobTimer = 0;
let gameStarted = false;

// --- ACCURATE MECHANICS ---
let stamina = 100;
let battery = 100;
let flashlightOn = true;

// --- ENTITIES & ASSETS ---
let interactables = [];
let ghost;
let ghostMixer; // drives the ghost model's walk animation
let ghostWalkAction;
let ghostGroundOffset = 4; // vertical offset from ground to the model's origin, computed once it loads
let ghostActive = false;
let staticIntensity = 0;
const pageTextures = [];
const treeColliders = []; // {x, z, radius} — populated once tree1.obj finishes loading

// --- UI ELEMENTS ---
const splashScreen = document.getElementById('splash-screen');
const blocker = document.getElementById('blocker');
const mainMenu = document.getElementById('main-menu');
const pauseMenu = document.getElementById('pause-menu');
const settingsPanel = document.getElementById('settings-panel');
const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');
const quitBtn = document.getElementById('quit-btn');
const mainSettingsBtn = document.getElementById('main-settings-btn');
const pauseSettingsBtn = document.getElementById('pause-settings-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const masterVolumeSlider = document.getElementById('master-volume-slider');
const musicVolumeSlider = document.getElementById('music-volume-slider');
const sfxVolumeSlider = document.getElementById('sfx-volume-slider');
const sensitivitySlider = document.getElementById('sensitivity-slider');
const fullscreenToggle = document.getElementById('fullscreen-toggle');
const storyText = document.getElementById('story-text');
const pageCountDisplay = document.getElementById('page-count');
const objectiveText = document.getElementById('objective-text');
const crosshair = document.getElementById('crosshair');
const interactPrompt = document.getElementById('interact-prompt');
const staminaBar = document.getElementById('stamina-bar');
const batteryBar = document.getElementById('battery-bar');
const pageOverlay = document.getElementById('page-overlay');
const pageOverlayImg = document.getElementById('page-overlay-img');
const staticOverlay = document.getElementById('static-overlay');

// --- PANEL NAVIGATION ---
let settingsReturnTo = 'main'; // which panel Settings' Back button returns to

function showPanel(name) {
    mainMenu.classList.toggle('hidden', name !== 'main');
    pauseMenu.classList.toggle('hidden', name !== 'pause');
    settingsPanel.classList.toggle('hidden', name !== 'settings');
}

// --- AUDIO ---
const listener = new THREE.AudioListener();
let noiseGain; // For static audio
const soundAmbience = new THREE.Audio(listener);
const soundFootstep = new THREE.Audio(listener);
const soundPickup = new THREE.Audio(listener);
const soundFail = new THREE.Audio(listener);
const soundStatic = new THREE.Audio(listener);
const soundMenu = new THREE.Audio(listener);
const soundIntro = new THREE.Audio(listener);
const soundStage1 = new THREE.Audio(listener);
const soundStage2 = new THREE.Audio(listener);
const soundStage3 = new THREE.Audio(listener);
const soundStage4 = new THREE.Audio(listener);
const stageTracks = [soundStage1, soundStage2, soundStage3, soundStage4];
let currentStage = -1;
const soundTension = new THREE.Audio(listener);
const soundBreath = new THREE.Audio(listener);
const soundFlashlight = new THREE.Audio(listener);
const soundPageOpen = new THREE.Audio(listener);
const soundCrash = new THREE.Audio(listener);
const soundZoom = new THREE.Audio(listener);
const stepBuffers = [];
const staticBuffers = [];
const audioLoader = new THREE.AudioLoader();

// --- SETTINGS STATE ---
let masterVolume = 1.0;
let musicVolume = 1.0;
let sfxVolume = 1.0;
const musicBaseVolumes = new Map(); // sound -> its designed base volume
const sfxBaseVolumes = new Map();

function registerMusic(sound, base) {
    musicBaseVolumes.set(sound, base);
    sound.setVolume(base * musicVolume * masterVolume);
}

function registerSfx(sound, base) {
    sfxBaseVolumes.set(sound, base);
    sound.setVolume(base * sfxVolume * masterVolume);
}

function getEffectiveVolume(sound) {
    if (musicBaseVolumes.has(sound)) return musicBaseVolumes.get(sound) * musicVolume * masterVolume;
    if (sfxBaseVolumes.has(sound)) return sfxBaseVolumes.get(sound) * sfxVolume * masterVolume;
    return sound.getVolume();
}

function applyVolumes() {
    musicBaseVolumes.forEach((base, sound) => sound.setVolume(base * musicVolume * masterVolume));
    sfxBaseVolumes.forEach((base, sound) => sound.setVolume(base * sfxVolume * masterVolume));
}

const loadingManager = new THREE.LoadingManager();
loadingManager.onLoad = function () {
    startBtn.innerText = "Start Game";
    startBtn.classList.remove('disabled');
};

init();
animate();

function init() {
    // Browsers suspend the shared AudioContext until a genuine user gesture
    // resumes it. Resume on the very first interaction anywhere on the page
    // (not tied to any specific button) so menu music and gameplay audio are
    // reliably audible as early as the browser's autoplay policy allows.
    function resumeAudioContext() {
        const ctx = THREE.AudioContext.getContext();
        if (ctx.state === 'suspended') ctx.resume();
    }
    document.addEventListener('pointerdown', resumeAudioContext, { once: true });
    document.addEventListener('keydown', resumeAudioContext, { once: true });

    // --- SPLASH SCREEN ---
    setTimeout(() => {
        if(splashScreen) {
            // Unhide the menu (and start its music) BEFORE the splash fade
            // begins, not after: #blocker sits invisible behind the still-
            // opaque splash (higher z-index) and is what gets revealed as the
            // splash fades, instead of a flash of the raw 3D scene underneath.
            blocker.classList.remove('hidden');
            playMenuMusic();
            splashScreen.style.opacity = '0';
            setTimeout(() => {
                splashScreen.style.display = 'none';
            }, 2000);
        }
    }, 4500);

    // --- SETUP SCENE ---
    startBtn.innerText = "Loading Assets...";
    startBtn.classList.add('disabled');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010101); 
    scene.fog = new THREE.FogExp2(0x010101, 0.002); // VERY light fog so the skybox can pierce through

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 1.6; 
    camera.add(listener);
    scene.add(camera);

    raycaster = new THREE.Raycaster();
    raycaster.near = 0.1;
    raycaster.far = 3.5;

    const ambientLight = new THREE.AmbientLight(0x444444); // Dimmer ambient light for horror atmosphere
    scene.add(ambientLight);

    // Three.js r155+ uses physically-correct (candela) light units by default, which
    // divide point/spot light intensity by an extra 4*PI steradians compared to the
    // old model this value (4.5) was tuned for — at this scale it renders as
    // essentially invisible. Multiplying by 4*PI restores the originally-intended
    // brightness under the current renderer.
    const flashlightIntensity = 4.5 * 4 * Math.PI;
    flashlight = new THREE.SpotLight(0xffeedd, flashlightIntensity, 120, Math.PI / 4, 0.5, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);

    controls = new PointerLockControls(camera, document.body);

    startBtn.addEventListener('click', function () {
        if(startBtn.classList.contains('disabled')) return;
        gameStarted = true;
        controls.lock();
    });

    resumeBtn.addEventListener('click', function () {
        controls.lock();
    });

    restartBtn.addEventListener('click', function () {
        location.reload();
    });

    quitBtn.addEventListener('click', function () {
        location.reload();
    });

    mainSettingsBtn.addEventListener('click', function () {
        settingsReturnTo = 'main';
        showPanel('settings');
    });

    pauseSettingsBtn.addEventListener('click', function () {
        settingsReturnTo = 'pause';
        showPanel('settings');
    });

    settingsBackBtn.addEventListener('click', function () {
        showPanel(settingsReturnTo);
    });

    fullscreenToggle.addEventListener('change', function () {
        if (fullscreenToggle.checked) {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => console.log(err));
            }
        } else if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => console.log(err));
        }
    });

    masterVolumeSlider.addEventListener('input', function () {
        masterVolume = masterVolumeSlider.value / 100;
        applyVolumes();
    });
    musicVolumeSlider.addEventListener('input', function () {
        musicVolume = musicVolumeSlider.value / 100;
        applyVolumes();
    });
    sfxVolumeSlider.addEventListener('input', function () {
        sfxVolume = sfxVolumeSlider.value / 100;
        applyVolumes();
    });
    sensitivitySlider.addEventListener('input', function () {
        controls.pointerSpeed = sensitivitySlider.value / 100;
    });

    controls.addEventListener('lock', function () {
        blocker.style.display = 'none';
        stopMenuMusic();
        if (currentStage < 0) updateStageMusic(0); // first time gameplay actually starts
    });

    controls.addEventListener('unlock', function () {
        // Reset held-key/velocity state — key releases can be missed while the
        // pointer is unlocked (alt-tab, Escape), which would otherwise leave the
        // player "stuck" walking in a direction once they resume.
        moveForward = moveBackward = moveLeft = moveRight = false;
        sprint = false;
        velocity.set(0, 0, 0);

        if (gameStarted && !isGameOver && !readingPage) {
            blocker.style.display = 'flex';
            showPanel('pause');
            if(soundFootstep.isPlaying) soundFootstep.pause();
            playMenuMusic();
        }
    });

    // If the browser refuses pointer lock (e.g. re-locking too soon after
    // Escape, or a permissions/iframe restriction), don't leave the player
    // stuck — the blocker/panel that was already showing simply stays put.
    document.addEventListener('pointerlockerror', function () {
        blocker.style.display = 'flex';
    });

    const onKeyDown = function (event) {
        // While actively playing or reading a page, swallow every keystroke
        // before it can reach the browser — otherwise stray, non-control keys
        // (e.g. Firefox's "/" quick-find) can pop open browser UI mid-game.
        // Escape is excluded: it always releases pointer lock at the browser
        // level regardless of preventDefault, so there's nothing to gain by
        // intercepting it, and doing so could mask that native behavior.
        if ((controls.isLocked || readingPage) && event.code !== 'Escape') {
            event.preventDefault();
        }
        if(readingPage) {
            // Escape is deliberately NOT handled here: Escape always releases
            // pointer lock at the browser level regardless of preventDefault,
            // so closing the page on Escape would also pop the pause menu open
            // underneath it in the same tick. KeyE/click are unambiguous.
            if (event.code === 'KeyE') {
                closePage();
            }
            return;
        }

        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight = true; break;
            case 'ShiftLeft': case 'ShiftRight': sprint = true; break;
            case 'KeyE': interact(); break;
            case 'KeyF':
                if(battery > 0) {
                    flashlightOn = !flashlightOn;
                    flashlight.visible = flashlightOn;
                    if (soundFlashlight.isPlaying) soundFlashlight.stop();
                    soundFlashlight.play();
                }
                break;
        }
    };

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight = false; break;
            case 'ShiftLeft': case 'ShiftRight': sprint = false; break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    // Listen on document because pointer lock directs all events to document.body
    document.addEventListener('mousedown', () => {
        if (readingPage) closePage();
    });

    // Setup White Noise for Static
    const audioCtx = THREE.AudioContext.getContext();
    const bufferSize = audioCtx.sampleRate * 2; 
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0;
    whiteNoise.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    whiteNoise.start();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // POST-PROCESSING
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const filmPass = new FilmPass(0.3, 0.05, 1500, false); // Much lower noise intensity (0.3 instead of 1.5)
    composer.addPass(filmPass);

    window.addEventListener('resize', onWindowResize);

    loadAssets();
}

function loadAssets() {
    audioLoader.load('assets/ambience.mp3', function(buffer) {
        soundAmbience.setBuffer(buffer);
        soundAmbience.setLoop(true);
        registerMusic(soundAmbience, 0.4);
    });
    audioLoader.load('assets/step1.mp3', function(buffer) {
        soundFootstep.setBuffer(buffer);
        soundFootstep.setLoop(false);
        registerSfx(soundFootstep, 1.0);
        stepBuffers.push(buffer);
    });
    for (let i = 2; i <= 12; i++) {
        audioLoader.load(`assets/step${i}.mp3`, function(buffer) {
            stepBuffers.push(buffer);
        });
    }
    audioLoader.load('assets/_fail_.ogg', function(buffer) {
        soundFail.setBuffer(buffer);
        registerSfx(soundFail, 1.0);
    });
    audioLoader.load('assets/static1.mp3', function(buffer) {
        soundStatic.setBuffer(buffer);
        soundStatic.setLoop(true);
        soundStatic.setVolume(0);
        soundStatic.play();
        staticBuffers.push(buffer);
    });
    audioLoader.load('assets/static2.mp3', function(buffer) {
        staticBuffers.push(buffer);
    });
    audioLoader.load('assets/static3.mp3', function(buffer) {
        staticBuffers.push(buffer);
    });
    audioLoader.load('assets/pickup.mp3', function(buffer) {
        soundPickup.setBuffer(buffer);
        registerSfx(soundPickup, 1.0);
    });
    audioLoader.load('assets/menu.mp3', function(buffer) {
        soundMenu.setBuffer(buffer);
        soundMenu.setLoop(true);
        registerMusic(soundMenu, 0.5);
    });
    audioLoader.load('assets/intro.mp3', function(buffer) {
        soundIntro.setBuffer(buffer);
        registerMusic(soundIntro, 0.8);
        // Not auto-played: it read as an unexplained "footstep-like" sound
        // showing up in the main menu with no clear trigger.
    });
    const stageFiles = ['stage1.mp3', 'stage2.mp3', 'stage3.mp3', 'stage4.mp3'];
    stageFiles.forEach((file, i) => {
        audioLoader.load(`assets/${file}`, function(buffer) {
            stageTracks[i].setBuffer(buffer);
            stageTracks[i].setLoop(true);
            registerMusic(stageTracks[i], 0.5);
        });
    });
    audioLoader.load('assets/tension.mp3', function(buffer) {
        soundTension.setBuffer(buffer);
        soundTension.setLoop(true);
        registerMusic(soundTension, 0.3);
    });
    audioLoader.load('assets/breath.mp3', function(buffer) {
        soundBreath.setBuffer(buffer);
        soundBreath.setLoop(true);
        soundBreath.setVolume(0);
    });
    audioLoader.load('assets/flashlight.mp3', function(buffer) {
        soundFlashlight.setBuffer(buffer);
        registerSfx(soundFlashlight, 0.8);
    });
    audioLoader.load('assets/page.mp3', function(buffer) {
        soundPageOpen.setBuffer(buffer);
        registerSfx(soundPageOpen, 0.8);
    });
    audioLoader.load('assets/crash.mp3', function(buffer) {
        soundCrash.setBuffer(buffer);
        registerSfx(soundCrash, 1.0);
    });
    audioLoader.load('assets/zoom.mp3', function(buffer) {
        soundZoom.setBuffer(buffer);
        registerSfx(soundZoom, 1.0);
    });

    const textureLoader = new THREE.TextureLoader(loadingManager);
    
    // Load Unique Pages (only totalPages are ever placed — see buildEnvironment)
    for(let i = 1; i <= totalPages; i++) {
        pageTextures.push(textureLoader.load(`assets/page${i}.png`));
    }

    // Skybox
    const cubeTextureLoader = new THREE.CubeTextureLoader(loadingManager);
    cubeTextureLoader.setPath('assets/sky1/');
    const skybox = cubeTextureLoader.load([
        'right.png', 'left.png',
        'top.png', 'bottom.png',
        'front.png', 'back.png'
    ]);
    scene.background = skybox;

    buildEnvironment(textureLoader);
}

// --- MUSIC / AUDIO STATE HELPERS ---

function fadeAudioVolume(sound, targetVolume, duration) {
    const startVolume = sound.getVolume();
    const startTime = performance.now();
    function step() {
        const t = Math.min((performance.now() - startTime) / duration, 1);
        sound.setVolume(startVolume + (targetVolume - startVolume) * t);
        if (t < 1) {
            requestAnimationFrame(step);
        } else if (targetVolume === 0) {
            sound.stop();
        }
    }
    step();
}

function fadeOutAndStop(sound, duration = 1000) {
    if (sound.isPlaying) fadeAudioVolume(sound, 0, duration);
}

function fadeIn(sound, duration = 1000) {
    if (!sound.isPlaying) {
        sound.setVolume(0);
        sound.play();
    }
    fadeAudioVolume(sound, getEffectiveVolume(sound), duration);
}

function updateStageMusic(pages) {
    const idx = Math.min(pages, stageTracks.length - 1);
    if (idx === currentStage) return;
    if (currentStage >= 0) fadeOutAndStop(stageTracks[currentStage]);
    fadeIn(stageTracks[idx]);
    currentStage = idx;
}

function playMenuMusic() {
    if (soundAmbience.isPlaying) soundAmbience.pause();
    if (currentStage >= 0 && stageTracks[currentStage].isPlaying) stageTracks[currentStage].pause();
    if (soundTension.isPlaying) soundTension.pause();
    if (soundBreath.isPlaying) soundBreath.pause();
    if (!soundMenu.isPlaying) soundMenu.play();
}

function stopMenuMusic() {
    if (soundMenu.isPlaying) soundMenu.pause();
    if (!soundAmbience.isPlaying) soundAmbience.play();
    if (currentStage >= 0 && !stageTracks[currentStage].isPlaying) stageTracks[currentStage].play();
    if (ghostActive) {
        if (!soundTension.isPlaying) soundTension.play();
        if (!soundBreath.isPlaying) soundBreath.play();
    }
}

function buildEnvironment(textureLoader) {
    const floorTexture = textureLoader.load('assets/grass_texture.png'); 
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(100, 100);

    const floorGeometry = new THREE.PlaneGeometry(400, 400, 100, 100);
    
    // Undulating terrain using Sin/Cos noise
    const pos = floorGeometry.attributes.position;
    for(let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        // Much smoother, lower noise so it doesn't block the camera
        const z = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 0.4;
        pos.setZ(i, z);
    }
    floorGeometry.computeVertexNormals();

    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 1.0 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Load actual 3D Tree Model
    const treeTexture = textureLoader.load('assets/tree_brown.png');
    treeTexture.wrapS = THREE.RepeatWrapping;
    treeTexture.wrapT = THREE.RepeatWrapping;
    treeTexture.repeat.set(1, 3); // Repeat bark texture vertically

    const objLoader = new OBJLoader(loadingManager);
    objLoader.load('assets/tree1.obj', (treeObj) => {
        const treeMat = new THREE.MeshStandardMaterial({ 
            map: treeTexture, 
            color: 0xffffff, // Pure white base to let brown bark show perfectly
            roughness: 1.0 
        }); 
        treeObj.traverse((child) => {
            if (child.isMesh) {
                child.geometry.computeVertexNormals(); // Ensure proper 3D shading
                child.material = treeMat;
            }
        });

        const numTrees = 200;
        const forestRadius = 150;
        const trees = [];
        
        for (let i = 0; i < numTrees; i++) {
            let r = 15 + Math.random() * (forestRadius - 15);
            let theta = Math.random() * Math.PI * 2;
            let x = r * Math.cos(theta);
            let z = r * Math.sin(theta);

            const clone = treeObj.clone();
            const yOffset = Math.sin(x * 0.02) * Math.cos(z * 0.02) * 0.4;
            clone.position.set(x, yOffset, z);
            clone.rotation.y = Math.random() * Math.PI;
            clone.scale.set(1.5, 3 + Math.random()*1.5, 1.5); // Thinner, realistic trunks
            scene.add(clone);
            trees.push(clone);
            treeColliders.push({ x: x, z: z, radius: 1.5 }); // trunk radius: tree1.obj base geometry (~1.0) * scale (1.5)
        }

        // Place 8 pages on 8 random trees
        const pageGeo = new THREE.PlaneGeometry(0.4, 0.6);
        const shuffledTrees = [...trees].sort(() => 0.5 - Math.random());
        
        for(let i=0; i<totalPages; i++) {
            const tree = shuffledTrees[i];
            const pTex = pageTextures[i];
            const pageMat = new THREE.MeshBasicMaterial({ map: pTex, side: THREE.DoubleSide });
            const page = new THREE.Mesh(pageGeo, pageMat);
            
            const angle = Math.atan2(-tree.position.z, -tree.position.x);
            page.position.set(
                tree.position.x + Math.cos(angle) * 1.5,
                tree.position.y + 1.5,
                tree.position.z + Math.sin(angle) * 1.5
            );
            page.rotation.y = -angle + Math.PI/2;
            page.userData = { type: 'note', id: i+1, textureUrl: `assets/page${i+1}.png` };
            scene.add(page);
            interactables.push(page);
        }
    });

    // Real animated 3D model instead of a flat billboard plane. Uses a plain,
    // untextured rigged figure (no gendered branding/clothing) rather than a
    // specific named character, tinted pale/cold to read as a spirit.
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.load('models/ghost.glb', (gltf) => {
        ghost = gltf.scene;

        ghost.traverse((child) => {
            if (child.isMesh && child.material) {
                // Skinned/animated meshes keep their bind-pose bounding volume
                // for frustum culling, which doesn't track how the animation
                // actually moves the geometry — up close this can cull parts
                // of the model (e.g. everything but the feet, near the
                // object's origin) even though they're plainly in view.
                child.frustumCulled = false;

                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((mat) => {
                    mat.color = new THREE.Color(0xdde8ee); // pale, cold ghostly tint
                    mat.transparent = true;
                    mat.opacity = 0.85;
                });
            }
        });

        // Normalize scale from the model's actual bounding box rather than a
        // guessed constant, since the source model's native units are unknown
        // here. Target height kept close to human scale — the first pass at
        // this used a much taller target and rendered far too large.
        const box = new THREE.Box3().setFromObject(ghost);
        const modelHeight = box.max.y - box.min.y;
        const targetHeight = 2.0;
        const scale = modelHeight > 0 ? targetHeight / modelHeight : 1;
        ghost.scale.setScalar(scale);
        // Distance from the model's origin down to its lowest point (feet),
        // so positioning code can place it exactly on the ground regardless
        // of whether the model's pivot is at its base or its center.
        ghostGroundOffset = -box.min.y * scale;

        ghost.position.set(0, ghostGroundOffset, 20);
        ghost.visible = false;
        scene.add(ghost);

        if (gltf.animations && gltf.animations.length > 0) {
            ghostMixer = new THREE.AnimationMixer(ghost);
            ghostWalkAction = ghostMixer.clipAction(gltf.animations[0]);
            ghostWalkAction.play();
        }
    });
}

function faceGhostTowards(dirX, dirZ) {
    ghost.rotation.y = Math.atan2(dirX, dirZ);
}

function checkTreeCollision(x, z) {
    for (let i = 0; i < treeColliders.length; i++) {
        const t = treeColliders[i];
        const dx = x - t.x;
        const dz = z - t.z;
        const minDist = t.radius + playerRadius;
        if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
}

function resolveTreeCollisions(prevX, prevZ) {
    const nx = camera.position.x;
    const nz = camera.position.z;

    if (!checkTreeCollision(nx, nz)) return; // no collision, nothing to do

    // Slide: keep the z-movement, cancel the x-movement
    if (!checkTreeCollision(prevX, nz)) {
        camera.position.x = prevX;
        return;
    }
    // Slide: keep the x-movement, cancel the z-movement
    if (!checkTreeCollision(nx, prevZ)) {
        camera.position.z = prevZ;
        return;
    }
    // Both axes blocked (corner case): cancel movement entirely
    camera.position.x = prevX;
    camera.position.z = prevZ;
}

function handleCrosshair() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(interactables);
    
    if (intersects.length > 0 && intersects[0].object.userData.type === 'note') {
        crosshair.classList.add('active');
        interactPrompt.classList.remove('hidden');
        return intersects[0].object;
    } else {
        crosshair.classList.remove('active');
        interactPrompt.classList.add('hidden');
        return null;
    }
}

function closePage() {
    if (!readingPage) return;
    
    pageOverlay.classList.add('hidden');
    readingPage = false;
    
    if (pendingPage) {
        pagesCollected++;
        pageCountDisplay.innerText = pagesCollected;

        if (soundPickup.isPlaying) soundPickup.stop();
        soundPickup.play();

        scene.remove(pendingPage);
        interactables.splice(interactables.indexOf(pendingPage), 1);
        pendingPage = null;

        if (pagesCollected === totalPages) {
            winGame();
        } else if (pagesCollected === 1 && !ghostActive) {
            // Spawn ghost on first page collection
            ghostActive = true;
            ghost.visible = true;
            teleportGhost();
            fadeIn(soundTension);
            soundBreath.setVolume(0);
            soundBreath.play();
        }

        updateStageMusic(pagesCollected);
    }
}

function interact() {
    const targetPage = handleCrosshair();
    if (targetPage && !readingPage) {
        pendingPage = targetPage;

        // Show correct page texture in overlay
        pageOverlayImg.src = targetPage.userData.textureUrl;

        readingPage = true;

        if (soundPageOpen.isPlaying) soundPageOpen.stop();
        soundPageOpen.play();

        // Hide the interact prompt so it doesn't bleed through
        crosshair.classList.remove('active');
        interactPrompt.classList.add('hidden');
        
        // Do not unlock controls to prevent browser click suppression
        pageOverlay.classList.remove('hidden');
    }
}

function teleportGhost() {
    // Reroll the static texture on each (re)spawn for variety across encounters
    if (staticBuffers.length > 0) {
        soundStatic.setBuffer(staticBuffers[Math.floor(Math.random() * staticBuffers.length)]);
    }

    // Teleport behind or to the side of the player, closer based on pages collected
    const baseDistance = Math.max(10, 60 - (pagesCollected * 10));
    
    // Pick a random angle BEHIND the player's current view
    const lookDir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    const angle = Math.atan2(lookDir.x, lookDir.z);
    
    // Add an offset between 90 and 270 degrees to spawn behind
    const randomOffset = (Math.PI / 2) + (Math.random() * Math.PI);
    const spawnAngle = angle + randomOffset;

    const spawnDistance = baseDistance + Math.random() * 20;

    ghost.position.x = camera.position.x + Math.sin(spawnAngle) * spawnDistance;
    ghost.position.z = camera.position.z + Math.cos(spawnAngle) * spawnDistance;
    
    const groundY = noise.noise(ghost.position.x * 0.05, ghost.position.z * 0.05) * 5;
    ghost.position.y = groundY + ghostGroundOffset;
    faceGhostTowards(camera.position.x - ghost.position.x, camera.position.z - ghost.position.z);
}

function updateGhostAI(delta) {
    if(!ghostActive) return;

    const ghostDistance = camera.position.distanceTo(ghost.position);
    
    if (ghostDistance < 2.0) {
        loseGame(); // Touched you
    }

    const ghostDir = new THREE.Vector3().subVectors(ghost.position, camera.position).normalize();
    const lookDir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    const dot = lookDir.dot(ghostDir);
    
    // Check if looking at ghost. No distance cap here: with one (60 units),
    // the ghost was unstoppable by staring whenever it was farther out than
    // that (e.g. right after a teleport, which can spawn it up to 80 units
    // away) — it would keep closing the distance regardless of the player's
    // behavior until it happened to cross under 60, which read as "it got me
    // even when I was looking right at it."
    const isLookingAtGhost = dot > 0.6;

    if(isLookingAtGhost) {
        // Staring at ghost -> Static builds up!
        const buildupRate = 0.25 + (pagesCollected * 0.1); // Reduced buildup rate for more reaction time
        staticIntensity += buildupRate * delta;

        if(staticIntensity >= 1.0) {
            loseGame();
        }
    } else {
        // Not looking at ghost -> Ghost moves towards you!
        staticIntensity = Math.max(0, staticIntensity - 0.5 * delta);

        // Move ghost towards player. NOTE: `ghostDir` points from the camera
        // TOWARD the ghost (needed above for the "looking at it" dot-product
        // check) — moving along it would push the ghost further away, so the
        // actual chase direction is its negation (ghost -> camera).
        const moveDir = ghostDir.clone().negate();
        const speed = 2.0 + (pagesCollected * 1.5);
        const moveStep = moveDir.multiplyScalar(speed * delta);
        ghost.position.add(moveStep);

        // Keep ghost on ground
        const groundY = noise.noise(ghost.position.x * 0.05, ghost.position.z * 0.05) * 5;
        ghost.position.y = groundY + ghostGroundOffset;
        faceGhostTowards(moveDir.x, moveDir.z);
        if (ghostMixer) ghostMixer.update(delta);

        // Teleportation mechanic: If ghost gets too far away, teleport closer behind player
        if (ghostDistance > 80) {
            teleportGhost();
        }
    }
    
    // Update visuals and audio for static
    staticOverlay.style.opacity = Math.min(staticIntensity, 1.0);
    const sfxLevel = sfxVolume * masterVolume;
    if (noiseGain) noiseGain.gain.value = staticIntensity * 0.5 * sfxLevel; // Raw generated static
    soundStatic.setVolume(staticIntensity * 0.6 * sfxLevel); // Recorded static texture layer
    soundBreath.setVolume(staticIntensity * sfxLevel); // Breathing intensifies with fear

    // Proximity cue: tension swells as the ghost draws near, even if you
    // aren't looking at it (staring already drives static/breath above).
    const proximity = Math.max(0, 1 - ghostDistance / 60);
    soundTension.setVolume(Math.max(0.3, proximity) * musicVolume * masterVolume);
}

function winGame() {
    isGameOver = true;
    controls.unlock();
    if(noiseGain) noiseGain.gain.value = 0; // Stop static sound
    soundStatic.setVolume(0);
    soundBreath.setVolume(0);
    playMenuMusic();
    mainMenu.innerHTML = `
        <h1 style="color: #4CAF50;" class="game-title">You Survived</h1>
        <p class="agenda-text">You found all 4 pages and escaped the forest.</p>
        <button onclick="location.reload()" class="menu-btn" style="margin-top: 30px;">Main Menu</button>
    `;
    showPanel('main');
    blocker.style.display = 'flex';
}

function loseGame() {
    if(isGameOver) return;
    isGameOver = true;
    controls.unlock();
    
    // Jumpscare
    if(!soundFail.isPlaying) soundFail.play();
    if(!soundCrash.isPlaying) soundCrash.play();
    if(!soundZoom.isPlaying) soundZoom.play();
    staticOverlay.style.opacity = 1.0;
    
    // Teleport ghost in front of face
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    ghost.position.set(
        camera.position.x + camDir.x * 2,
        camera.position.y,
        camera.position.z + camDir.z * 2
    );
    faceGhostTowards(-camDir.x, -camDir.z);

    setTimeout(() => {
        mainMenu.innerHTML = `
            <h1 style="color: #ff0000; font-size: 80px;" class="game-title">SHE GOT YOU</h1>
            <button onclick="location.reload()" class="menu-btn" style="margin-top: 30px;">Main Menu</button>
        `;
        showPanel('main');
        blocker.style.display = 'flex';
        document.body.style.backgroundColor = '#220000';
        soundStatic.setVolume(0);
        soundBreath.setVolume(0);
        playMenuMusic();
    }, 2000);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked === true && !isGameOver && !readingPage) {
        const time = performance.now();
        const delta = Math.min((time - prevTime) / 1000, 0.1); 

        handleCrosshair();

        let isMoving = moveForward || moveBackward || moveLeft || moveRight;
        let isSprinting = sprint && isMoving && stamina > 0;

        if (isSprinting) {
            stamina -= 15 * delta;
        } else {
            stamina += 5 * delta;
        }
        stamina = Math.max(0, Math.min(100, stamina));
        staminaBar.style.width = stamina + '%';

        if (flashlightOn && battery > 0) {
            battery -= 0.5 * delta;
            if(battery <= 0) {
                battery = 0;
                flashlightOn = false;
                flashlight.visible = false;
            }
        }
        batteryBar.style.width = battery + '%';

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); 

        const currentSpeed = isSprinting ? 60.0 : 30.0;
        
        if (moveForward || moveBackward) velocity.z -= direction.z * currentSpeed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * currentSpeed * delta;

        const prevX = camera.position.x;
        const prevZ = camera.position.z;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        resolveTreeCollisions(prevX, prevZ);

        // Terrain Height & Headbob
        const groundHeight = Math.sin(camera.position.x * 0.02) * Math.cos(camera.position.z * 0.02) * 0.4;
        
        if(isMoving) {
            headBobTimer += delta * (isSprinting ? 12 : 8);
            camera.position.y = groundHeight + 1.6 + (Math.sin(headBobTimer) * 0.1);
            
            if(!soundFootstep.isPlaying && Math.sin(headBobTimer) < -0.8) {
                if (stepBuffers.length > 0) {
                    soundFootstep.setBuffer(stepBuffers[Math.floor(Math.random() * stepBuffers.length)]);
                }
                soundFootstep.play();
            }
        } else {
            camera.position.y = groundHeight + 1.6;
            headBobTimer = 0;
            if (soundFootstep.isPlaying) soundFootstep.stop();
        }

        // Bounds
        if(camera.position.x > 190) camera.position.x = 190;
        if(camera.position.x < -190) camera.position.x = -190;
        if(camera.position.z > 190) camera.position.z = 190;
        if(camera.position.z < -190) camera.position.z = -190;

        updateGhostAI(delta);

        prevTime = time;
    } else {
        prevTime = performance.now();
    }

    composer.render();
}
