// ========================================
// PAINTONO - Color System
// ========================================

const ColorSystem = {
    // Current colors
    primary: { r: 0, g: 0, b: 0, a: 255 },
    secondary: { r: 255, g: 255, b: 255, a: 255 },
    recentColors: [],
    swatches: [],
    wheelCtx: null,
    squareCtx: null,
    hue: 0,
    sat: 0,
    val: 0,

    init() {
        this.wheelCtx = document.getElementById('color-wheel').getContext('2d');
        this.squareCtx = document.getElementById('color-square').getContext('2d');
        this.drawWheel();
        this.drawSquare();
        this.initSwatches();
        this.bindEvents();
        this.updateUI();
    },

    // HSV <-> RGB conversions
    hsvToRgb(h, s, v) {
        h = h / 360;
        s = s / 100;
        v = v / 100;
        let r, g, b;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    },

    rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h, s = max === 0 ? 0 : d / max, v = max;
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
    },

    rgbToHex(r, g, b) {
        return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        const num = parseInt(hex, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    },

    // Set the primary color
    setPrimary(r, g, b, a) {
        this.primary = { r, g, b, a: a !== undefined ? a : 255 };
        const hsv = this.rgbToHsv(r, g, b);
        this.hue = hsv.h;
        this.sat = hsv.s;
        this.val = hsv.v;
        this.updateUI();
        this.drawSquare();
    },

    setSecondary(r, g, b, a) {
        this.secondary = { r, g, b, a: a !== undefined ? a : 255 };
        this.updateUI();
    },

    swap() {
        const temp = { ...this.primary };
        this.primary = { ...this.secondary };
        this.secondary = temp;
        const hsv = this.rgbToHsv(this.primary.r, this.primary.g, this.primary.b);
        this.hue = hsv.h;
        this.sat = hsv.s;
        this.val = hsv.v;
        this.updateUI();
        this.drawSquare();
    },

    getPrimaryCSS() {
        return `rgba(${this.primary.r},${this.primary.g},${this.primary.b},${this.primary.a / 255})`;
    },

    getSecondaryCSS() {
        return `rgba(${this.secondary.r},${this.secondary.g},${this.secondary.b},${this.secondary.a / 255})`;
    },

    // Draw color wheel
    drawWheel() {
        const canvas = this.wheelCtx.canvas;
        const ctx = this.wheelCtx;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const outerR = cx - 2;
        const innerR = outerR - 22;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw hue ring
        for (let angle = 0; angle < 360; angle += 1) {
            const startAngle = (angle - 1) * Math.PI / 180;
            const endAngle = (angle + 1) * Math.PI / 180;
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, endAngle);
            ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
            ctx.closePath();
            // Fix: Shift hue by 90 degrees so Red (0) is at North (270/-90) to match interaction logic
            ctx.fillStyle = `hsl(${angle + 90}, 100%, 50%)`;
            ctx.fill();
        }

        // Draw hue indicator
        const hueAngle = (this.hue - 90) * Math.PI / 180;
        const indicatorR = (outerR + innerR) / 2;
        const ix = cx + Math.cos(hueAngle) * indicatorR;
        const iy = cy + Math.sin(hueAngle) * indicatorR;
        ctx.beginPath();
        ctx.arc(ix, iy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ix, iy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    // Draw SV square
    drawSquare() {
        const canvas = this.squareCtx.canvas;
        const ctx = this.squareCtx;
        const w = canvas.width;
        const h = canvas.height;

        // Fill with hue
        ctx.fillStyle = `hsl(${this.hue}, 100%, 50%)`;
        ctx.fillRect(0, 0, w, h);

        // White gradient (saturation)
        const white = ctx.createLinearGradient(0, 0, w, 0);
        white.addColorStop(0, 'rgba(255,255,255,1)');
        white.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = white;
        ctx.fillRect(0, 0, w, h);

        // Black gradient (value)
        const black = ctx.createLinearGradient(0, 0, 0, h);
        black.addColorStop(0, 'rgba(0,0,0,0)');
        black.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = black;
        ctx.fillRect(0, 0, w, h);

        // Indicator
        const sx = (this.sat / 100) * w;
        const sy = (1 - this.val / 100) * h;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    // Update all UI elements
    updateUI() {
        const { r, g, b } = this.primary;
        const hex = this.rgbToHex(r, g, b);

        document.getElementById('color-primary').style.background = this.getPrimaryCSS();
        document.getElementById('color-secondary').style.background = this.getSecondaryCSS();
        document.getElementById('color-preview-primary').style.background = this.getPrimaryCSS();
        document.getElementById('color-preview-secondary').style.background = this.getSecondaryCSS();

        // HSV sliders
        document.getElementById('slider-h').value = this.hue;
        document.getElementById('input-h').value = this.hue;
        document.getElementById('slider-s').value = this.sat;
        document.getElementById('input-s').value = this.sat;
        document.getElementById('slider-v').value = this.val;
        document.getElementById('input-v').value = this.val;

        // RGB sliders
        document.getElementById('slider-r').value = r;
        document.getElementById('input-r').value = r;
        document.getElementById('slider-g').value = g;
        document.getElementById('input-g').value = g;
        document.getElementById('slider-b').value = b;
        document.getElementById('input-b').value = b;

        // Hex
        document.getElementById('input-hex').value = hex;
    },

    bindEvents() {
        const wheelCanvas = this.wheelCtx.canvas;
        const squareCanvas = this.squareCtx.canvas;
        let draggingWheel = false;
        let draggingSquare = false;

        // Wheel interaction
        const handleWheel = (e) => {
            const rect = wheelCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const cx = wheelCanvas.width / 2;
            const cy = wheelCanvas.height / 2;
            const angle = Math.atan2(y - cy, x - cx);
            this.hue = ((angle * 180 / Math.PI) + 90 + 360) % 360;
            this.drawWheel();
            this.drawSquare();
            const rgb = this.hsvToRgb(this.hue, this.sat, this.val);
            this.primary = { ...rgb, a: this.primary.a };
            this.updateUI();
        };

        wheelCanvas.addEventListener('mousedown', (e) => {
            const rect = wheelCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const cx = wheelCanvas.width / 2;
            const cy = wheelCanvas.height / 2;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const outerR = cx - 2;
            const innerR = outerR - 22;
            if (dist >= innerR && dist <= outerR) {
                draggingWheel = true;
                handleWheel(e);
            }
        });

        // Square interaction
        const handleSquare = (e) => {
            const rect = squareCanvas.getBoundingClientRect();
            const x = Utils.clamp(e.clientX - rect.left, 0, squareCanvas.width);
            const y = Utils.clamp(e.clientY - rect.top, 0, squareCanvas.height);
            this.sat = Math.round((x / squareCanvas.width) * 100);
            this.val = Math.round((1 - y / squareCanvas.height) * 100);
            const rgb = this.hsvToRgb(this.hue, this.sat, this.val);
            this.primary = { ...rgb, a: this.primary.a };
            this.drawSquare();
            this.updateUI();
        };

        squareCanvas.addEventListener('mousedown', (e) => {
            draggingSquare = true;
            handleSquare(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (draggingWheel) handleWheel(e);
            if (draggingSquare) handleSquare(e);
        });

        document.addEventListener('mouseup', () => {
            draggingWheel = false;
            draggingSquare = false;
        });

        // Swap colors
        document.getElementById('color-swap').addEventListener('click', () => this.swap());

        // HSV sliders
        ['h', 's', 'v'].forEach(ch => {
            const slider = document.getElementById(`slider-${ch}`);
            const input = document.getElementById(`input-${ch}`);
            const update = () => {
                this.hue = parseInt(document.getElementById('slider-h').value);
                this.sat = parseInt(document.getElementById('slider-s').value);
                this.val = parseInt(document.getElementById('slider-v').value);
                const rgb = this.hsvToRgb(this.hue, this.sat, this.val);
                this.primary = { ...rgb, a: this.primary.a };
                this.drawWheel();
                this.drawSquare();
                this.updateUI();
            };
            slider.addEventListener('input', () => { input.value = slider.value; update(); });
            input.addEventListener('change', () => { slider.value = input.value; update(); });
        });

        // RGB sliders
        ['r', 'g', 'b'].forEach(ch => {
            const slider = document.getElementById(`slider-${ch}`);
            const input = document.getElementById(`input-${ch}`);
            const update = () => {
                const r = parseInt(document.getElementById('slider-r').value);
                const g = parseInt(document.getElementById('slider-g').value);
                const b = parseInt(document.getElementById('slider-b').value);
                this.setPrimary(r, g, b, this.primary.a);
            };
            slider.addEventListener('input', () => { input.value = slider.value; update(); });
            input.addEventListener('change', () => { slider.value = input.value; update(); });
        });

        // Hex input
        document.getElementById('input-hex').addEventListener('change', (e) => {
            const rgb = this.hexToRgb(e.target.value);
            if (rgb) this.setPrimary(rgb.r, rgb.g, rgb.b, this.primary.a);
        });

        // Swatch add
        document.getElementById('add-swatch').addEventListener('click', () => {
            this.addSwatch(this.primary.r, this.primary.g, this.primary.b);
        });
    },

    // Swatches
    initSwatches() {
        const defaultColors = [
            '#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00',
            '#ff00ff','#00ffff','#ff8000','#8000ff','#0080ff','#ff0080',
            '#808080','#c0c0c0','#800000','#008000','#000080','#808000',
            '#800080','#008080','#400000','#004000','#000040','#404040',
            '#ff4444','#44ff44','#4444ff','#ffaa00','#aa00ff','#00aaff'
        ];
        defaultColors.forEach(hex => {
            const { r, g, b } = this.hexToRgb(hex);
            this.swatches.push({ r, g, b });
        });
        this.renderSwatches();
    },

    addSwatch(r, g, b) {
        this.swatches.push({ r, g, b });
        this.renderSwatches();
    },

    renderSwatches() {
        const grid = document.getElementById('swatch-grid');
        grid.innerHTML = '';
        this.swatches.forEach(c => {
            const el = document.createElement('div');
            el.className = 'swatch';
            el.style.background = `rgb(${c.r},${c.g},${c.b})`;
            el.addEventListener('click', () => this.setPrimary(c.r, c.g, c.b));
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.setSecondary(c.r, c.g, c.b);
            });
            grid.appendChild(el);
        });
    },

    // Eyedropper: pick from canvas
    pickFromCanvas(x, y) {
        const composited = Layers.getComposited(true);
        const ctx = composited.getContext('2d');
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        this.setPrimary(pixel[0], pixel[1], pixel[2], pixel[3]);
    }
};
