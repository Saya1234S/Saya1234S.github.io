// ========================================
// PAINTONO - Brush Engine
// ========================================

const Brushes = {
    presets: [],
    currentPreset: 0,

    // Current settings (active values)
    size: 10,
    opacity: 100,
    hardness: 100,
    flow: 100,
    spacing: 0.15,
    stabilization: 0,
    pressureSize: false,
    pressureOpacity: false,

    // Per-tool saved settings
    _toolSettings: {},

    // Stroke temp canvas for proper opacity compositing
    _strokeCanvas: null,
    _strokeCtx: null,

    // Stabilizer state
    stabilizerPoints: [],

    init() {
        this.createPresets();
        this.renderPresets();
        this.bindOptions();
        // Initialize per-tool defaults
        this._toolSettings = {
            brush:   { size: 10, opacity: 100, hardness: 100, preset: 0, pressureSize: false, pressureOpacity: false, stabilization: 0 },
            pencil:  { size: 3,  opacity: 100, hardness: 100, preset: 0, pressureSize: false, pressureOpacity: false, stabilization: 0 },
            eraser:  { size: 20, opacity: 100, hardness: 100, preset: 0, pressureSize: false, pressureOpacity: false, stabilization: 0 },
        };
    },

    // Save current settings for the given tool
    saveToolSettings(tool) {
        if (!['brush', 'pencil', 'eraser'].includes(tool)) return;
        this._toolSettings[tool] = {
            size: this.size,
            opacity: this.opacity,
            hardness: this.hardness,
            preset: this.currentPreset,
            pressureSize: this.pressureSize,
            pressureOpacity: this.pressureOpacity,
            stabilization: this.stabilization
        };
    },

    // Load saved settings for the given tool, update sliders
    loadToolSettings(tool) {
        if (!['brush', 'pencil', 'eraser'].includes(tool)) return;
        const s = this._toolSettings[tool];
        if (!s) return;
        this.size = s.size;
        this.opacity = s.opacity;
        this.hardness = s.hardness;
        this.stabilization = s.stabilization;
        this.pressureSize = s.pressureSize;
        this.pressureOpacity = s.pressureOpacity;
        if (s.preset !== this.currentPreset) {
            this.currentPreset = s.preset;
            const preset = this.presets[this.currentPreset];
            if (preset) {
                this.spacing = preset.spacing;
            }
            this.renderPresets();
        }
        this._syncUI();
    },

    _syncUI() {
        const sizeSlider = document.getElementById('brush-size');
        const sizeVal = document.getElementById('brush-size-val');
        if (sizeSlider) { sizeSlider.value = this.size; }
        if (sizeVal) { sizeVal.textContent = this.size; }

        const opSlider = document.getElementById('brush-opacity');
        const opVal = document.getElementById('brush-opacity-val');
        if (opSlider) { opSlider.value = this.opacity; }
        if (opVal) { opVal.textContent = this.opacity + '%'; }

        const hardSlider = document.getElementById('brush-hardness');
        const hardVal = document.getElementById('brush-hardness-val');
        if (hardSlider) { hardSlider.value = this.hardness; }
        if (hardVal) { hardVal.textContent = this.hardness + '%'; }

        const stabSlider = document.getElementById('brush-stabilize');
        const stabVal = document.getElementById('brush-stabilize-val');
        if (stabSlider) { stabSlider.value = this.stabilization; }
        if (stabVal) { stabVal.textContent = this.stabilization; }

        const pSize = document.getElementById('pressure-size');
        const pOp = document.getElementById('pressure-opacity');
        if (pSize) { pSize.checked = this.pressureSize; }
        if (pOp) { pOp.checked = this.pressureOpacity; }
    },

    setSize(newSize) {
        this.size = Math.max(1, Math.min(500, newSize));
        const slider = document.getElementById('brush-size');
        const val = document.getElementById('brush-size-val');
        if (slider) slider.value = this.size;
        if (val) val.textContent = this.size;
    },

    createPresets() {
        this.presets = [
            { name: 'Hard Round', type: 'round', hardness: 100, spacing: 0.1, sizeRange: [1, 500] },
            { name: 'Soft Round', type: 'round', hardness: 0, spacing: 0.1, sizeRange: [1, 500] },
            { name: 'Airbrush', type: 'airbrush', hardness: 0, spacing: 0.05, sizeRange: [5, 300], flow: 10 },
        ];
    },

    selectPreset(index) {
        this.currentPreset = index;
        const preset = this.presets[index];
        this.hardness = preset.hardness;
        this.spacing = preset.spacing;
        document.getElementById('brush-hardness').value = preset.hardness;
        document.getElementById('brush-hardness-val').textContent = preset.hardness + '%';
        this.renderPresets();
    },

    renderPresets() {
        const list = document.getElementById('brush-preset-list');
        list.innerHTML = '';
        this.presets.forEach((preset, i) => {
            const el = document.createElement('div');
            el.className = 'brush-preset' + (i === this.currentPreset ? ' active' : '');
            el.textContent = preset.name;
            el.addEventListener('click', () => this.selectPreset(i));
            list.appendChild(el);
        });
    },

    bindOptions() {
        const sizeSlider = document.getElementById('brush-size');
        const sizeVal = document.getElementById('brush-size-val');
        sizeSlider.addEventListener('input', () => {
            this.size = parseInt(sizeSlider.value);
            sizeVal.textContent = this.size;
        });

        const opacitySlider = document.getElementById('brush-opacity');
        const opacityVal = document.getElementById('brush-opacity-val');
        opacitySlider.addEventListener('input', () => {
            this.opacity = parseInt(opacitySlider.value);
            opacityVal.textContent = this.opacity + '%';
        });

        const hardnessSlider = document.getElementById('brush-hardness');
        const hardnessVal = document.getElementById('brush-hardness-val');
        hardnessSlider.addEventListener('input', () => {
            this.hardness = parseInt(hardnessSlider.value);
            hardnessVal.textContent = this.hardness + '%';
        });

        const stabSlider = document.getElementById('brush-stabilize');
        const stabVal = document.getElementById('brush-stabilize-val');
        stabSlider.addEventListener('input', () => {
            this.stabilization = parseInt(stabSlider.value);
            stabVal.textContent = this.stabilization;
        });

        document.getElementById('pressure-size').addEventListener('change', (e) => {
            this.pressureSize = e.target.checked;
        });
        document.getElementById('pressure-opacity').addEventListener('change', (e) => {
            this.pressureOpacity = e.target.checked;
        });
    },

    // ---- Stroke canvas management ----
    // Begin a new stroke: create a temporary canvas to accumulate stamps at full opacity,
    // then composite the whole stroke onto the layer at the brush opacity.
    // This prevents overlapping stamps from building up opacity.
    beginStroke(width, height) {
        this._strokeCanvas = Utils.createCanvas(width, height);
        this._strokeCtx = this._strokeCanvas.getContext('2d');
    },

    // End stroke: composite the stroke canvas onto the target at brush opacity
    endStroke(targetCtx) {
        if (!this._strokeCanvas) return;
        targetCtx.save();
        targetCtx.globalAlpha = this.opacity / 100;
        targetCtx.drawImage(this._strokeCanvas, 0, 0);
        targetCtx.restore();
        this._strokeCanvas = null;
        this._strokeCtx = null;
    },

    // End erase stroke: composite the erase stroke canvas
    endEraseStroke(targetCtx) {
        if (!this._strokeCanvas) return;
        targetCtx.save();
        targetCtx.globalCompositeOperation = 'destination-out';
        targetCtx.globalAlpha = this.opacity / 100;
        targetCtx.drawImage(this._strokeCanvas, 0, 0);
        targetCtx.restore();
        this._strokeCanvas = null;
        this._strokeCtx = null;
    },

    // Get effective size/opacity based on pressure
    getEffectiveSize(pressure) {
        if (this.pressureSize && pressure !== undefined) {
            return Math.max(1, this.size * pressure);
        }
        return this.size;
    },

    getEffectiveOpacity(pressure) {
        // When using stroke canvas, stamps go at full opacity on the temp canvas
        // and the whole stroke is composited at brush opacity at the end.
        // Pressure can still modulate per-stamp opacity for pressure-opacity.
        if (this.pressureOpacity && pressure !== undefined) {
            return pressure;
        }
        return 1.0;
    },

    // Draw a single brush stamp at position
    stamp(ctx, x, y, pressure) {
        // Use stroke canvas if available, otherwise direct
        const target = this._strokeCtx || ctx;
        const preset = this.presets[this.currentPreset];
        const size = this.getEffectiveSize(pressure);
        const opacity = this.getEffectiveOpacity(pressure);
        const radius = size / 2;

        target.save();

        switch (preset.type) {
            case 'pixel':
                target.globalAlpha = opacity;
                target.fillStyle = ColorSystem.getPrimaryCSS();
                const pixelSize = Math.max(1, Math.round(size));
                target.fillRect(Math.round(x - pixelSize/2), Math.round(y - pixelSize/2), pixelSize, pixelSize);
                break;

            case 'spray':
                target.fillStyle = ColorSystem.getPrimaryCSS();
                const sprayDensity = Math.floor(size * 2);
                for (let i = 0; i < sprayDensity; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * radius;
                    const sx = x + Math.cos(angle) * dist;
                    const sy = y + Math.sin(angle) * dist;
                    target.globalAlpha = opacity * (0.3 + Math.random() * 0.7);
                    target.fillRect(sx, sy, 1, 1);
                }
                break;

            case 'charcoal':
            case 'pencil':
                target.globalAlpha = opacity * (0.5 + Math.random() * 0.5);
                const gradient3 = target.createRadialGradient(x, y, 0, x, y, radius);
                gradient3.addColorStop(0, ColorSystem.getPrimaryCSS());
                gradient3.addColorStop(0.5, ColorSystem.getPrimaryCSS());
                gradient3.addColorStop(1, 'rgba(0,0,0,0)');
                target.fillStyle = gradient3;
                target.beginPath();
                target.arc(x, y, radius, 0, Math.PI * 2);
                target.fill();
                break;

            case 'airbrush': {
                // Soft spray effect — many tiny dots with low alpha radiating outward
                const flow = (preset.flow || 10) / 100;
                const dotCount = Math.floor(size * 1.5);
                target.fillStyle = ColorSystem.getPrimaryCSS();
                for (let i = 0; i < dotCount; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * radius;
                    const ax = x + Math.cos(angle) * dist;
                    const ay = y + Math.sin(angle) * dist;
                    // Opacity falls off from center
                    const falloff = 1 - (dist / radius);
                    target.globalAlpha = opacity * flow * falloff * (0.3 + Math.random() * 0.7);
                    target.fillRect(ax - 0.5, ay - 0.5, 1, 1);
                }
                break;
            }

            default: // round, soft
                target.globalAlpha = opacity;
                if (this.hardness >= 95) {
                    // Hard brush - solid circle
                    target.fillStyle = ColorSystem.getPrimaryCSS();
                    target.beginPath();
                    target.arc(x, y, radius, 0, Math.PI * 2);
                    target.fill();
                } else {
                    // Soft brush with gradient
                    const innerRadius = radius * (this.hardness / 100);
                    const gradient = target.createRadialGradient(x, y, innerRadius, x, y, radius);
                    gradient.addColorStop(0, ColorSystem.getPrimaryCSS());
                    gradient.addColorStop(1, `rgba(${ColorSystem.primary.r},${ColorSystem.primary.g},${ColorSystem.primary.b},0)`);
                    target.fillStyle = gradient;
                    target.beginPath();
                    target.arc(x, y, radius, 0, Math.PI * 2);
                    target.fill();
                }
                break;
        }

        target.restore();
    },

    // Draw a stroke between two points with interpolation
    strokeBetween(ctx, x1, y1, x2, y2, pressure1, pressure2) {
        const dist = Utils.dist(x1, y1, x2, y2);
        if (dist < 0.5) return; // Skip near-zero movement to prevent double-stamping artifacts
        const size = this.getEffectiveSize(pressure1);
        // Reduce spacing to eliminate gaps: use smaller spacing multiplier
        const step = Math.max(0.5, size * Math.min(this.spacing, 0.25));
        const steps = Math.max(1, Math.ceil(dist / step));

        // Start from i=1 to skip the first point (x1), which was already drawn
        // by the previous segment or onPointerDown. This prevents double-stamping/blobs.
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = Utils.lerp(x1, x2, t);
            const y = Utils.lerp(y1, y2, t);
            const p = Utils.lerp(pressure1 || 1, pressure2 || 1, t);
            this.stamp(ctx, x, y, p);
        }
    },

    // Eraser stamp
    eraseStamp(ctx, x, y, pressure) {
        const target = this._strokeCtx || ctx;
        const size = this.getEffectiveSize(pressure);
        const radius = size / 2;
        const opacity = this.getEffectiveOpacity(pressure);

        target.save();
        if (this._strokeCtx) {
            // Drawing onto stroke canvas in normal mode (will be composited as destination-out later)
            target.globalAlpha = opacity;
        } else {
            target.globalCompositeOperation = 'destination-out';
            target.globalAlpha = opacity;
        }

        if (this.hardness >= 95) {
            target.fillStyle = '#000';
            target.beginPath();
            target.arc(x, y, radius, 0, Math.PI * 2);
            target.fill();
        } else {
            const innerR = radius * (this.hardness / 100);
            const grad = target.createRadialGradient(x, y, innerR, x, y, radius);
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            target.fillStyle = grad;
            target.beginPath();
            target.arc(x, y, radius, 0, Math.PI * 2);
            target.fill();
        }
        target.restore();
    },

    eraseStrokeBetween(ctx, x1, y1, x2, y2, pressure1, pressure2) {
        const dist = Utils.dist(x1, y1, x2, y2);
        if (dist < 0.5) return; // Skip near-zero movement to prevent double-stamping artifacts
        const size = this.getEffectiveSize(pressure1);
        const step = Math.max(0.5, size * Math.min(this.spacing, 0.25));
        const steps = Math.max(1, Math.ceil(dist / step));

        // Start from i=1 to skip the first point (x1), which was already drawn
        // by the previous segment or onPointerDown. This prevents double-stamping/blobs.
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = Utils.lerp(x1, x2, t);
            const y = Utils.lerp(y1, y2, t);
            const p = Utils.lerp(pressure1 || 1, pressure2 || 1, t);
            this.eraseStamp(ctx, x, y, p);
        }
    },

    // Stabilizer: smooth input points
    stabilize(x, y) {
        if (this.stabilization === 0) return { x, y };

        this.stabilizerPoints.push({ x, y });
        const n = Math.min(this.stabilizerPoints.length, this.stabilization + 1);

        let sx = 0, sy = 0;
        for (let i = this.stabilizerPoints.length - n; i < this.stabilizerPoints.length; i++) {
            sx += this.stabilizerPoints[i].x;
            sy += this.stabilizerPoints[i].y;
        }
        return { x: sx / n, y: sy / n };
    },

    resetStabilizer() {
        this.stabilizerPoints = [];
    }
};
