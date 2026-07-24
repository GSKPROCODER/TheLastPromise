import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Shared terrain-height function — MUST match the floor displacement and the
// grass/tree ground placement so everything sits on the same ground surface.
function terrainHeight(x, z) {
    return Math.sin(x * 0.02) * Math.cos(z * 0.02) * 0.4;
}

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
let ghostTeleportTimer = 0; // time since the ghost last repositioned (Slenderman stalking)
let staticIntensity = 0;
const pageTextures = [];
const treeColliders = []; // {x, z, radius} — trunk colliders, filled as trees are built

// --- ENVIRONMENT / GRAPHICS ---
const windUniforms = { uTime: { value: 0 }, uWindStrength: { value: 1.0 } };
let grassMesh = null;            // InstancedMesh of grass blades
let grassBlades = [];            // per-slot {ox, oz, rot, scale} offsets around the player
let grassAnchorX = Infinity, grassAnchorZ = Infinity; // last grid cell the grass was centered on
const GRASS_CELL = 0.5;          // world spacing between grass cells (smaller = denser)
const GRASS_RADIUS = 34;         // how far grass extends around the player
let bloomPass = null, gtaoPass = null; // graphics-effect passes (toggled in Settings)
let sceneFog = null;             // the FogExp2 instance (attached/detached by the fog toggle)
let staticCtx = null, staticImg = null; // animated TV-static overlay canvas

// Effect toggle state (balanced defaults; AO off — it's the heaviest)
let fxBloom = true, fxShadows = true, fxFog = true, fxAO = false;

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
const fxBloomToggle = document.getElementById('fx-bloom-toggle');
const fxShadowsToggle = document.getElementById('fx-shadows-toggle');
const fxFogToggle = document.getElementById('fx-fog-toggle');
const fxAoToggle = document.getElementById('fx-ao-toggle');
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
    // Denser, cold atmospheric fog for real depth/dread (toggleable in Settings).
    sceneFog = new THREE.FogExp2(0x05070b, 0.018);
    scene.fog = fxFog ? sceneFog : null;

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 1.6; 
    camera.add(listener);
    scene.add(camera);

    raycaster = new THREE.Raycaster();
    raycaster.near = 0.1;
    raycaster.far = 3.5;

    // Low, cool ambient so the scene is night-dark and flashlight-driven
    // (the old flat 0x444444 lit everything evenly and killed the mood).
    const ambientLight = new THREE.AmbientLight(0x3a4256, 0.35);
    scene.add(ambientLight);
    // Dim cool "moonlight" from above gives trees form/shape beyond the
    // flashlight, instead of flat ambient fill. No shadows (perf).
    const moonLight = new THREE.DirectionalLight(0x9fb0d0, 0.35);
    moonLight.position.set(-40, 80, -30);
    scene.add(moonLight);

    // Three.js r155+ uses physically-correct (candela) light units. The 4*PI
    // factor restores usable brightness; kept moderate so the beam lights the
    // path without blowing nearby grass/foliage out to a glow.
    const flashlightIntensity = 2.4 * 4 * Math.PI;
    flashlight = new THREE.SpotLight(0xffe9c8, flashlightIntensity, 90, Math.PI / 5, 0.6, 1.4);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    // Dynamic shadows through the trees (toggleable in Settings).
    flashlight.castShadow = fxShadows;
    flashlight.shadow.mapSize.set(1024, 1024);
    flashlight.shadow.camera.near = 0.5;
    flashlight.shadow.camera.far = 120;
    flashlight.shadow.bias = -0.0006;
    flashlight.shadow.normalBias = 0.02;
    camera.add(flashlight);
    camera.add(flashlight.target);

    controls = new PointerLockControls(camera, document.body);

    startBtn.addEventListener('click', function () {
        if(startBtn.classList.contains('disabled')) return;
        resumeAudioContext();
        gameStarted = true;
        controls.lock();
    });

    resumeBtn.addEventListener('click', function () {
        resumeAudioContext();
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

    // Graphics-effect toggles
    fxBloomToggle.addEventListener('change', function () {
        fxBloom = fxBloomToggle.checked;
        if (bloomPass) bloomPass.enabled = fxBloom;
    });
    fxAoToggle.addEventListener('change', function () {
        fxAO = fxAoToggle.checked;
        if (gtaoPass) gtaoPass.enabled = fxAO;
    });
    fxFogToggle.addEventListener('change', function () {
        fxFog = fxFogToggle.checked;
        scene.fog = fxFog ? sceneFog : null;
    });
    fxShadowsToggle.addEventListener('change', function () {
        fxShadows = fxShadowsToggle.checked;
        renderer.shadowMap.enabled = fxShadows;
        flashlight.castShadow = fxShadows;
        // Force materials to recompile for the shadow-map change to take effect.
        scene.traverse((o) => { if (o.isMesh && o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { m.needsUpdate = true; });
        }});
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

    // Animated TV-static overlay: a small noise buffer redrawn each frame and
    // CSS-upscaled, instead of a single frozen PNG.
    staticOverlay.width = 320;
    staticOverlay.height = 180;
    staticCtx = staticOverlay.getContext('2d');
    staticImg = staticCtx.createImageData(staticOverlay.width, staticOverlay.height);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // cinematic filmic color
    renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = fxShadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // POST-PROCESSING pipeline:
    // RenderPass -> GTAO (AO) -> UnrealBloom -> Film grain -> OutputPass (tone-map + sRGB)
    const w = window.innerWidth, h = window.innerHeight;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    gtaoPass = new GTAOPass(scene, camera, w, h);
    gtaoPass.enabled = fxAO;
    composer.addPass(gtaoPass);

    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 0.95); // strength, radius, threshold (high threshold: only true highlights bloom, not lit grass)
    bloomPass.enabled = fxBloom;
    composer.addPass(bloomPass);

    composer.addPass(new FilmPass(0.3, 0.05, 1500, false)); // subtle grain

    composer.addPass(new OutputPass()); // final tone mapping + color-space conversion

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

    // Original gloomy cloud skybox (kept per preference; no higher-res version
    // of this specific sky exists to swap in).
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

    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: 0x6b7a55, roughness: 1.0, metalness: 0.0 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const barkTexture = textureLoader.load('assets/tree_brown.png');
    barkTexture.wrapS = THREE.RepeatWrapping;
    barkTexture.wrapT = THREE.RepeatWrapping;
    barkTexture.repeat.set(1, 4);

    buildForest(barkTexture); // procedural instanced trees (+ page placement)
    buildDeadLogs();          // real photoscan dead-log ground props
    buildGrass();             // instanced 3D grass blades

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

// Deterministic pseudo-random in [0,1) from a number — for stable grass jitter.
function hash(n) {
    const s = Math.sin(n) * 43758.5453;
    return s - Math.floor(s);
}

// Inject vertex-shader wind sway into a MeshStandardMaterial (keeps lighting/
// shadows/fog). Sways more toward the top of the given local-Y span. Works for
// both instanced foliage (phase varied per instance) and grass.
function addWindToMaterial(mat, opts = {}) {
    const minY = opts.minY ?? 3.0, maxY = opts.maxY ?? 11.0, amp = opts.amp ?? 0.35;
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = windUniforms.uTime;
        shader.uniforms.uWindStrength = windUniforms.uWindStrength;
        shader.vertexShader = 'uniform float uTime;\nuniform float uWindStrength;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float wphase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.35;
            #else
              float wphase = 0.0;
            #endif
            float wheight = clamp((transformed.y - ${minY.toFixed(3)}) / ${(maxY - minY).toFixed(3)}, 0.0, 1.0);
            float wamp = ${amp.toFixed(3)} * wheight * uWindStrength;
            transformed.x += sin(uTime * 1.3 + wphase) * wamp;
            transformed.z += cos(uTime * 1.1 + wphase) * wamp * 0.6;
            `
        );
    };
    mat.needsUpdate = true;
}

// Procedural instanced pine-ish trees: tapered trunk + 3 stacked foliage cones,
// each part an InstancedMesh sharing the same per-tree transforms. Also places
// the 4 diary pages against random trees.
function buildForest(barkTexture) {
    const numTrees = 900, forestRadius = 150;

    // Taller trunk with more girth so trees read as full-size, not stubby.
    const TRUNK_H = 9, TRUNK_BASE_R = 0.55, TRUNK_TOP_R = 0.22;
    const trunkGeo = new THREE.CylinderGeometry(TRUNK_TOP_R, TRUNK_BASE_R, TRUNK_H, 8, 5);
    trunkGeo.translate(0, TRUNK_H / 2, 0); // base at y=0
    const trunkMat = new THREE.MeshStandardMaterial({ map: barkTexture, color: 0x2f2519, roughness: 1.0, metalness: 0.0 });

    // Dark, desaturated conifer green with flat shading (facets read as
    // natural clumps, not a smooth lime lollipop). Per-tree tint variation
    // added below via instanceColor so the forest isn't one uniform green.
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, flatShading: true });
    addWindToMaterial(foliageMat, { minY: 6.0, maxY: 15.0, amp: 0.5 });
    // Tiered canopy sitting high on the tall trunk (leaves plenty of visible bark).
    const cone = (r, h, y) => { const g = new THREE.ConeGeometry(r, h, 8, 3); g.translate(0, y, 0); return g; };
    const foliageParts = [cone(3.2, 4.5, 7.0), cone(2.7, 4.0, 9.2), cone(2.1, 3.6, 11.2), cone(1.4, 3.0, 13.0)];

    const matrices = [];
    const treeColors = [];
    const treeTransforms = [];
    const dummy = new THREE.Object3D();
    const baseGreen = new THREE.Color();
    for (let i = 0; i < numTrees; i++) {
        const r = 12 + Math.random() * (forestRadius - 12);
        const th = Math.random() * Math.PI * 2;
        const x = r * Math.cos(th), z = r * Math.sin(th);
        const s = 1.1 + Math.random() * 0.9; // bigger trees (was 0.8–1.5)
        dummy.position.set(x, terrainHeight(x, z), z);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
        // Dark green with per-tree hue/lightness jitter (multiplied onto foliage)
        baseGreen.setHSL(0.26 + Math.random() * 0.05, 0.35 + Math.random() * 0.15, 0.10 + Math.random() * 0.06);
        treeColors.push(baseGreen.clone());
        treeTransforms.push({ x, z, s });
        treeColliders.push({ x, z, radius: Math.max(0.6, TRUNK_BASE_R * s) });
    }

    const makeIM = (geo, mat, perInstanceColor) => {
        const im = new THREE.InstancedMesh(geo, mat, matrices.length);
        matrices.forEach((m, idx) => im.setMatrixAt(idx, m));
        im.instanceMatrix.needsUpdate = true;
        if (perInstanceColor) {
            treeColors.forEach((c, idx) => im.setColorAt(idx, c));
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
    };
    makeIM(trunkGeo, trunkMat, false);
    foliageParts.forEach((g) => makeIM(g, foliageMat, true));

    // Pages pinned flush to a trunk (was floating in mid-air): offset by the
    // trunk's actual world radius at page height so the sheet sits on the bark.
    const shuffled = [...treeTransforms].sort(() => 0.5 - Math.random());
    const pageGeo = new THREE.PlaneGeometry(0.5, 0.72);
    for (let i = 0; i < totalPages; i++) {
        const t = shuffled[i];
        const pageH = 1.6; // eye-ish height on the trunk
        const localY = pageH / t.s;
        const trunkR = (TRUNK_BASE_R + (TRUNK_TOP_R - TRUNK_BASE_R) * (localY / TRUNK_H)) * t.s; // tapered radius at that height
        const offset = trunkR + 0.06; // just off the bark
        const angle = Math.atan2(-t.z, -t.x); // face toward world origin (where the player starts)
        const pageMat = new THREE.MeshBasicMaterial({ map: pageTextures[i], side: THREE.DoubleSide });
        const page = new THREE.Mesh(pageGeo, pageMat);
        page.position.set(t.x + Math.cos(angle) * offset, terrainHeight(t.x, t.z) + pageH, t.z + Math.sin(angle) * offset);
        page.rotation.y = -angle + Math.PI / 2;
        page.userData = { type: 'note', id: i + 1, textureUrl: `assets/page${i + 1}.png` };
        scene.add(page);
        interactables.push(page);
    }
}

// Real photoscan dead logs scattered on the ground as atmospheric props (low
// count so their high triangle density stays within budget). Instanced.
function buildDeadLogs() {
    const loader = new GLTFLoader(loadingManager);
    const variants = [
        'dead_tree_trunk/dead_tree_trunk_1k.gltf',
        'dead_tree_trunk_02/dead_tree_trunk_02_1k.gltf'
    ];
    variants.forEach((path) => {
        loader.load('models/' + path, (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            let src = null;
            gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
            if (!src) return;
            const geo = src.geometry.clone();
            geo.applyMatrix4(src.matrixWorld);
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            const size = new THREE.Vector3(); bb.getSize(size);
            const baseScale = 5 / Math.max(size.x, size.z, 0.001); // ~5-unit-long logs
            const mat = src.material;
            mat.metalness = 0.0; mat.roughness = 1.0;

            const count = 8;
            const im = new THREE.InstancedMesh(geo, mat, count);
            const dummy = new THREE.Object3D();
            for (let i = 0; i < count; i++) {
                const r = 18 + Math.random() * 120, th = Math.random() * Math.PI * 2;
                const x = r * Math.cos(th), z = r * Math.sin(th);
                const s = baseScale * (0.8 + Math.random() * 0.6);
                dummy.position.set(x, terrainHeight(x, z) - bb.min.y * s + 0.05, z);
                dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
                dummy.scale.setScalar(s);
                dummy.updateMatrix();
                im.setMatrixAt(i, dummy.matrix);
            }
            im.instanceMatrix.needsUpdate = true;
            im.castShadow = true;
            im.receiveShadow = true;
            im.frustumCulled = false;
            scene.add(im);
        });
    });
}

// Instanced 3D grass blades that tile around the player (each blade anchored to
// a world grid cell via hashing, so the field is world-stable and only the
// matrices are rewritten when the player crosses a cell — near-zero per-frame
// cost). Wind handled in the vertex shader.
function buildGrass() {
    const N = Math.ceil(GRASS_RADIUS / GRASS_CELL);
    for (let dgx = -N; dgx <= N; dgx++) {
        for (let dgz = -N; dgz <= N; dgz++) {
            if ((dgx * GRASS_CELL) ** 2 + (dgz * GRASS_CELL) ** 2 <= GRASS_RADIUS * GRASS_RADIUS) {
                // Two jittered blades per cell for a fuller, denser field.
                grassBlades.push({ dgx, dgz, sub: 0 });
                grassBlades.push({ dgx, dgz, sub: 1 });
            }
        }
    }

    const BLADE_H = 0.34, BLADE_W = 0.055;
    const g = new THREE.PlaneGeometry(BLADE_W, BLADE_H, 1, 4);
    g.translate(0, BLADE_H / 2, 0); // base at y=0
    // Taper each blade to a point at the tip (real grass, not rectangles) and
    // give a dark natural green root->tip gradient. Kept dark/low-value so the
    // flashlight doesn't blow it out to a glow.
    const colors = [];
    const posA = g.attributes.position;
    for (let i = 0; i < posA.count; i++) {
        const t = posA.getY(i) / BLADE_H; // 0 root -> 1 tip
        posA.setX(i, posA.getX(i) * (1.0 - t * 0.85)); // narrow toward tip
        const c = new THREE.Color().setHSL(0.25 + t * 0.02, 0.45, 0.05 + 0.10 * t);
        colors.push(c.r, c.g, c.b);
    }
    posA.needsUpdate = true;
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
    addWindToMaterial(mat, { minY: 0.0, maxY: BLADE_H, amp: 0.05 });

    grassMesh = new THREE.InstancedMesh(g, mat, grassBlades.length);
    grassMesh.castShadow = false;
    grassMesh.receiveShadow = true;
    grassMesh.frustumCulled = false;
    scene.add(grassMesh);

    repositionGrass(camera.position.x, camera.position.z);
}

function repositionGrass(px, pz) {
    if (!grassMesh) return;
    const cx0 = Math.round(px / GRASS_CELL), cz0 = Math.round(pz / GRASS_CELL);
    if (cx0 === grassAnchorX && cz0 === grassAnchorZ) return;
    grassAnchorX = cx0; grassAnchorZ = cz0;
    const dummy = new THREE.Object3D();
    for (let k = 0; k < grassBlades.length; k++) {
        const o = grassBlades[k];
        const cx = cx0 + o.dgx, cz = cz0 + o.dgz;
        const seed = o.sub * 53.3; // second blade of the cell gets a distinct jitter
        const h1 = hash(cx * 0.137 + cz * 0.919 + seed);
        const h2 = hash(cx * 0.731 - cz * 0.251 + seed);
        const h3 = hash(cx * 1.700 + cz * 0.300 + seed);
        const wx = (cx + (h1 - 0.5) * 0.95) * GRASS_CELL;
        const wz = (cz + (h2 - 0.5) * 0.95) * GRASS_CELL;
        dummy.position.set(wx, terrainHeight(wx, wz), wz);
        dummy.rotation.set(0, h3 * Math.PI * 2, 0);
        const s = 0.75 + h1 * 0.5;
        dummy.scale.set(s, 0.7 + h2 * 0.35, s);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(k, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
}

function faceGhostTowards(dirX, dirZ) {
    ghost.rotation.y = Math.atan2(dirX, dirZ);
}

// Draw a fresh frame of TV static into the overlay canvas and set its opacity.
function drawStatic(intensity) {
    const a = Math.min(Math.max(intensity, 0), 1);
    staticOverlay.style.opacity = a;
    if (!staticCtx || a <= 0.002) return;
    const d = staticImg.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    staticCtx.putImageData(staticImg, 0, 0);
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
    // Reroll the static texture on each (re)appearance for variety.
    if (staticBuffers.length > 0) {
        soundStatic.setBuffer(staticBuffers[Math.floor(Math.random() * staticBuffers.length)]);
    }

    // Distance band around the player. Shrinks as pages are collected (she
    // closes in), but never below a floor so she can't teleport onto you.
    const minDist = Math.max(12, 30 - pagesCollected * 5);
    const maxDist = minDist + 20;
    const dist = minDist + Math.random() * (maxDist - minDist);

    // Bias the spawn to 90–270° off the player's current facing (around/behind).
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const baseAngle = Math.atan2(lookDir.x, lookDir.z);
    const spawnAngle = baseAngle + (Math.PI / 2) + Math.random() * Math.PI;

    const gx = camera.position.x + Math.sin(spawnAngle) * dist;
    const gz = camera.position.z + Math.cos(spawnAngle) * dist;
    ghost.position.set(gx, terrainHeight(gx, gz) + ghostGroundOffset, gz);
    faceGhostTowards(camera.position.x - gx, camera.position.z - gz);
}

// Faithful Slender: The Eight Pages behavior — she never walks toward you.
// She stands at a distance, freezes while watched (dread builds → death if you
// stare too long), and silently teleports to a new spot around you on a timer
// whenever you look away. Gets more frequent/closer as pages are collected.
function updateGhostAI(delta) {
    if (!ghostActive) return;

    const ghostDistance = camera.position.distanceTo(ghost.position);
    const ghostDir = new THREE.Vector3().subVectors(ghost.position, camera.position).normalize();
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const isLookingAtGhost = lookDir.dot(ghostDir) > 0.55;

    if (isLookingAtGhost) {
        if (battery <= 0) {
            // Flashlight battery fully dead → no light left to hold her off;
            // the moment she's in view she takes you.
            staticIntensity = 1.0;
            loseGame();
        } else {
            // Watched → she freezes and dread builds SLOWLY: staring ~45s kills
            // you early game (0→1). Faster up close / later game; but staring
            // in the dark (flashlight off) builds slower, buying you more time.
            const proximityFactor = 1 + Math.max(0, 30 - ghostDistance) / 30; // 1x far → up to 2x point-blank
            const lightFactor = flashlightOn ? 1.0 : 0.5; // dark = slower dread
            const buildupRate = (0.022 + pagesCollected * 0.012) * proximityFactor * lightFactor;
            staticIntensity += buildupRate * delta;
            ghostTeleportTimer = 0; // lingers in view while stared at
            if (staticIntensity >= 1.0) loseGame();
        }
    } else {
        // Not watched → dread fades and she repositions on a timer (no chase).
        staticIntensity = Math.max(0, staticIntensity - 0.45 * delta);
        ghostTeleportTimer += delta;
        const interval = Math.max(2.0, 6.0 - pagesCollected * 1.0);
        if (ghostTeleportTimer >= interval) {
            teleportGhost();
            ghostTeleportTimer = 0;
        }
    }

    // Static visuals + audio (scaled by SFX/master volume)
    drawStatic(staticIntensity);
    const sfxLevel = sfxVolume * masterVolume;
    if (noiseGain) noiseGain.gain.value = staticIntensity * 0.5 * sfxLevel;
    soundStatic.setVolume(staticIntensity * 0.6 * sfxLevel);
    soundBreath.setVolume(staticIntensity * sfxLevel);

    // Proximity tension swell (present regardless of looking)
    const proximity = Math.max(0, 1 - ghostDistance / 50);
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
    drawStatic(1.0);
    
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

        // Wind animation (trees + grass) and grass tiling around the player
        windUniforms.uTime.value = time / 1000;
        repositionGrass(camera.position.x, camera.position.z);

        updateGhostAI(delta);

        prevTime = time;
    } else {
        prevTime = performance.now();
    }

    composer.render();
}
