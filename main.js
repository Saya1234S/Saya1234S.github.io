import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createToonMaterial, createStepTexture } from './shaders/ToonShader.js';
import { WaterRippleShader } from './shaders/WaterRippleShader.js';

let scene, camera, renderer, composer, mixer, clock;
let ripplePass;
let sceneTarget;
let model;
let aronaActions = {};
let cameraActions = {};
let fingerMesh = null;
let bloomPass;
let hemiLight;

const SETTINGS_TXT_FILENAME = 'current settings (dont touch it).txt';
// Use module-relative URLs so this works from nested pages like /art/...
const SETTINGS_TXT_URL = new URL(`./${SETTINGS_TXT_FILENAME}`, import.meta.url).href;
const HIDE_UI_URL = new URL('./hide.ui', import.meta.url).href;

let uiLockedHidden = false;
let pendingStartupSettings = null;
let autoplayScheduled = false;
let userEnteredScene = false;

let hideUiCheckPromise = null;

const autoplaySettings = {
    enabled: true,
    delaySec: 0.0,
};

const musicSettings = {
    enabled: true,
    delaySec: 0.0,
    volume: 0.5,
    loop: true
};
let musicScheduled = false;

const seashoreSettings = {
    enabled: true,
    delaySec: 0.0,
    volume: 0.5,
    loop: true
};
let seashoreScheduled = false;

// --- Ocean & Sky Globals ---
let water, sky, sun;
let pmremGenerator;
let renderTargetEnv;
let envScene;
let oceanVisible = true;
const oceanParams = {
    elevation: 2,
    azimuth: 180,
    worldRotation: 0,
    exposure: 0.1,
    cloudCoverage: 0.4,
    cloudDensity: 0.5,
    cloudElevation: 0.5,
    distortionScale: 3.7,
    size: 1.0
};

// Used to compensate ambient/fill so exposure changes don't lift character shadows.
const _EXPOSURE_BASELINE = oceanParams.exposure;

// --- Hair Physics Globals ---
let physicsChains = []; // Array of verlet chains
let selectedStartBone = null;
let selectedEndBone = null;

const hairPhysicsSettings = {
    windYawDeg: 210,
    windPitchDeg: 0,
    windStrength: 1.5,
    gustStrength: 0.3,
    gustFrequency: 1.8,
    turbulence: 2.0,
    windNoise: 1.5,
    windSpread: 0.2,
    bendAllowed: 0.75,
    gravity: 9.0,
    damping: 0.03, // verlet damping (0..0.2)
    iterations: 12, // constraint iterations ("hardness")
};

// --- Toon Settings ---
const toonSettings = {
    edgeColor: '#000000',
    edgeWidthRatio: 0.004
};

// Controls toon banding + tint (separate from outline settings)
const toonLightingSettings = {
    bands: 2,
    // Per-band softness for transitions at T1/T2/T3.
    softness1: 0.02,
    softness2: 0.02,
    softness3: 0.02,
    // Back-compat: older settings may have a single softness.
    softness: 0.02,
    tint: 1.0,
    ambient: 0.25,
    shadow: 0.30,
    highlight: 1.15,

    // Fixed thresholds (kept simple; can be exposed later if needed)
    t1: 0.50,
    t2: 0.75,
    t3: 0.90,
    mid: 0.65,
    light: 1.00,
};

const _toonSunColor = new THREE.Color(1, 1, 1);
const _toonAmbientColor = new THREE.Color(0.25, 0.25, 0.25);

function _updateToonLightColorsFromSun() {
    // Warm at low elevation, cooler/whiter as the sun rises.
    const elev = oceanParams?.elevation ?? 2;
    const t = THREE.MathUtils.clamp(1.0 - elev / 25.0, 0.0, 1.0);
    const warm = new THREE.Color(1.0, 0.62, 0.32);
    const cool = new THREE.Color(0.78, 0.88, 1.0);
    const sunTint = cool.clone().lerp(warm, Math.pow(t, 1.6));
    const baseWhite = new THREE.Color(1, 1, 1);
    _toonSunColor.copy(baseWhite).lerp(sunTint, toonLightingSettings.tint);

    // Cool ambient so shadows don't go dead-black.
    const skyAmb = new THREE.Color(0.20, 0.28, 0.40);
    _toonAmbientColor.copy(skyAmb).multiplyScalar(toonLightingSettings.ambient);
}

function _applyToonLightingUniforms() {
    for (const m of toonMaterials) {
        if (!m || !m.uniforms) continue;

        if (m.uniforms.toonBands) m.uniforms.toonBands.value = toonLightingSettings.bands | 0;
        if (m.uniforms.toonSoftness1) m.uniforms.toonSoftness1.value = toonLightingSettings.softness1;
        if (m.uniforms.toonSoftness2) m.uniforms.toonSoftness2.value = toonLightingSettings.softness2;
        if (m.uniforms.toonSoftness3) m.uniforms.toonSoftness3.value = toonLightingSettings.softness3;
        // Back-compat: older shader versions use a single softness.
        if (m.uniforms.toonSoftness) m.uniforms.toonSoftness.value = toonLightingSettings.softness1;
        if (m.uniforms.toonT1) m.uniforms.toonT1.value = toonLightingSettings.t1;
        if (m.uniforms.toonT2) m.uniforms.toonT2.value = toonLightingSettings.t2;
        if (m.uniforms.toonT3) m.uniforms.toonT3.value = toonLightingSettings.t3;
        if (m.uniforms.toonShadow) m.uniforms.toonShadow.value = toonLightingSettings.shadow;
        if (m.uniforms.toonMid) m.uniforms.toonMid.value = toonLightingSettings.mid;
        if (m.uniforms.toonLight) m.uniforms.toonLight.value = toonLightingSettings.light;
        if (m.uniforms.toonHighlight) m.uniforms.toonHighlight.value = toonLightingSettings.highlight;

        if (m.uniforms.lightColor && m.uniforms.lightColor.value && typeof m.uniforms.lightColor.value.copy === 'function') {
            m.uniforms.lightColor.value.copy(_toonSunColor);
        }
        if (m.uniforms.ambientColor && m.uniforms.ambientColor.value && typeof m.uniforms.ambientColor.value.copy === 'function') {
            m.uniforms.ambientColor.value.copy(_toonAmbientColor);
        }
    }
}

function _applyExposureShadowCompensation() {
    if (!renderer) return;

    // Exposure is global (renderer-level). To avoid exposure lifting character shadows,
    // we counter-scale the *fill* sources (hemisphere + env reflections) so the fill
    // contribution stays roughly constant as exposure changes.
    const exposure = Math.max(0.0001, oceanParams.exposure);
    const baseline = Math.max(0.0001, _EXPOSURE_BASELINE);
    const comp = THREE.MathUtils.clamp(baseline / exposure, 0.0, 20.0);

    if (hemiLight) {
        // Keep the baseline look at the baseline exposure.
        hemiLight.intensity = 2 * comp;
    }

    // Reduce env contribution in Standard materials so fill doesn't lift.
    for (const binding of materialBindings) {
        const mats = Array.isArray(binding.litMaterial) ? binding.litMaterial : [binding.litMaterial];
        for (const mat of mats) {
            if (!mat) continue;
            if (typeof mat.envMapIntensity === 'number') {
                if (!mat.userData) mat.userData = {};
                if (typeof mat.userData._baseEnvMapIntensity !== 'number') {
                    mat.userData._baseEnvMapIntensity = mat.envMapIntensity;
                }
                mat.envMapIntensity = mat.userData._baseEnvMapIntensity * comp;
                mat.needsUpdate = true;
            }
        }
    }
}

function _isTextInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button';
}

function playSelectedAnimations() {
    if (!mixer) return;

    const aSel = document.getElementById('arona-anim-selector');
    const cSel = document.getElementById('camera-anim-selector');
    const aName = aSel?.value || '';
    const cName = cSel?.value || '';

    mixer.stopAllAction();

    if (aName && aronaActions[aName]) {
        const action = aronaActions[aName];
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.enabled = true;
        action.paused = false;
        action.reset().play();
    }

    if (cName && cameraActions[cName]) {
        const action = cameraActions[cName];
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.enabled = true;
        action.paused = false;
        action.reset().play();
    }
}

function _scheduleAutoplayIfEnabled() {
    if (autoplayScheduled) return;
    if (!autoplaySettings.enabled) return;
    autoplayScheduled = true;
    const delayMs = Math.max(0, Math.floor((autoplaySettings.delaySec || 0) * 1000));
    window.setTimeout(() => {
        playSelectedAnimations();
    }, delayMs);
}

function _scheduleMusicIfEnabled() {
    if (musicScheduled) return;
    if (!musicSettings.enabled) return;
    musicScheduled = true;
    const delayMs = Math.max(0, Math.floor((musicSettings.delaySec || 0) * 1000));
    window.setTimeout(() => {
        const musicAudio = document.getElementById('music-audio');
        if (musicAudio) {
            musicAudio.volume = musicSettings.volume;
            musicAudio.loop = !!musicSettings.loop;
            // Attempt to play; if blocked, retry on first interaction
            const p = musicAudio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    // If blocked, add a one-time listener to play
                    const unlock = () => {
                        musicAudio.play().catch(() => {});
                        window.removeEventListener('pointerdown', unlock);
                        window.removeEventListener('keydown', unlock);
                    };
                    window.addEventListener('pointerdown', unlock);
                    window.addEventListener('keydown', unlock);
                });
            }
        }
    }, delayMs);
}

function _scheduleSeashoreIfEnabled() {
    if (seashoreScheduled) return;
    if (!seashoreSettings.enabled) return;
    seashoreScheduled = true;
    const delayMs = Math.max(0, Math.floor((seashoreSettings.delaySec || 0) * 1000));
    window.setTimeout(() => {
        const seashoreAudio = document.getElementById('seashore-audio');
        if (seashoreAudio) {
            seashoreAudio.volume = seashoreSettings.volume;
            seashoreAudio.loop = !!seashoreSettings.loop;
            // Attempt to play; if blocked, retry on first interaction
            const p = seashoreAudio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    const unlock = () => {
                        seashoreAudio.play().catch(() => {});
                        window.removeEventListener('pointerdown', unlock);
                        window.removeEventListener('keydown', unlock);
                    };
                    window.addEventListener('pointerdown', unlock);
                    window.addEventListener('keydown', unlock);
                });
            }
        }
    }, delayMs);
}

function _applyUiLockedHidden(hidden) {
    uiLockedHidden = !!hidden;

    const ui = document.getElementById('ui-container');
    const phys = document.getElementById('physics-ui');
    const hier = document.getElementById('hierarchy-ui');
    const toggleHier = document.getElementById('toggle-hierarchy');

    if (ui) ui.style.display = hidden ? 'none' : ui.style.display;
    if (phys) phys.style.display = hidden ? 'none' : phys.style.display;
    if (hier) hier.style.display = hidden ? 'none' : hier.style.display;
    if (toggleHier) toggleHier.style.display = hidden ? 'none' : toggleHier.style.display;
}

function _checkHideUiLockOnce() {
    if (hideUiCheckPromise) return hideUiCheckPromise;
    hideUiCheckPromise = (async () => {
        try {
            const res = await fetch(HIDE_UI_URL, { cache: 'no-store' });
            if (res.ok) _applyUiLockedHidden(true);
        } catch {
            // ignore
        }
    })();
    return hideUiCheckPromise;
}

async function _tryFetchJson(url) {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        const text = await res.text();
        const cleaned = text.replace(/^\uFEFF/, '').trim();
        if (!cleaned) return null;
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn('[Startup] Failed to fetch/parse', url, e);
        return null;
    }
}

async function _startupLoadSettingsAndUiLock() {
    // 1) If hide.ui exists, keep UI hidden forever.
    await _checkHideUiLockOnce();

    // 2) If the settings TXT exists, load & apply it.
    const data = await _tryFetchJson(SETTINGS_TXT_URL);
    if (data) {
        pendingStartupSettings = data;
        applyAllSettings(data);

        // If the model is already loaded by the time settings arrive,
        // re-apply (restores chains) and autoplay once (only if user already entered).
        if (model) {
            applyAllSettings(pendingStartupSettings);
            if (userEnteredScene) {
                _scheduleAutoplayIfEnabled();
                _scheduleMusicIfEnabled();
                _scheduleSeashoreIfEnabled();
            }
        }
    }
}

// --- Copy/Paste Integration ---
function getAllSettings() {
    return {
        ocean: {
            elevation: oceanParams.elevation,
            azimuth: oceanParams.azimuth,
            worldRotation: oceanParams.worldRotation,
            exposure: oceanParams.exposure,
            cloudCoverage: oceanParams.cloudCoverage,
            cloudDensity: oceanParams.cloudDensity,
            cloudElevation: oceanParams.cloudElevation,
            distortionScale: oceanParams.distortionScale,
            size: oceanParams.size,
            oceanVisible
        },
        physics: hairPhysicsSettings,
        toon: toonSettings,
        toonLighting: toonLightingSettings,
        chains: physicsChains.map(c => ({
            startName: c.bones[0].name,
            endName: c.bones[c.bones.length - 1].name
        })),
        animation: {
            arona: document.getElementById('arona-anim-selector')?.value || '',
            camera: document.getElementById('camera-anim-selector')?.value || ''
        },
        autoplay: {
            enabled: !!autoplaySettings.enabled,
            delaySec: Number(autoplaySettings.delaySec) || 0
        },
        music: {
            enabled: !!musicSettings.enabled,
            delaySec: Number(musicSettings.delaySec) || 0,
            volume: Number(musicSettings.volume) || 0.5,
            loop: !!musicSettings.loop
        },
        seashore: {
            enabled: !!seashoreSettings.enabled,
            delaySec: Number(seashoreSettings.delaySec) || 0,
            volume: Number(seashoreSettings.volume) || 0.5,
            loop: !!seashoreSettings.loop
        },
        cameraControls: {
            disabled: cameraControlsDisabled
        }
    };
}

function applyAllSettings(data) {
    if (data.autoplay) {
        if (typeof data.autoplay.enabled === 'boolean') autoplaySettings.enabled = data.autoplay.enabled;
        if (typeof data.autoplay.delaySec === 'number') autoplaySettings.delaySec = data.autoplay.delaySec;

        const autoEnabled = document.getElementById('autoplay-enabled');
        const autoDelay = document.getElementById('autoplay-delay');
        if (autoEnabled) {
            autoEnabled.checked = autoplaySettings.enabled;
        }
        if (autoDelay) {
            autoDelay.value = String(autoplaySettings.delaySec);
            autoDelay.dispatchEvent(new Event('input'));
        }
    }

    if (data.cameraControls) {
        if (typeof data.cameraControls.disabled === 'boolean') {
            cameraControlsDisabled = data.cameraControls.disabled;
        }
        const camCtrlCheckbox = document.getElementById('camera-controls-disabled');
        if (camCtrlCheckbox) {
            camCtrlCheckbox.checked = cameraControlsDisabled;
        }
    }

    if (data.music) {
        if (typeof data.music.enabled === 'boolean') musicSettings.enabled = data.music.enabled;
        if (typeof data.music.delaySec === 'number') musicSettings.delaySec = data.music.delaySec;
        if (typeof data.music.volume === 'number') musicSettings.volume = data.music.volume;
        if (typeof data.music.loop === 'boolean') musicSettings.loop = data.music.loop;

        const musicEnabled = document.getElementById('music-enabled');
        const musicDelay = document.getElementById('music-delay');
        const musicVolume = document.getElementById('music-volume');
        const musicLoop = document.getElementById('music-loop');

        if (musicEnabled) musicEnabled.checked = musicSettings.enabled;
        if (musicLoop) musicLoop.checked = musicSettings.loop;
        
        if (musicDelay) {
            musicDelay.value = String(musicSettings.delaySec);
            musicDelay.dispatchEvent(new Event('input'));
        }
        if (musicVolume) {
            musicVolume.value = String(musicSettings.volume);
            musicVolume.dispatchEvent(new Event('input'));
        }
    }

    if (data.seashore) {
        if (typeof data.seashore.enabled === 'boolean') seashoreSettings.enabled = data.seashore.enabled;
        if (typeof data.seashore.delaySec === 'number') seashoreSettings.delaySec = data.seashore.delaySec;
        if (typeof data.seashore.volume === 'number') seashoreSettings.volume = data.seashore.volume;
        if (typeof data.seashore.loop === 'boolean') seashoreSettings.loop = data.seashore.loop;

        const seashoreEnabled = document.getElementById('seashore-enabled');
        const seashoreDelay = document.getElementById('seashore-delay');
        const seashoreVolume = document.getElementById('seashore-volume');
        const seashoreLoop = document.getElementById('seashore-loop');

        if (seashoreEnabled) seashoreEnabled.checked = seashoreSettings.enabled;
        if (seashoreLoop) seashoreLoop.checked = seashoreSettings.loop;

        if (seashoreDelay) {
            seashoreDelay.value = String(seashoreSettings.delaySec);
            seashoreDelay.dispatchEvent(new Event('input'));
        }
        if (seashoreVolume) {
            seashoreVolume.value = String(seashoreSettings.volume);
            seashoreVolume.dispatchEvent(new Event('input'));
        }
    }

    if (data.ocean) {
        Object.assign(oceanParams, data.ocean);
        if (typeof data.ocean.oceanVisible === 'boolean') oceanVisible = data.ocean.oceanVisible;

        const elevEl = document.getElementById('sky-elevation');
        const azEl = document.getElementById('sky-azimuth');
        const rotEl = document.getElementById('beach-rotation');
        const expEl = document.getElementById('sky-exposure');
        const covEl = document.getElementById('cloud-coverage');
        const denEl = document.getElementById('cloud-density');
        const celEl = document.getElementById('cloud-elevation');
        const distEl = document.getElementById('water-distortion');
        const sizeEl = document.getElementById('water-size');

        if (elevEl) { elevEl.value = String(oceanParams.elevation); elevEl.dispatchEvent(new Event('input')); }
        if (azEl) { azEl.value = String(oceanParams.azimuth); azEl.dispatchEvent(new Event('input')); }
        if (rotEl) { rotEl.value = String(oceanParams.worldRotation); rotEl.dispatchEvent(new Event('input')); }
        if (expEl) { expEl.value = String(oceanParams.exposure); expEl.dispatchEvent(new Event('input')); }
        if (covEl) { covEl.value = String(oceanParams.cloudCoverage); covEl.dispatchEvent(new Event('input')); }
        if (denEl) { denEl.value = String(oceanParams.cloudDensity); denEl.dispatchEvent(new Event('input')); }
        if (celEl) { celEl.value = String(oceanParams.cloudElevation); celEl.dispatchEvent(new Event('input')); }
        if (distEl) { distEl.value = String(oceanParams.distortionScale); distEl.dispatchEvent(new Event('input')); }
        if (sizeEl) { sizeEl.value = String(oceanParams.size); sizeEl.dispatchEvent(new Event('input')); }

        // Ensure visibility state is restored.
        if (water) water.visible = oceanVisible;
        if (sky) sky.visible = oceanVisible;
        const oceanBtn = document.getElementById('btn-toggle-ocean');
        if (oceanBtn) {
            if (oceanVisible) {
                oceanBtn.textContent = 'Toggle Ocean: ON';
                oceanBtn.classList.add('active');
            } else {
                oceanBtn.textContent = 'Toggle Ocean: OFF';
                oceanBtn.classList.remove('active');
            }
        }
        if (oceanVisible) {
            if (renderTargetEnv) scene.environment = renderTargetEnv.texture;
        } else {
            scene.environment = null;
        }

        // Keep shadow compensation in sync.
        _applyExposureShadowCompensation();
    }

    if (data.toon) {
        Object.assign(toonSettings, data.toon);
        const colPicker = document.getElementById('outline-color');
        const thickSlider = document.getElementById('outline-thickness');
        if (colPicker) {
            colPicker.value = toonSettings.edgeColor;
            colPicker.dispatchEvent(new Event('input'));
        }
        if (thickSlider) {
            thickSlider.value = toonSettings.edgeWidthRatio;
            thickSlider.dispatchEvent(new Event('input'));
        }
    }

    if (data.toonLighting) {
        Object.assign(toonLightingSettings, data.toonLighting);

        // Back-compat: older payloads may only have a single softness.
        if (typeof data.toonLighting.softness === 'number' &&
            (typeof data.toonLighting.softness1 !== 'number' && typeof data.toonLighting.softness2 !== 'number' && typeof data.toonLighting.softness3 !== 'number')) {
            toonLightingSettings.softness1 = data.toonLighting.softness;
            toonLightingSettings.softness2 = data.toonLighting.softness;
            toonLightingSettings.softness3 = data.toonLighting.softness;
        }

        const bandEl = document.getElementById('toon-bands');
        const soft1El = document.getElementById('toon-softness');
        const soft2El = document.getElementById('toon-softness2');
        const soft3El = document.getElementById('toon-softness3');
        const tintEl = document.getElementById('toon-tint');
        const ambEl = document.getElementById('toon-ambient');
        const shadowEl = document.getElementById('toon-shadow');
        const hiEl = document.getElementById('toon-highlight');

        if (bandEl) { bandEl.value = String(toonLightingSettings.bands); bandEl.dispatchEvent(new Event('input')); }
        if (soft1El) { soft1El.value = String(toonLightingSettings.softness1); soft1El.dispatchEvent(new Event('input')); }
        if (soft2El) { soft2El.value = String(toonLightingSettings.softness2); soft2El.dispatchEvent(new Event('input')); }
        if (soft3El) { soft3El.value = String(toonLightingSettings.softness3); soft3El.dispatchEvent(new Event('input')); }
        if (tintEl) { tintEl.value = String(toonLightingSettings.tint); tintEl.dispatchEvent(new Event('input')); }
        if (ambEl) { ambEl.value = String(toonLightingSettings.ambient); ambEl.dispatchEvent(new Event('input')); }
        if (shadowEl) { shadowEl.value = String(toonLightingSettings.shadow); shadowEl.dispatchEvent(new Event('input')); }
        if (hiEl) { hiEl.value = String(toonLightingSettings.highlight); hiEl.dispatchEvent(new Event('input')); }
    }

    // 1. Apply Physics Params
    if (data.physics) {
        Object.assign(hairPhysicsSettings, data.physics);
        // Update UI inputs
        document.getElementById('phys-wind-yaw').value = hairPhysicsSettings.windYawDeg;
        document.getElementById('phys-wind-pitch').value = hairPhysicsSettings.windPitchDeg;
        document.getElementById('phys-wind').value = hairPhysicsSettings.windStrength;
        document.getElementById('phys-gust').value = hairPhysicsSettings.gustStrength;
        document.getElementById('phys-turb').value = hairPhysicsSettings.turbulence;
        document.getElementById('phys-wind-noise').value = hairPhysicsSettings.windNoise;
        document.getElementById('phys-wind-spread').value = hairPhysicsSettings.windSpread;
        document.getElementById('phys-gravity').value = hairPhysicsSettings.gravity;
        document.getElementById('phys-damping').value = hairPhysicsSettings.damping;
        document.getElementById('phys-iter').value = hairPhysicsSettings.iterations;
        document.getElementById('phys-bend').value = hairPhysicsSettings.bendAllowed;

        // Trigger manual sync of labels
        // (We need to expose the sync function or fire events, simplest is manual here)
        // Accessing the local syncPhysicsUI isn't possible from here, so we will fire 'input' events later
        // or just rely on the fact that animate() uses the object directly.
        // Let's trigger events to update labels:
        ['phys-wind-yaw', 'phys-wind-pitch', 'phys-wind', 'phys-gust', 'phys-turb', 'phys-wind-noise', 'phys-wind-spread', 'phys-gravity', 'phys-damping', 'phys-iter', 'phys-bend'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.dispatchEvent(new Event('input'));
        });
    }

    // 2. Rebuild Chains
    if (data.chains && model) {
        physicsChains = [];
        data.chains.forEach(c => {
            const startParam = model.getObjectByName(c.startName);
            const endParam = model.getObjectByName(c.endName);
            if (startParam && endParam) {
                // Re-use logic: trace up from end to start
                let chain = [];
                let curr = endParam;
                let found = false;
                while (curr) {
                    chain.unshift(curr);
                    if (curr === startParam) {
                        found = true;
                        break;
                    }
                    curr = curr.parent;
                }
                if (found) {
                    model.updateMatrixWorld(true);
                    physicsChains.push(createVerletHairChain(chain));
                }
            }
        });
        updateChainsListUI();
    }

    // 3. Set Animation
    if (data.animation) {
        const aSel = document.getElementById('arona-anim-selector');
        const cSel = document.getElementById('camera-anim-selector');
        if (aSel && data.animation.arona) aSel.value = data.animation.arona;
        if (cSel && data.animation.camera) cSel.value = data.animation.camera;
        // Optional: auto-play? The user might just want settings restored.
    }
}

function updateChainsListUI() {
    const list = document.getElementById('chains-list');
    if (!list) return;
    list.innerHTML = '';

    if (physicsChains.length === 0) {
        list.innerHTML = '<div style="color: #666; font-style: italic; padding: 4px;">No chains added yet.</div>';
        return;
    }

    physicsChains.forEach((chain, idx) => {
        const row = document.createElement('div');
        row.className = 'chain-item';

        const label = document.createElement('span');
        label.className = 'chain-name';
        // Show "Start -> End"
        const sName = chain.bones[0].name;
        const eName = chain.bones[chain.bones.length - 1].name;
        label.textContent = `${sName} → ${eName}`;
        label.title = label.textContent;

        const btnDel = document.createElement('button');
        btnDel.textContent = '×';
        btnDel.title = 'Remove Chain';
        btnDel.onclick = (e) => {
            e.stopPropagation(); // prevent other clicks
            physicsChains.splice(idx, 1);
            updateChainsListUI();
        };

        row.appendChild(label);
        row.appendChild(btnDel);
        list.appendChild(row);
    });
}


// Shared toon materials list for two-pass rendering
const toonMaterials = [];
const sharedLightDirection = new THREE.Vector3(0, -1, -1).normalize();
const materialBindings = [];
let useToonShader = true;
let lightsOn = true;

// Camera control variables
let isRightMouseDown = false;
const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
const moveSpeed = 5;
const lookSpeed = 0.005;

// Camera controls toggle
let cameraControlsDisabled = false;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Reused temp objects to reduce allocations
const _tmpV3a = new THREE.Vector3();
const _tmpV3b = new THREE.Vector3();
const _tmpV3c = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function _degToRad(d) {
    return (d * Math.PI) / 180;
}

function _computeWindDir(out) {
    const yaw = _degToRad(hairPhysicsSettings.windYawDeg);
    const pitch = _degToRad(hairPhysicsSettings.windPitchDeg);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // Yaw around Y axis, pitch up/down
    out.set(cy * cp, sp, sy * cp);
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
    return out.normalize();
}

function createVerletHairChain(bones) {
    const n = bones.length;
    const particles = new Array(n);
    const prevParticles = new Array(n);
    const segmentLengths = new Array(Math.max(0, n - 1));
    const bendLengths = new Array(Math.max(0, n - 2));
    const restQuats = new Array(n);
    const restDirsParent = new Array(Math.max(0, n - 1));

    for (let i = 0; i < n; i++) {
        const p = new THREE.Vector3();
        bones[i].getWorldPosition(p);
        particles[i] = p.clone();
        prevParticles[i] = p.clone();
        restQuats[i] = bones[i].quaternion.clone();

        if (i < n - 1) {
            bones[i + 1].getWorldPosition(_tmpV3b);
            segmentLengths[i] = p.distanceTo(_tmpV3b);

            // Rest direction in *parent space* for stable aiming
            const parent = bones[i].parent;
            const p0 = parent.worldToLocal(p.clone());
            const p1 = parent.worldToLocal(_tmpV3b.clone());
            restDirsParent[i] = p1.sub(p0).normalize();
        }

        if (i < n - 2) {
            bones[i + 2].getWorldPosition(_tmpV3b);
            bendLengths[i] = p.distanceTo(_tmpV3b);
        }
    }

    return {
        bones,
        particles,
        prevParticles,
        segmentLengths,
        bendLengths,
        restQuats,
        restDirsParent,
    };
}

function simulateVerletHairChain(chain, delta, time, chainIndex = 0) {
    const bones = chain.bones;
    const n = bones.length;
    if (n < 2) return;

    // Clamp delta for stability on tab-switch / lag spikes
    const dt = Math.min(Math.max(delta, 0.0001), 1 / 30);
    const dt2 = dt * dt;

    // Anchor root particle to the current root bone position (follows animation)
    bones[0].getWorldPosition(_tmpV3a);
    chain.particles[0].copy(_tmpV3a);
    chain.prevParticles[0].copy(_tmpV3a);

    // Cache the current animated segment directions in parent space BEFORE we modify bone quaternions.
    // We'll use these as the "base" direction so physics is applied as a delta on top of animation.
    if (!chain.baseDirsParent || chain.baseDirsParent.length !== n - 1) {
        chain.baseDirsParent = new Array(n - 1);
        for (let i = 0; i < n - 1; i++) chain.baseDirsParent[i] = new THREE.Vector3(0, 0, 1);
    }
    for (let i = 0; i < n - 1; i++) {
        const bone = bones[i];
        const parent = bone.parent;
        if (!parent) continue;

        bones[i].getWorldPosition(_tmpV3b);
        bones[i + 1].getWorldPosition(_tmpV3c);
        parent.worldToLocal(_tmpV3b);
        parent.worldToLocal(_tmpV3c);
        _tmpV3c.sub(_tmpV3b).normalize();
        if (_tmpV3c.lengthSq() > 1e-8) chain.baseDirsParent[i].copy(_tmpV3c);
    }

    const gravity = hairPhysicsSettings.gravity;
    const damping = hairPhysicsSettings.damping;
    const iterations = Math.max(1, hairPhysicsSettings.iterations | 0);

    const windDir = _computeWindDir(_tmpV3b);

    // Apply wind spread based on chain index
    const windSpread = hairPhysicsSettings.windSpread;
    if (windSpread > 0) {
        const spreadX = Math.sin(chainIndex * 12.345) * windSpread;
        const spreadY = Math.cos(chainIndex * 23.456) * windSpread;
        const spreadZ = Math.sin(chainIndex * 34.567) * windSpread;
        windDir.x += spreadX;
        windDir.y += spreadY;
        windDir.z += spreadZ;
        windDir.normalize();
    }

    const windStrength = hairPhysicsSettings.windStrength;
    const gustStrength = hairPhysicsSettings.gustStrength;
    const gustFreq = hairPhysicsSettings.gustFrequency;
    const turbulence = hairPhysicsSettings.turbulence;
    const windNoise = hairPhysicsSettings.windNoise;
    const phaseOffset = chainIndex * windNoise;
    const bendAllowed = hairPhysicsSettings.bendAllowed;

    // Verlet integration step (world space)
    for (let i = 1; i < n; i++) {
        const p = chain.particles[i];
        const prev = chain.prevParticles[i];

        // velocity = (p - prev) * (1 - damping)
        _tmpV3c.subVectors(p, prev).multiplyScalar(1 - damping);
        prev.copy(p);
        p.add(_tmpV3c);

        // acceleration: gravity + wind (+ gust + turbulence)
        const s = i / (n - 1); // 0 at root, 1 at tip
        const tipScale = 0.15 + 0.85 * Math.pow(s, 2.0); // tip gets much more force

        const gust = 1 + Math.sin(time * gustFreq + phaseOffset + i * 0.7) * gustStrength;

        // Add a swirling component perpendicular to wind direction to create visible waving.
        // This is a cheap "curl-like" turbulence that looks good for hair.
        _tmpV3c.set(0, 1, 0).cross(windDir);
        if (_tmpV3c.lengthSq() < 1e-6) _tmpV3c.set(1, 0, 0);
        _tmpV3c.normalize();

        const turb1 = Math.sin(time * (2.7 + turbulence * 0.6) + phaseOffset * 1.5 + i * 1.3);
        const turb2 = Math.cos(time * (5.2 + turbulence * 0.9) - phaseOffset * 1.2 + i * 0.9);
        const turbAmp = turbulence * 0.35;

        const wx = (windDir.x + _tmpV3c.x * turb1 * turbAmp + windDir.z * turb2 * (turbAmp * 0.15));
        const wy = (windDir.y + _tmpV3c.y * turb2 * (turbAmp * 0.2));
        const wz = (windDir.z + _tmpV3c.z * turb1 * turbAmp + windDir.x * turb2 * (turbAmp * 0.15));

        p.x += wx * windStrength * gust * tipScale * dt2;
        p.y += (wy * windStrength * gust * tipScale - gravity) * dt2;
        p.z += wz * windStrength * gust * tipScale * dt2;
    }

    // Distance constraints (keeps segment lengths)
    for (let iter = 0; iter < iterations; iter++) {
        // Re-anchor each iteration for firmness
        chain.particles[0].copy(_tmpV3a);

        for (let i = 1; i < n; i++) {
            const p0 = chain.particles[i - 1];
            const p1 = chain.particles[i];
            const restLen = chain.segmentLengths[i - 1];

            _tmpV3c.subVectors(p1, p0);
            const dist = _tmpV3c.length();
            if (dist < 1e-8) continue;
            const diff = (dist - restLen) / dist;

            if (i - 1 === 0) {
                // root is anchored, move only p1
                p1.addScaledVector(_tmpV3c, -diff);
            } else {
                p0.addScaledVector(_tmpV3c, diff * 0.5);
                p1.addScaledVector(_tmpV3c, -diff * 0.5);
            }
        }

        // Bend constraints: keep the i -> i+2 distance near rest to control curvature.
        // bendAllowed = 1 => floppy (minimal correction), 0 => stiff (max correction)
        const bendStiff = 1 - Math.max(0, Math.min(1, bendAllowed));
        if (bendStiff > 0.0001 && chain.bendLengths && chain.bendLengths.length > 0) {
            for (let i = 0; i < n - 2; i++) {
                const p0 = chain.particles[i];
                const p2 = chain.particles[i + 2];
                const restLen = chain.bendLengths[i];

                _tmpV3c.subVectors(p2, p0);
                const dist = _tmpV3c.length();
                if (dist < 1e-8) continue;
                const diff = (dist - restLen) / dist;

                // Soften near the tip by default; makes long hair wave nicely.
                const s = (i + 2) / (n - 1);
                const falloff = 1 - 0.75 * s; // tip: ~0.25
                const k = bendStiff * falloff;

                if (i === 0) {
                    // root anchored: adjust only p2
                    p2.addScaledVector(_tmpV3c, -diff * k);
                } else {
                    p0.addScaledVector(_tmpV3c, diff * 0.5 * k);
                    p2.addScaledVector(_tmpV3c, -diff * 0.5 * k);
                }
            }
        }
    }

    // Apply particle positions back to bones by rotating each bone towards its next particle.
    // This is layered on top of the current animated pose using baseDirsParent.
    for (let i = 0; i < n - 1; i++) {
        const bone = bones[i];
        const parent = bone.parent;
        if (!parent) continue;

        // Target direction (simulated) in parent space
        _tmpV3b.copy(chain.particles[i]);
        _tmpV3c.copy(chain.particles[i + 1]);
        parent.worldToLocal(_tmpV3b);
        parent.worldToLocal(_tmpV3c);
        _tmpV3c.sub(_tmpV3b).normalize();
        if (_tmpV3c.lengthSq() < 1e-8) continue;

        // Delta rotation taking the animated direction to the simulated direction
        _tmpQuat.setFromUnitVectors(chain.baseDirsParent[i], _tmpV3c);
        bone.quaternion.premultiply(_tmpQuat);
        bone.quaternion.normalize();
    }
}

init();
animate();

function init() {
    const container = document.createElement('div');
    container.id = 'arona-container';
    document.body.appendChild(container);

    // UI Elements
    const uiContainer = document.getElementById('ui-container');
    const aronaSelector = document.getElementById('arona-anim-selector');
    const cameraSelector = document.getElementById('camera-anim-selector');
    const playBtn = document.getElementById('play-btn');
    const toggleLightBtn = document.getElementById('btn-toggle-light');
    const toggleShaderBtn = document.getElementById('btn-toggle-shader');
    const bgSwatches = document.querySelectorAll('.bg-swatch');

    // Panel Toggle Buttons
    const btnToggleMain = document.getElementById('btn-toggle-main-panel');
    const btnTogglePhysics = document.getElementById('btn-toggle-physics-panel');
    const uiContent = document.getElementById('ui-content');
    const physicsContent = document.getElementById('physics-content');

    // Boot-time: hide.ui lock + auto-load root settings TXT (if present).
    // Safe to run early; we re-apply after model load for chain restoration.
    _startupLoadSettingsAndUiLock();

    // Autoplay UI Elements
    const autoplayEnabled = document.getElementById('autoplay-enabled');
    const autoplayDelay = document.getElementById('autoplay-delay');
    const valAutoplayDelay = document.getElementById('val-autoplay-delay');

    if (btnToggleMain) {
        btnToggleMain.addEventListener('click', () => {
            if (uiLockedHidden) return;
            if (uiContent.style.display === 'none') {
                uiContent.style.display = 'flex';
                btnToggleMain.textContent = 'Hide';
            } else {
                uiContent.style.display = 'none';
                btnToggleMain.textContent = 'Show';
            }
        });
    }

    if (btnTogglePhysics) {
        btnTogglePhysics.addEventListener('click', () => {
            if (uiLockedHidden) return;
            if (physicsContent.style.display === 'none') {
                physicsContent.style.display = 'block';
                btnTogglePhysics.textContent = 'Hide Physics';
            } else {
                physicsContent.style.display = 'none';
                btnTogglePhysics.textContent = 'Show Physics';
            }
        });
    }

    if (autoplayEnabled) {
        autoplayEnabled.checked = autoplaySettings.enabled;
        autoplayEnabled.addEventListener('change', () => {
            autoplaySettings.enabled = !!autoplayEnabled.checked;
        });
    }

    if (autoplayDelay) {
        if (valAutoplayDelay) valAutoplayDelay.textContent = `${Number(autoplaySettings.delaySec).toFixed(1)}s`;
        autoplayDelay.addEventListener('input', (e) => {
            autoplaySettings.delaySec = parseFloat(e.target.value) || 0;
            if (valAutoplayDelay) valAutoplayDelay.textContent = `${autoplaySettings.delaySec.toFixed(1)}s`;
        });
    }

    // Camera Controls Toggle
    const cameraControlsCheckbox = document.getElementById('camera-controls-disabled');
    if (cameraControlsCheckbox) {
        cameraControlsCheckbox.checked = cameraControlsDisabled;
        cameraControlsCheckbox.addEventListener('change', () => {
            cameraControlsDisabled = !!cameraControlsCheckbox.checked;
            // Reset any keys that might be stuck
            Object.keys(keys).forEach(k => keys[k] = false);
            isRightMouseDown = false;
        });
    }

    // Music UI Elements
    const musicEnabled = document.getElementById('music-enabled');
    const musicDelay = document.getElementById('music-delay');
    const valMusicDelay = document.getElementById('val-music-delay');
    const musicVolume = document.getElementById('music-volume');
    const valMusicVolume = document.getElementById('val-music-volume');
    const musicLoop = document.getElementById('music-loop');
    const musicAudio = document.getElementById('music-audio');

    if (musicEnabled) {
        musicEnabled.checked = musicSettings.enabled;
        musicEnabled.addEventListener('change', () => {
            musicSettings.enabled = !!musicEnabled.checked;
        });
    }

    if (musicLoop) {
        musicLoop.checked = musicSettings.loop;
        musicLoop.addEventListener('change', () => {
            musicSettings.loop = !!musicLoop.checked;
            if (musicAudio) musicAudio.loop = musicSettings.loop;
        });
    }

    if (musicDelay) {
        if (valMusicDelay) valMusicDelay.textContent = `${Number(musicSettings.delaySec).toFixed(1)}s`;
        musicDelay.addEventListener('input', (e) => {
            musicSettings.delaySec = parseFloat(e.target.value) || 0;
            if (valMusicDelay) valMusicDelay.textContent = `${musicSettings.delaySec.toFixed(1)}s`;
        });
    }

    if (musicVolume) {
        if (valMusicVolume) valMusicVolume.textContent = `${Number(musicSettings.volume * 100).toFixed(0)}%`;
        musicVolume.addEventListener('input', (e) => {
            musicSettings.volume = parseFloat(e.target.value) || 0;
            if (valMusicVolume) valMusicVolume.textContent = `${(musicSettings.volume * 100).toFixed(0)}%`;
            if (musicAudio) musicAudio.volume = musicSettings.volume;
        });
    }

    // Seashore UI Elements
    const seashoreEnabled = document.getElementById('seashore-enabled');
    const seashoreDelay = document.getElementById('seashore-delay');
    const valSeashoreDelay = document.getElementById('val-seashore-delay');
    const seashoreVolume = document.getElementById('seashore-volume');
    const valSeashoreVolume = document.getElementById('val-seashore-volume');
    const seashoreLoop = document.getElementById('seashore-loop');
    const seashoreAudio = document.getElementById('seashore-audio');

    if (seashoreEnabled) {
        seashoreEnabled.checked = seashoreSettings.enabled;
        seashoreEnabled.addEventListener('change', () => {
            seashoreSettings.enabled = !!seashoreEnabled.checked;
        });
    }

    if (seashoreLoop) {
        seashoreLoop.checked = seashoreSettings.loop;
        seashoreLoop.addEventListener('change', () => {
            seashoreSettings.loop = !!seashoreLoop.checked;
            if (seashoreAudio) seashoreAudio.loop = seashoreSettings.loop;
        });
    }

    if (seashoreDelay) {
        if (valSeashoreDelay) valSeashoreDelay.textContent = `${Number(seashoreSettings.delaySec).toFixed(1)}s`;
        seashoreDelay.addEventListener('input', (e) => {
            seashoreSettings.delaySec = parseFloat(e.target.value) || 0;
            if (valSeashoreDelay) valSeashoreDelay.textContent = `${seashoreSettings.delaySec.toFixed(1)}s`;
        });
    }

    if (seashoreVolume) {
        if (valSeashoreVolume) valSeashoreVolume.textContent = `${Number(seashoreSettings.volume * 100).toFixed(0)}%`;
        seashoreVolume.addEventListener('input', (e) => {
            seashoreSettings.volume = parseFloat(e.target.value) || 0;
            if (valSeashoreVolume) valSeashoreVolume.textContent = `${(seashoreSettings.volume * 100).toFixed(0)}%`;
            if (seashoreAudio) seashoreAudio.volume = seashoreSettings.volume;
        });
    }

    // Ocean UI Elements
    const skyElevation = document.getElementById('sky-elevation');
    const skyAzimuth = document.getElementById('sky-azimuth');
    const valSkyElevation = document.getElementById('val-sky-elevation');
    const valSkyAzimuth = document.getElementById('val-sky-azimuth');

    const beachRotation = document.getElementById('beach-rotation');
    const valBeachRotation = document.getElementById('val-beach-rotation');

    const skyExposure = document.getElementById('sky-exposure');
    const valSkyExposure = document.getElementById('val-sky-exposure');

    const cloudCoverage = document.getElementById('cloud-coverage');
    const cloudDensity = document.getElementById('cloud-density');
    const cloudElevation = document.getElementById('cloud-elevation');
    const valCloudCoverage = document.getElementById('val-cloud-coverage');
    const valCloudDensity = document.getElementById('val-cloud-density');
    const valCloudElevation = document.getElementById('val-cloud-elevation');

    const waterDistortion = document.getElementById('water-distortion');
    const waterSize = document.getElementById('water-size');
    const valWaterDistort = document.getElementById('val-water-distort');
    const valWaterSize = document.getElementById('val-water-size');
    const btnToggleOcean = document.getElementById('btn-toggle-ocean');

    // Outline UI Elements
    const outlineColor = document.getElementById('outline-color');
    const outlineThickness = document.getElementById('outline-thickness');
    const valOutlineThickness = document.getElementById('val-outline-thickness');

    // Toon Lighting UI Elements
    const toonBands = document.getElementById('toon-bands');
    const valToonBands = document.getElementById('val-toon-bands');
    const toonSoftness1 = document.getElementById('toon-softness');
    const valToonSoftness1 = document.getElementById('val-toon-softness');
    const toonSoftness2 = document.getElementById('toon-softness2');
    const valToonSoftness2 = document.getElementById('val-toon-softness2');
    const toonSoftness3 = document.getElementById('toon-softness3');
    const valToonSoftness3 = document.getElementById('val-toon-softness3');
    const toonTint = document.getElementById('toon-tint');
    const valToonTint = document.getElementById('val-toon-tint');
    const toonAmbient = document.getElementById('toon-ambient');
    const valToonAmbient = document.getElementById('val-toon-ambient');
    const toonShadow = document.getElementById('toon-shadow');
    const valToonShadow = document.getElementById('val-toon-shadow');
    const toonHighlight = document.getElementById('toon-highlight');
    const valToonHighlight = document.getElementById('val-toon-highlight');

    if (outlineColor) {
        outlineColor.addEventListener('input', (e) => {
            toonSettings.edgeColor = e.target.value;
            const color = new THREE.Color(toonSettings.edgeColor);
            materialBindings.forEach(binding => {
                if (binding.toonMaterial && binding.toonMaterial.uniforms.edgeColor) {
                    binding.toonMaterial.uniforms.edgeColor.value.set(color.r, color.g, color.b, 1.0);
                }
                if (binding.outlineMesh && binding.outlineMesh.material) {
                    if (Array.isArray(binding.outlineMesh.material)) {
                        binding.outlineMesh.material.forEach(m => {
                            if (m && m.uniforms && m.uniforms.edgeColor) {
                                m.uniforms.edgeColor.value.set(color.r, color.g, color.b, 1.0);
                            }
                        });
                    } else if (binding.outlineMesh.material.uniforms && binding.outlineMesh.material.uniforms.edgeColor) {
                        binding.outlineMesh.material.uniforms.edgeColor.value.set(color.r, color.g, color.b, 1.0);
                    }
                }
            });
        });
    }

    if (outlineThickness) {
        outlineThickness.addEventListener('input', (e) => {
            toonSettings.edgeWidthRatio = parseFloat(e.target.value);
            if (valOutlineThickness) valOutlineThickness.textContent = toonSettings.edgeWidthRatio.toFixed(3);
            materialBindings.forEach(binding => {
                if (binding.toonMaterial && binding.toonMaterial.uniforms.edgeWidthRatio) {
                    binding.toonMaterial.uniforms.edgeWidthRatio.value = toonSettings.edgeWidthRatio;
                }
                if (binding.outlineMesh && binding.outlineMesh.material) {
                    if (Array.isArray(binding.outlineMesh.material)) {
                        binding.outlineMesh.material.forEach(m => {
                            if (m && m.uniforms && m.uniforms.edgeWidthRatio) {
                                m.uniforms.edgeWidthRatio.value = toonSettings.edgeWidthRatio;
                            }
                        });
                    } else if (binding.outlineMesh.material.uniforms && binding.outlineMesh.material.uniforms.edgeWidthRatio) {
                        binding.outlineMesh.material.uniforms.edgeWidthRatio.value = toonSettings.edgeWidthRatio;
                    }
                }
            });
        });
    }

    // --- Bind Toon Lighting UI ---
    const syncToon = () => {
        _updateToonLightColorsFromSun();
        _applyToonLightingUniforms();
    };

    if (toonBands) {
        if (valToonBands) valToonBands.textContent = String(toonLightingSettings.bands);
        toonBands.addEventListener('input', (e) => {
            toonLightingSettings.bands = parseInt(e.target.value, 10) || 2;
            if (valToonBands) valToonBands.textContent = String(toonLightingSettings.bands);
            syncToon();
        });
    }

    if (toonSoftness1) {
        if (valToonSoftness1) valToonSoftness1.textContent = Number(toonLightingSettings.softness1).toFixed(3);
        toonSoftness1.addEventListener('input', (e) => {
            toonLightingSettings.softness1 = parseFloat(e.target.value);
            // Keep legacy field in sync.
            toonLightingSettings.softness = toonLightingSettings.softness1;
            if (valToonSoftness1) valToonSoftness1.textContent = toonLightingSettings.softness1.toFixed(3);
            syncToon();
        });
    }

    if (toonSoftness2) {
        if (valToonSoftness2) valToonSoftness2.textContent = Number(toonLightingSettings.softness2).toFixed(3);
        toonSoftness2.addEventListener('input', (e) => {
            toonLightingSettings.softness2 = parseFloat(e.target.value);
            if (valToonSoftness2) valToonSoftness2.textContent = toonLightingSettings.softness2.toFixed(3);
            syncToon();
        });
    }

    if (toonSoftness3) {
        if (valToonSoftness3) valToonSoftness3.textContent = Number(toonLightingSettings.softness3).toFixed(3);
        toonSoftness3.addEventListener('input', (e) => {
            toonLightingSettings.softness3 = parseFloat(e.target.value);
            if (valToonSoftness3) valToonSoftness3.textContent = toonLightingSettings.softness3.toFixed(3);
            syncToon();
        });
    }

    if (toonTint) {
        if (valToonTint) valToonTint.textContent = Number(toonLightingSettings.tint).toFixed(2);
        toonTint.addEventListener('input', (e) => {
            toonLightingSettings.tint = parseFloat(e.target.value);
            if (valToonTint) valToonTint.textContent = toonLightingSettings.tint.toFixed(2);
            syncToon();
        });
    }

    if (toonAmbient) {
        if (valToonAmbient) valToonAmbient.textContent = Number(toonLightingSettings.ambient).toFixed(2);
        toonAmbient.addEventListener('input', (e) => {
            toonLightingSettings.ambient = parseFloat(e.target.value);
            if (valToonAmbient) valToonAmbient.textContent = toonLightingSettings.ambient.toFixed(2);
            syncToon();
        });
    }

    if (toonShadow) {
        if (valToonShadow) valToonShadow.textContent = Number(toonLightingSettings.shadow).toFixed(2);
        toonShadow.addEventListener('input', (e) => {
            toonLightingSettings.shadow = parseFloat(e.target.value);
            if (valToonShadow) valToonShadow.textContent = toonLightingSettings.shadow.toFixed(2);
            syncToon();
        });
    }

    if (toonHighlight) {
        if (valToonHighlight) valToonHighlight.textContent = Number(toonLightingSettings.highlight).toFixed(2);
        toonHighlight.addEventListener('input', (e) => {
            toonLightingSettings.highlight = parseFloat(e.target.value);
            if (valToonHighlight) valToonHighlight.textContent = toonLightingSettings.highlight.toFixed(2);
            syncToon();
        });
    }

    // --- Bind Ocean UI ---
    if (skyElevation) {
        if (valSkyElevation) valSkyElevation.textContent = Number(oceanParams.elevation).toFixed(1);
        skyElevation.addEventListener('input', (e) => {
            oceanParams.elevation = parseFloat(e.target.value);
            if (valSkyElevation) valSkyElevation.textContent = oceanParams.elevation.toFixed(1);
            updateSunPosition();
        });
    }
    if (skyAzimuth) {
        if (valSkyAzimuth) valSkyAzimuth.textContent = Number(oceanParams.azimuth).toFixed(1);
        skyAzimuth.addEventListener('input', (e) => {
            oceanParams.azimuth = parseFloat(e.target.value);
            if (valSkyAzimuth) valSkyAzimuth.textContent = oceanParams.azimuth.toFixed(1);
            updateSunPosition();
        });
    }

    if (beachRotation) {
        if (valBeachRotation) valBeachRotation.textContent = Number(oceanParams.worldRotation).toFixed(1);
        beachRotation.addEventListener('input', (e) => {
            oceanParams.worldRotation = parseFloat(e.target.value);
            if (valBeachRotation) valBeachRotation.textContent = oceanParams.worldRotation.toFixed(1);
            updateSunPosition();
        });
    }

    if (skyExposure) {
        if (valSkyExposure) valSkyExposure.textContent = Number(oceanParams.exposure).toFixed(4);
        skyExposure.addEventListener('input', (e) => {
            oceanParams.exposure = parseFloat(e.target.value);
            if (valSkyExposure) valSkyExposure.textContent = oceanParams.exposure.toFixed(4);
            if (renderer) renderer.toneMappingExposure = oceanParams.exposure;
            _applyExposureShadowCompensation();
        });
    }

    const syncCloudUniform = (uniformName, value) => {
        if (!sky || !sky.material || !sky.material.uniforms) return;
        const u = sky.material.uniforms[uniformName];
        if (u && typeof u.value === 'number') u.value = value;
    };

    if (cloudCoverage) {
        if (valCloudCoverage) valCloudCoverage.textContent = Number(oceanParams.cloudCoverage).toFixed(2);
        cloudCoverage.addEventListener('input', (e) => {
            oceanParams.cloudCoverage = parseFloat(e.target.value);
            if (valCloudCoverage) valCloudCoverage.textContent = oceanParams.cloudCoverage.toFixed(2);
            syncCloudUniform('cloudCoverage', oceanParams.cloudCoverage);
        });
    }

    if (cloudDensity) {
        if (valCloudDensity) valCloudDensity.textContent = Number(oceanParams.cloudDensity).toFixed(2);
        cloudDensity.addEventListener('input', (e) => {
            oceanParams.cloudDensity = parseFloat(e.target.value);
            if (valCloudDensity) valCloudDensity.textContent = oceanParams.cloudDensity.toFixed(2);
            syncCloudUniform('cloudDensity', oceanParams.cloudDensity);
        });
    }

    if (cloudElevation) {
        if (valCloudElevation) valCloudElevation.textContent = Number(oceanParams.cloudElevation).toFixed(2);
        cloudElevation.addEventListener('input', (e) => {
            oceanParams.cloudElevation = parseFloat(e.target.value);
            if (valCloudElevation) valCloudElevation.textContent = oceanParams.cloudElevation.toFixed(2);
            syncCloudUniform('cloudElevation', oceanParams.cloudElevation);
        });
    }
    if (waterDistortion) {
        waterDistortion.addEventListener('input', (e) => {
            oceanParams.distortionScale = parseFloat(e.target.value);
            if (valWaterDistort) valWaterDistort.textContent = oceanParams.distortionScale.toFixed(1);
            if (water) water.material.uniforms['distortionScale'].value = oceanParams.distortionScale;
        });
    }
    if (waterSize) {
        waterSize.addEventListener('input', (e) => {
            oceanParams.size = parseFloat(e.target.value);
            if (valWaterSize) valWaterSize.textContent = oceanParams.size.toFixed(1);
            if (water) water.material.uniforms['size'].value = oceanParams.size;
        });
    }
    if (btnToggleOcean) {
        btnToggleOcean.addEventListener('click', () => {
            oceanVisible = !oceanVisible;
            if (water) water.visible = oceanVisible;
            if (sky) sky.visible = oceanVisible;

            if (oceanVisible) {
                btnToggleOcean.textContent = 'Toggle Ocean: ON';
                btnToggleOcean.classList.add('active');
                if (renderTargetEnv) scene.environment = renderTargetEnv.texture;
            } else {
                btnToggleOcean.textContent = 'Toggle Ocean: OFF';
                btnToggleOcean.classList.remove('active');
                scene.environment = null;
            }
        });
    }

    // Hierarchy UI Elements
    const hierarchyUI = document.getElementById('hierarchy-ui');
    const toggleHierarchyBtn = document.getElementById('toggle-hierarchy');
    const closeHierarchyBtn = document.getElementById('close-hierarchy');
    const hierarchyContent = document.getElementById('hierarchy-content');
    const lblStart = document.getElementById('lbl-start');
    const lblEnd = document.getElementById('lbl-end');
    const btnCreatePhys = document.getElementById('btn-create-phys');
    const physMsg = document.getElementById('phys-msg');

    // Global buttons
    const btnCopy = document.getElementById('btn-copy-settings');
    const btnPaste = document.getElementById('btn-paste-settings');

    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            const data = getAllSettings();
            const json = JSON.stringify(data, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                const oldText = btnCopy.textContent;
                btnCopy.textContent = "Copied!";
                setTimeout(() => btnCopy.textContent = oldText, 1500);
            }).catch(err => {
                console.error("Failed to copy", err);
                prompt("Copy this:", json);
            });
        });
    }

    if (btnPaste) {
        btnPaste.addEventListener('click', () => {
            navigator.clipboard.readText().then(text => {
                try {
                    const data = JSON.parse(text);
                    applyAllSettings(data);
                    const oldText = btnPaste.textContent;
                    btnPaste.textContent = "Applied!";
                    setTimeout(() => btnPaste.textContent = oldText, 1500);
                } catch (e) {
                    alert("Invalid JSON on clipboard!");
                }
            }).catch(() => {
                const text = prompt("Paste settings JSON here:");
                if (text) {
                    try {
                        const data = JSON.parse(text);
                        applyAllSettings(data);
                    } catch (e) {
                        alert("Invalid JSON!");
                    }
                }
            });
        });
    }

    // Physics UI Elements (bottom-right)
    const physWindYaw = document.getElementById('phys-wind-yaw');
    const physWindPitch = document.getElementById('phys-wind-pitch');
    const physWind = document.getElementById('phys-wind');
    const physGust = document.getElementById('phys-gust');
    const physTurb = document.getElementById('phys-turb');
    const physWindNoise = document.getElementById('phys-wind-noise');
    const physWindSpread = document.getElementById('phys-wind-spread');
    const physGravity = document.getElementById('phys-gravity');
    const physDamping = document.getElementById('phys-damping');
    const physIter = document.getElementById('phys-iter');
    const physBend = document.getElementById('phys-bend');

    const valWindYaw = document.getElementById('val-wind-yaw');
    const valWindPitch = document.getElementById('val-wind-pitch');
    const valWind = document.getElementById('val-wind');
    const valGust = document.getElementById('val-gust');
    const valTurb = document.getElementById('val-turb');
    const valWindNoise = document.getElementById('val-wind-noise');
    const valWindSpread = document.getElementById('val-wind-spread');
    const valGravity = document.getElementById('val-gravity');
    const valDamping = document.getElementById('val-damping');
    const valIter = document.getElementById('val-iter');
    const valBend = document.getElementById('val-bend');

    const syncPhysicsUI = () => {
        if (valWindYaw) valWindYaw.textContent = `${Math.round(hairPhysicsSettings.windYawDeg)}°`;
        if (valWindPitch) valWindPitch.textContent = `${Math.round(hairPhysicsSettings.windPitchDeg)}°`;
        if (valWind) valWind.textContent = `${hairPhysicsSettings.windStrength.toFixed(1)}`;
        if (valGust) valGust.textContent = `${hairPhysicsSettings.gustStrength.toFixed(2)}`;
        if (valTurb) valTurb.textContent = `${hairPhysicsSettings.turbulence.toFixed(2)}`;
        if (valWindNoise) valWindNoise.textContent = `${hairPhysicsSettings.windNoise.toFixed(1)}`;
        if (valWindSpread) valWindSpread.textContent = `${hairPhysicsSettings.windSpread.toFixed(2)}`;
        if (valGravity) valGravity.textContent = `${hairPhysicsSettings.gravity.toFixed(1)}`;
        if (valDamping) valDamping.textContent = `${hairPhysicsSettings.damping.toFixed(3)}`;
        if (valIter) valIter.textContent = `${hairPhysicsSettings.iterations}`;
        if (valBend) valBend.textContent = `${hairPhysicsSettings.bendAllowed.toFixed(2)}`;
    };

    const bindRange = (el, onChange) => {
        if (!el) return;
        const handler = () => {
            onChange(el.value);
            syncPhysicsUI();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    };

    bindRange(physWindYaw, (v) => hairPhysicsSettings.windYawDeg = parseFloat(v));
    bindRange(physWindPitch, (v) => hairPhysicsSettings.windPitchDeg = parseFloat(v));
    bindRange(physWind, (v) => hairPhysicsSettings.windStrength = parseFloat(v));
    bindRange(physGust, (v) => hairPhysicsSettings.gustStrength = parseFloat(v));
    bindRange(physTurb, (v) => hairPhysicsSettings.turbulence = parseFloat(v));
    bindRange(physWindNoise, (v) => hairPhysicsSettings.windNoise = parseFloat(v));
    bindRange(physWindSpread, (v) => hairPhysicsSettings.windSpread = parseFloat(v));
    bindRange(physGravity, (v) => hairPhysicsSettings.gravity = parseFloat(v));
    bindRange(physDamping, (v) => hairPhysicsSettings.damping = parseFloat(v));
    bindRange(physIter, (v) => hairPhysicsSettings.iterations = Math.max(1, Math.floor(parseFloat(v))));
    bindRange(physBend, (v) => hairPhysicsSettings.bendAllowed = Math.max(0, Math.min(1, parseFloat(v))));

    syncPhysicsUI();

    if (hierarchyContent) {
        hierarchyContent.textContent = 'Waiting for model to load…';
    }

    // Hierarchy Resizer Logic
    const resizer = document.getElementById('hierarchy-resizer');
    let isResizing = false;

    // Search Box Logic
    const searchInput = document.getElementById('hierarchy-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (uiLockedHidden) return;
            if (!query) {
                // Restore full hierarchy
                if (model) renderHierarchy([model]);
            } else {
                // Render search results as a flat list
            if (uiLockedHidden) return;
                renderSearchResults(query);
            }
        });
    }

    function renderSearchResults(query) {
        if (!hierarchyContent) return;
        if (!model) {
            hierarchyContent.textContent = 'Waiting for model to load…';
            return;
        }
        hierarchyContent.innerHTML = '';

        const results = [];
        model.traverse((obj) => {
            if (obj.name && obj.name.toLowerCase().includes(query)) {
                results.push(obj);
            }
        });

        if (results.length === 0) {
            hierarchyContent.textContent = "No matches found.";
            return;
        }

        results.forEach(obj => {
            // Re-use logical node creation but flat depth
            const div = document.createElement('div');
            div.className = 'node';
            div.style.paddingLeft = '5px';
            div.style.borderBottom = '1px solid #333';

            const nameSpan = document.createElement('span');
            const typeTag = obj.isBone ? ' [Bone]' : obj.isMesh ? ' [Mesh]' : obj.isSkinnedMesh ? ' [SkinnedMesh]' : obj.isCamera ? ' [Camera]' : obj.isLight ? ' [Light]' : ` [${obj.type}]`;
            nameSpan.textContent = (obj.name || `(unnamed)`) + typeTag;

            // Mark if already selected
            if (obj === selectedStartBone) nameSpan.classList.add('selected-start');
            if (obj === selectedEndBone) nameSpan.classList.add('selected-end');

            obj.elName = nameSpan;
            div.appendChild(nameSpan);

            if (obj.isBone) {
                const btnStart = document.createElement('button');
                btnStart.className = 'xs-btn';
                btnStart.textContent = 'S';
                btnStart.onclick = () => {
                    if (selectedStartBone && selectedStartBone.elName) selectedStartBone.elName.classList.remove('selected-start');
                    selectedStartBone = obj;
                    nameSpan.classList.add('selected-start');
                    if (lblStart) lblStart.textContent = obj.name;
                };

                const btnEnd = document.createElement('button');
                btnEnd.className = 'xs-btn';
                btnEnd.textContent = 'E';
                btnEnd.onclick = () => {
                    if (selectedEndBone && selectedEndBone.elName) selectedEndBone.elName.classList.remove('selected-end');
                    selectedEndBone = obj;
                    nameSpan.classList.add('selected-end');
                    if (lblEnd) lblEnd.textContent = obj.name;
                };

                div.appendChild(btnStart);
                div.appendChild(btnEnd);
            }
            hierarchyContent.appendChild(div);
        });
    }

    if (resizer && hierarchyUI) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none'; // Prevent text selection
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Prevent panel from getting too small or negative
            const newWidth = Math.max(200, e.clientX);
            // Optional: limit max width if you want
            if (newWidth < window.innerWidth * 0.8) {
                hierarchyUI.style.width = newWidth + 'px';
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    const hierarchyReady = !!(hierarchyUI && toggleHierarchyBtn && closeHierarchyBtn && hierarchyContent && lblStart && lblEnd && btnCreatePhys && physMsg);
    if (!hierarchyReady) {
        console.warn('[Hierarchy] UI elements missing. Check index.html ids:', {
            hierarchyUI: !!hierarchyUI,
            toggleHierarchyBtn: !!toggleHierarchyBtn,
            closeHierarchyBtn: !!closeHierarchyBtn,
            hierarchyContent: !!hierarchyContent,
            lblStart: !!lblStart,
            lblEnd: !!lblEnd,
            btnCreatePhys: !!btnCreatePhys,
            physMsg: !!physMsg,
        });
    } else {
        toggleHierarchyBtn.addEventListener('click', () => {
            if (uiLockedHidden) return;
            if (model) renderHierarchy([model]);
            hierarchyUI.style.display = 'block';
            toggleHierarchyBtn.style.display = 'none';
        });

        closeHierarchyBtn.addEventListener('click', () => {
            if (uiLockedHidden) return;
            hierarchyUI.style.display = 'none';
            toggleHierarchyBtn.style.display = 'block';
        });
    }

    // Handle Physics Creation
    btnCreatePhys?.addEventListener('click', () => {
        if (!selectedStartBone || !selectedEndBone) {
            if (physMsg) physMsg.textContent = "Please select both Start and End bones.";
            return;
        }

        // Validate chain
        let chain = [];
        let curr = selectedEndBone;
        let found = false;

        // Traverse up from end to find start
        while (curr) {
            chain.unshift(curr); // Add to front
            if (curr === selectedStartBone) {
                found = true;
                break;
            }
            curr = curr.parent;
        }

        if (!found) {
            if (physMsg) physMsg.textContent = "End bone must be a descendant of Start bone!";
            return;
        }

        if (!model) return;
        model.updateMatrixWorld(true);

        const newChain = createVerletHairChain(chain);

        physicsChains.push(newChain);
        updateChainsListUI(); // Update list display
        if (physMsg) physMsg.textContent = `Chain created with ${chain.length} bones!`;

        // Reset selection
        if (selectedStartBone && selectedStartBone.elName) selectedStartBone.elName.classList.remove('selected-start');
        if (selectedEndBone && selectedEndBone.elName) selectedEndBone.elName.classList.remove('selected-end');
        selectedStartBone = null;
        selectedEndBone = null;
        if (lblStart) lblStart.textContent = "None";
        if (lblEnd) lblEnd.textContent = "None";
    });

    // Function to render hierarchy
    function renderHierarchy(rootBones) {
        if (!hierarchyContent) return;
        hierarchyContent.innerHTML = '';

        const createNode = (obj, depth) => {
            const div = document.createElement('div');
            div.className = 'node';
            div.style.paddingLeft = (depth * 15) + 'px';

            const nameSpan = document.createElement('span');
            // Show name + type tag so user can identify everything
            const typeTag = obj.isBone ? ' [Bone]' : obj.isMesh ? ' [Mesh]' : obj.isSkinnedMesh ? ' [SkinnedMesh]' : obj.isCamera ? ' [Camera]' : obj.isLight ? ' [Light]' : ` [${obj.type}]`;
            nameSpan.textContent = (obj.name || `(unnamed)`) + typeTag;
            obj.elName = nameSpan;
            div.appendChild(nameSpan);

            if (obj.isBone) {
                const btnStart = document.createElement('button');
                btnStart.className = 'xs-btn';
                btnStart.textContent = 'S';
                btnStart.title = 'Make Starting Bone';
                btnStart.onclick = () => {
                    if (selectedStartBone && selectedStartBone.elName) selectedStartBone.elName.classList.remove('selected-start');
                    selectedStartBone = obj;
                    nameSpan.classList.add('selected-start');
                    lblStart.textContent = obj.name;
                };

                const btnEnd = document.createElement('button');
                btnEnd.className = 'xs-btn';
                btnEnd.textContent = 'E';
                btnEnd.title = 'Make End Bone';
                btnEnd.onclick = () => {
                    if (selectedEndBone && selectedEndBone.elName) selectedEndBone.elName.classList.remove('selected-end');
                    selectedEndBone = obj;
                    nameSpan.classList.add('selected-end');
                    lblEnd.textContent = obj.name;
                };

                div.appendChild(btnStart);
                div.appendChild(btnEnd);
            }

            if (obj.children && obj.children.length > 0) {
                obj.children.forEach(child => {
                    const childNode = createNode(child, depth + 1);
                    if (childNode) div.appendChild(childNode);
                });
            }
            return div;
        };

        rootBones.forEach(b => {
            const node = createNode(b, 0);
            if (node) hierarchyContent.appendChild(node);
        });
    }

    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Dark background
    scene.fog = new THREE.Fog(0x111111, 2, 2000); // Increased fog for ocean

    // Toggle Light Logic
    if (toggleLightBtn) {
        toggleLightBtn.addEventListener('click', () => {
            lightsOn = !lightsOn;
            scene.traverse((obj) => {
                if (obj.isLight) obj.visible = lightsOn;
            });
            toonMaterials.forEach((material) => {
                material.uniforms.lightIntensity.value = lightsOn ? 1.0 : 0.0;
            });
            toggleLightBtn.classList.toggle('active', !lightsOn);
        });
    }

    bgSwatches.forEach((swatch) => {
        swatch.addEventListener('click', () => {
            const color = swatch.getAttribute('data-color') || '#111111';
            scene.background = new THREE.Color(color);
            scene.fog.color = new THREE.Color(color);
            bgSwatches.forEach((button) => button.classList.remove('active'));
            swatch.classList.add('active');
        });
    });

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(0, 1.5, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true, outputBufferType: THREE.HalfFloatType });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.debug.checkShaderErrors = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = oceanParams.exposure;
    renderer.autoClear = false; // We manually clear between toon passes
    container.appendChild(renderer.domElement);

    // Setup PMREM for Ocean/Sky reflection
    pmremGenerator = new THREE.PMREMGenerator(renderer);
    envScene = new THREE.Scene();

    // --- Water & Sky Setup ---
    sun = new THREE.Vector3();

    const waterGeometry = new THREE.PlaneGeometry(10000, 10000);

    water = new Water(
        waterGeometry,
        {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: new THREE.TextureLoader().load(new URL('./textures/waternormals.jpg', import.meta.url).href, function (texture) {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            }),
            sunDirection: new THREE.Vector3(),
            sunColor: 0xffffff,
            waterColor: 0x001e0f,
            distortionScale: oceanParams.distortionScale,
            size: oceanParams.size,
            fog: scene.fog !== undefined
        }
    );

    water.rotation.x = -Math.PI / 2;
    // Lower water slightly so it doesn't clip with the character's feet if placed at 0
    water.position.y = -0.5;
    scene.add(water);

    sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);

    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    // Beach sky (ONLYWATER) supports optional cloud uniforms.
    if (skyUniforms['cloudCoverage']) skyUniforms['cloudCoverage'].value = oceanParams.cloudCoverage;
    if (skyUniforms['cloudDensity']) skyUniforms['cloudDensity'].value = oceanParams.cloudDensity;
    if (skyUniforms['cloudElevation']) skyUniforms['cloudElevation'].value = oceanParams.cloudElevation;

    updateSunPosition();


    clock = new THREE.Clock();

    // 4. Lighting
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(0, 20, 10);
    scene.add(dirLight);

    _applyExposureShadowCompensation();

    // 5. Load Model
    const loader = new GLTFLoader();

    // IMPORTANT: This is where it looks for your model!
    loader.load(new URL('./models/arona.glb', import.meta.url).href, async function (gltf) {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';

        // Update loading overlay - show the Enter button
        const loaderBarFill = document.getElementById('loader-bar-fill');
        const loaderPercent = document.getElementById('loader-percent');
        const loaderEnterBtn = document.getElementById('loader-enter-btn');
        
        if (loaderBarFill) loaderBarFill.style.width = '100%';
        if (loaderPercent) loaderPercent.textContent = 'Ready!';
        if (loaderEnterBtn) {
            loaderEnterBtn.classList.add('visible');
            loaderEnterBtn.addEventListener('click', (e) => {
                // Prevent this click from propagating to scene event listeners
                e.stopPropagation();
                e.preventDefault();
                
                userEnteredScene = true;
                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    overlay.classList.add('hidden');
                    // Small delay to ensure overlay transition starts before enabling scene interactions
                    setTimeout(() => {
                        // Now safe to start audio/animations
                        if (pendingStartupSettings) {
                            _scheduleAutoplayIfEnabled();
                            _scheduleMusicIfEnabled();
                            _scheduleSeashoreIfEnabled();
                        }
                    }, 100);
                }
            }, { once: true });
        }

        // Ensure hide.ui is checked before revealing any UI.
        await _checkHideUiLockOnce();
        if (!uiLockedHidden && uiContainer) uiContainer.style.display = 'flex';

        model = gltf.scene;
        scene.add(model);

        // Remove/disable any baked-in glTF light gizmo (e.g. a DirectionalLight named "Sun").
        // We use the beach sky/sun implementation instead.
        const importedSunLight = model.getObjectByName('Sun');
        if (importedSunLight && importedSunLight.isLight && importedSunLight.parent) {
            importedSunLight.parent.remove(importedSunLight);
        }

        // Build Hierarchy UI immediately once the model is available.
        // This lists *everything* in the glTF scene graph (including bones).
        renderHierarchy([model]);

        // Auto-open the hierarchy so it's immediately visible.
        if (!uiLockedHidden && hierarchyUI && toggleHierarchyBtn) {
            hierarchyUI.style.display = 'block';
            toggleHierarchyBtn.style.display = 'none';
        }

        // Helpful debug dump (so you can confirm bones exist even if UI is hidden)
        try {
            let boneCount = 0;
            let nodeCount = 0;
            model.traverse((o) => {
                nodeCount++;
                if (o.isBone) boneCount++;
            });
            console.log(`[Hierarchy] Model loaded. Nodes: ${nodeCount}, Bones: ${boneCount}`);
        } catch (e) {
            console.warn('[Hierarchy] Debug traverse failed:', e);
        }

        // --- Toon Shader Texture Assignment ---
        const textureLoader = new THREE.TextureLoader();
        const stepTex = createStepTexture();

        // Load all textures from the Textures folder
        const loadTex = (file, srgb = true) => {
            const t = textureLoader.load(new URL(`./models/Textures/${file}`, import.meta.url).href);
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.flipY = false;
            return t;
        };

        const textures = {
            body: loadTex('body.png'),
            body_normal: loadTex('body_normal.png', false),
            cloth: loadTex('cloth.png'),
            cloth_normal: loadTex('cloth normal.png', false),
            face: loadTex('face.png'),
            hair: loadTex('hair.png'),
            halo: loadTex('halo.png'),
        };

        // 1x1 white fallback normal map (flat surface)
        const flatNormal = new THREE.DataTexture(
            new Uint8Array([128, 128, 255, 255]), 1, 1
        );
        flatNormal.needsUpdate = true;

        model.traverse((child) => {
            if (!child.isMesh) return;

            // Fix culling issues for skinned meshes
            child.frustumCulled = false;

            const matList = Array.isArray(child.material) ? child.material : [child.material];
            const originalMaterial = child.material;

            const toonMats = matList.map((mat) => {
                const name = mat.name.toLowerCase();

                let colorTex = null;
                let normalTex = flatNormal;
                let transparent = false;
                let alphaTest = 0;

                if (name.includes('cloth')) {
                    colorTex = textures.cloth;
                    normalTex = textures.cloth_normal;
                } else if (name.includes('hair')) {
                    colorTex = textures.hair;
                    transparent = false;
                    alphaTest = 0.5;
                } else if (name.includes('halo')) {
                    colorTex = textures.halo;
                    transparent = true;
                    alphaTest = 0.1;
                } else if (name.includes('face') || name.includes('eyes')) {
                    colorTex = textures.face;
                    transparent = false;
                    alphaTest = 0.1;
                } else if (name.includes('body')) {
                    colorTex = textures.body;
                    normalTex = textures.body_normal;
                }

                // If no matching texture found, skip toon shader for this slot
                if (!colorTex) return mat;

                const litMat = new THREE.MeshStandardMaterial({
                    map: colorTex,
                    normalMap: normalTex,
                    transparent,
                    alphaTest,
                    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
                    roughness: 1.0,
                    metalness: 0.0,
                    skinning: child.isSkinnedMesh,
                });

                const toonMat = createToonMaterial(stepTex, colorTex, normalTex, {
                    lightDirection: sharedLightDirection,
                    transparent,
                    alphaTest,
                    // Toon banding + tint (defaults wired from UI)
                    toonBands: toonLightingSettings.bands,
                    toonSoftness1: toonLightingSettings.softness1,
                    toonSoftness2: toonLightingSettings.softness2,
                    toonSoftness3: toonLightingSettings.softness3,
                    toonT1: toonLightingSettings.t1,
                    toonT2: toonLightingSettings.t2,
                    toonT3: toonLightingSettings.t3,
                    toonShadow: toonLightingSettings.shadow,
                    toonMid: toonLightingSettings.mid,
                    toonLight: toonLightingSettings.light,
                    toonHighlight: toonLightingSettings.highlight,
                    lightColor: _toonSunColor,
                    ambientColor: _toonAmbientColor,
                    edgeColor: new THREE.Vector4(
                        new THREE.Color(toonSettings.edgeColor).r,
                        new THREE.Color(toonSettings.edgeColor).g,
                        new THREE.Color(toonSettings.edgeColor).b,
                        1.0
                    ),
                    edgeWidthRatio: toonSettings.edgeWidthRatio,
                    skinning: child.isSkinnedMesh,
                });

                const toonOutlineMat = toonMat.clone();
                toonOutlineMat.uniforms = THREE.UniformsUtils.clone(toonMat.uniforms);
                toonOutlineMat.uniforms.edge.value = true;
                toonOutlineMat.side = THREE.BackSide;
                toonOutlineMat.depthWrite = false;

                toonMat.uniforms.edge.value = false;
                toonMat.side = transparent ? THREE.DoubleSide : THREE.FrontSide;

                toonMat.uniforms.lightIntensity.value = lightsOn ? 1.0 : 0.0;
                toonOutlineMat.uniforms.lightIntensity.value = lightsOn ? 1.0 : 0.0;

                toonMaterials.push(toonMat);
                toonMaterials.push(toonOutlineMat);
                return { toonMat, toonOutlineMat, litMat };
            });

            const hasMappedMats = toonMats.some((item) => typeof item === 'object' && item.toonMat);
            if (hasMappedMats) {
                const toonMaterial = toonMats.map((item, idx) => (typeof item === 'object' && item.toonMat) ? item.toonMat : matList[idx]);
                const toonOutlineMaterial = toonMats.map((item, idx) => (typeof item === 'object' && item.toonOutlineMat) ? item.toonOutlineMat : null);
                const litMaterial = toonMats.map((item, idx) => (typeof item === 'object' && item.litMat) ? item.litMat : matList[idx]);

                const toonAssigned = toonMaterial.length === 1 ? toonMaterial[0] : toonMaterial;
                const outlineAssigned = toonOutlineMaterial.length === 1 ? toonOutlineMaterial[0] : toonOutlineMaterial;
                const litAssigned = litMaterial.length === 1 ? litMaterial[0] : litMaterial;

                // Create the Inverse Hull outline mesh
                // We physically clone the mesh so its outline renders automatically
                // without needing to fight uniform sync issues.
                const outlineMesh = child.clone(true);
                outlineMesh.material = outlineAssigned;
                outlineMesh.visible = useToonShader; // only visible if toon is on
                child.parent.add(outlineMesh); // Add precisely where the parent is so animations sync

                materialBindings.push({
                    mesh: child,
                    originalMaterial,
                    toonMaterial: toonAssigned,
                    outlineMesh: outlineMesh,
                    litMaterial: litAssigned
                });
                child.material = useToonShader ? toonAssigned : litAssigned;
            }
        });
        // -----------------------------------------

        // Apply current toon lighting settings now that materials exist.
        _updateToonLightColorsFromSun();
        _applyToonLightingUniforms();
        _applyExposureShadowCompensation();

        toggleShaderBtn.addEventListener('click', () => {
            useToonShader = !useToonShader;
            materialBindings.forEach((binding) => {
                binding.mesh.material = useToonShader ? binding.toonMaterial : binding.litMaterial;
                binding.outlineMesh.visible = useToonShader;
            });
            toggleShaderBtn.textContent = useToonShader ? 'Toon Shader: ON' : 'Toon Shader: OFF';
            toggleShaderBtn.classList.toggle('active', useToonShader);
        });

        // Check for imported Camera
        let importedCamera = null;
        if (gltf.cameras && gltf.cameras.length > 0) {
            importedCamera = gltf.cameras[0];
        } else {
            model.traverse((child) => {
                if (child.isCamera && child.name === 'Camera') importedCamera = child;
            });
        }

        if (importedCamera) {
            camera = importedCamera;
            camera.near = 0.01; // Ensure near plane is small enough for closeups
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();

            console.log("Using imported Camera from GLTF");
        }

        // Setup animations if they exist
        mixer = new THREE.AnimationMixer(model);

        if (gltf.animations && gltf.animations.length > 0) {
            gltf.animations.forEach((clip, index) => {
                const name = clip.name || `Animation ${index + 1}`;

                // Determine if this is a camera animation
                const lowerName = name.toLowerCase();
                const isCameraAnim = lowerName.includes('camera') || clip.tracks.some((track) => track.name.toLowerCase().includes('camera'));

                if (isCameraAnim) {
                    cameraActions[name] = mixer.clipAction(clip);
                    if (cameraSelector) {
                        const option = document.createElement('option');
                        option.value = name;
                        option.textContent = name;
                        cameraSelector.appendChild(option);
                    }
                } else {
                    aronaActions[name] = mixer.clipAction(clip);
                    if (aronaSelector) {
                        const option = document.createElement('option');
                        option.value = name;
                        option.textContent = name;
                        aronaSelector.appendChild(option);
                    }
                }
            });

            if (aronaSelector && aronaSelector.options.length > 0) aronaSelector.selectedIndex = 0;
            if (cameraSelector && cameraSelector.options.length > 0) cameraSelector.selectedIndex = 0;

            // Play button logic
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    playSelectedAnimations();
                });
            }
        }

        // Find the finger mesh (you might need to adjust the name based on your actual model)
        model.traverse((child) => {
            if (child.isMesh) {
                // Looking for a mesh named "finger" or similar
                if (child.name.toLowerCase().includes("finger")) {
                    fingerMesh = child;
                }
            }
        });

        // If no specific finger mesh is found, fallback to the whole model for testing
        if (!fingerMesh) {
            console.warn("Finger mesh not found! Using the whole model for click detection.");
            fingerMesh = model;
        }

        // Re-apply startup settings now that the model exists (restores chains).
        if (pendingStartupSettings) {
            applyAllSettings(pendingStartupSettings);
        }

        // Note: Autoplay/audio scheduling is now triggered by the Enter button click
        // to satisfy browser autoplay policies.

    }, function (xhr) {
        // Progress callback for loading bar
        const loaderBarFill = document.getElementById('loader-bar-fill');
        const loaderPercent = document.getElementById('loader-percent');
        if (xhr.lengthComputable) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            if (loaderBarFill) loaderBarFill.style.width = percent + '%';
            if (loaderPercent) loaderPercent.textContent = 'Loading... ' + percent + '%';
        } else {
            // If length is not computable, show indeterminate loading
            if (loaderPercent) loaderPercent.textContent = 'Loading...';
        }
    }, function (error) {
        console.error('Error loading model:', error);
        const loaderPercent = document.getElementById('loader-percent');
        const loaderBarFill = document.getElementById('loader-bar-fill');
        if (loaderPercent) {
            loaderPercent.innerHTML = '<span style="color:#e94560;">Error loading model.<br>Did you place arona.glb in the models folder?</span>';
        }
        if (loaderBarFill) {
            loaderBarFill.style.background = '#e94560';
        }
    });

    // 5. Post Processing Setup
    // Render Target for the scene (taking high DPI into account)
    sceneTarget = new THREE.WebGLRenderTarget(
        window.innerWidth * window.devicePixelRatio,
        window.innerHeight * window.devicePixelRatio
    );

    // Setup Composer with our custom Ripple Shader
    composer = new EffectComposer(renderer);

    const texturePass = new TexturePass(sceneTarget.texture);
    composer.addPass(texturePass);

    // Beach-style bloom (subtle, like ONLYWATER/beach)
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,
        0.4,
        0.85
    );
    bloomPass.threshold = 0;
    bloomPass.strength = 0.1;
    bloomPass.radius = 0;
    composer.addPass(bloomPass);

    ripplePass = new ShaderPass(WaterRippleShader);
    ripplePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    composer.addPass(ripplePass);

    // 6. Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousedown', onClick); // Ripple on press, not release
    window.addEventListener('touchstart', onTouch, { passive: false }); // For mobile

    // Camera Controls Event Listeners
    window.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click menu

    window.addEventListener('mousedown', (e) => {
        if (e.button === 2 && !cameraControlsDisabled) isRightMouseDown = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) isRightMouseDown = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (isRightMouseDown && camera && !cameraControlsDisabled) {
            euler.setFromQuaternion(camera.quaternion);
            euler.y -= e.movementX * lookSpeed;
            euler.x -= e.movementY * lookSpeed;
            // Clamp vertical rotation to prevent flipping
            euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
            camera.quaternion.setFromEuler(euler);
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !_isTextInputFocused()) {
            e.preventDefault();
            playSelectedAnimations();
            return;
        }
        if (cameraControlsDisabled) return;
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = true;
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });

}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Update Composer & Shaders
    const width = window.innerWidth * window.devicePixelRatio;
    const height = window.innerHeight * window.devicePixelRatio;

    sceneTarget.setSize(width, height);
    composer.setSize(window.innerWidth, window.innerHeight); // EffectComposer handles dPR internally? Usually no.
    // Wait, EffectComposer's renderer.setSize() is usually enough if it manages render targets.
    // But here sceneTarget is ours.

    if (ripplePass) {
        ripplePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    }

    if (bloomPass) {
        bloomPass.setSize(window.innerWidth, window.innerHeight);
    }
}


let rippleIndex = 0;
function addRipple(u, v) {
    if (!ripplePass) return;
    const ripples = ripplePass.uniforms.uRipples.value;
    const count = ripplePass.uniforms.uRippleCount.value;

    // Cycle through ripples array using simple circular buffer
    ripples[rippleIndex].set(u, v, clock.getElapsedTime(), 0.05); // x, y, time, amplitude

    rippleIndex = (rippleIndex + 1) % ripples.length;

    // Increase active count if we haven't filled the array yet
    if (count < ripples.length) {
        ripplePass.uniforms.uRippleCount.value = count + 1;
    }
}

function checkIntersection(clientX, clientY) {
    if (window.__eonoIntro?.disableInteraction || window.__eonoIntro?.stopRender) return;
    if (!fingerMesh) return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check intersection with the finger (or model if fallback)
    const intersects = raycaster.intersectObject(fingerMesh, true);

    // Visual Ripple Effect on Click/Tap (screen space)
    if (ripplePass) {
        // Convert mouse ndc to uv for ripple center
        const uvX = (mouse.x + 1) / 2;
        const uvY = (mouse.y + 1) / 2;
        addRipple(uvX, uvY);
    }

    if (intersects.length > 0) {
        console.log("Finger tapped!");

        const onFingerTap = window.__eonoIntro?.onFingerTap;
        if (typeof onFingerTap === 'function') {
            try {
                onFingerTap();
            } catch (e) {
                console.error('[Intro] onFingerTap failed', e);
            }
            return;
        }

        // Fade out the screen
        document.body.style.opacity = 0;

        // Wait for fade out, then redirect
        setTimeout(() => {
            window.location.href = new URL('./home.html', import.meta.url).href;
        }, 1000);
    }
}

function onClick(event) {
    // Ignore clicks on loading overlay or its children
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
        return;
    }
    
    // Don't let UI interactions trigger the 3D scene click behavior.
    if (event.target && event.target.closest && event.target.closest('#hierarchy-ui, #toggle-hierarchy, #ui-container, #physics-ui, #loading-overlay')) {
        return;
    }
    checkIntersection(event.clientX, event.clientY);
}

function onTouch(event) {
    if (event.touches.length > 0) {
        // Ignore touches on loading overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
            return;
        }
        
        const target = event.target;
        if (target && target.closest && target.closest('#hierarchy-ui, #toggle-hierarchy, #ui-container, #physics-ui, #loading-overlay')) {
            return;
        }
        checkIntersection(event.touches[0].clientX, event.touches[0].clientY);
    }
}

function animate() {
    if (window.__eonoIntro?.stopRender) return;
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    // Use elapsedTime for consistent time reference
    const time = clock.getElapsedTime();

    // Update animations first (physics will be layered on top)
    if (mixer) mixer.update(delta);

    // Beach sky time (cloud animation)
    if (sky && sky.material && sky.material.uniforms && sky.material.uniforms['time']) {
        sky.material.uniforms['time'].value = performance.now() * 0.001;
    }

    // --- Physics Update ---
    if (physicsChains.length > 0 && model) {
        // Ensure matrices are current before sampling bone world positions
        model.updateMatrixWorld(true);
        let chainIndex = 0;
        for (const chain of physicsChains) {
            simulateVerletHairChain(chain, delta, time, chainIndex++);
        }
        // Ensure skinning sees updated bone transforms
        model.updateMatrixWorld(true);
    }

    // Update Ripple Shader Time
    if (ripplePass) {
        ripplePass.uniforms.uTime.value = time;
    }

    // Update Ocean and Sky uniforms
    if (water && oceanVisible) {
        water.material.uniforms['time'].value += delta;
    }

    // Camera Movement (WASD + QE)
    if (camera) {
        const direction = new THREE.Vector3();
        const right = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        camera.getWorldDirection(direction);
        right.crossVectors(direction, up).normalize();

        if (keys.w) camera.position.addScaledVector(direction, moveSpeed * delta);
        if (keys.s) camera.position.addScaledVector(direction, -moveSpeed * delta);
        if (keys.a) camera.position.addScaledVector(right, -moveSpeed * delta);
        if (keys.d) camera.position.addScaledVector(right, moveSpeed * delta);
        if (keys.e) camera.position.addScaledVector(up, moveSpeed * delta);
        if (keys.q) camera.position.addScaledVector(up, -moveSpeed * delta);
    }

    // --- Render Scene ---
    // Since we're using inverse hull, outlines are just static mesh children,
    // so we render the scene in a single clean pass natively.
    if (sceneTarget) {
        renderer.setRenderTarget(sceneTarget);
        renderer.clear();
        renderer.render(scene, camera);
    } else {
        renderer.render(scene, camera);
    }

    // --- Post Processing Output ---
    if (composer) {
        // Reset render target to screen and render composer chain
        renderer.setRenderTarget(null);
        composer.render();
    }
}

// Function to update the sun position for Sky and Water
function updateSunPosition() {
    if (!sky || !water || !sun) return;

    const phi = THREE.MathUtils.degToRad(90 - oceanParams.elevation);
    const theta = THREE.MathUtils.degToRad(oceanParams.azimuth + oceanParams.worldRotation);

    sun.setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms['sunPosition'].value.copy(sun);
    water.material.uniforms['sunDirection'].value.copy(sun).normalize();

    // Use Sky as environment lighting for toon shader (optional)
    if (renderTargetEnv !== undefined) renderTargetEnv.dispose();

    // PMREMGenerator.fromScene expects a Scene; generate the env map from a temp env scene.
    const prevParent = sky.parent;
    if (prevParent) prevParent.remove(sky);
    envScene.add(sky);
    renderTargetEnv = pmremGenerator.fromScene(envScene);
    envScene.remove(sky);
    if (prevParent) prevParent.add(sky);

    if (oceanVisible) {
        scene.environment = renderTargetEnv.texture;
    }

    // Toon shader expects lightDirection as incoming light ray direction (light -> surface).
    // The sun vector points origin -> sun, so invert it for shading.
    sharedLightDirection.copy(sun).multiplyScalar(-1).normalize();
    for (const material of toonMaterials) {
        if (material?.uniforms?.lightDirection) {
            material.uniforms.lightDirection.value.copy(sharedLightDirection);
        }
    }

    _updateToonLightColorsFromSun();
    _applyToonLightingUniforms();
}