// ========================================
// PAINTONO - Main App
// ========================================

const App = {
    zoom: 1,
    panX: 0,
    panY: 0,
    canvasWidth: 1280,
    canvasHeight: 720,
    showGrid: false,
    flipped: false,
    rotation: 0,
    isPanning: false,
    isRotating: false,
    spaceDown: false,
    rDown: false,
    lastPanX: 0,
    lastPanY: 0,
    lastRotateX: 0,
    mouseClientX: 0,
    mouseClientY: 0,
    symmetryEnabled: false,
    activePointerId: null,

    init() {
        this.viewport = document.getElementById('canvas-viewport');
        this.canvasStack = document.getElementById('canvas-container');
        this.canvasArea = document.getElementById('canvas-area');
        this.statusZoom = document.getElementById('status-zoom');
        this.statusCoords = document.getElementById('status-pos');
        this.statusSize = document.getElementById('status-canvas-size');
        this.statusTool = document.getElementById('status-tool');
        this.statusPressure = document.getElementById('status-pressure');
        this.canvasOverlay = document.getElementById('canvas-overlay');
        this.canvasCursor = document.getElementById('canvas-cursor');
        this.canvasGrid = document.getElementById('canvas-grid');
        this.canvasSelection = document.getElementById('canvas-selection');
        this.canvasBg = document.getElementById('canvas-bg');

        // Default canvas
        this.createCanvas(this.canvasWidth, this.canvasHeight, 'white');

        // Init sub-systems
        ColorSystem.init();
        Brushes.init();
        Tools.init();
        History.init();
        UI.init();
        Tools.setTool('brush');

        // Bind canvas events
        this.bindCanvasEvents();
        this.bindKeyboard();
        this.bindNewCanvasDialog();
        this.bindZoomControls();
        this.bindDialogClose();
        this.bindSymmetryToggle();
        this.bindViewportResize();
        this.bindContextMenu();

        this.updateCanvasInfo();
        this.zoomToFit();

        console.log('Paintono initialized!');
    },

    createCanvas(w, h, bg) {
        this.canvasWidth = w;
        this.canvasHeight = h;

        // Set overlay canvases
        [this.canvasOverlay, this.canvasCursor, this.canvasGrid, this.canvasSelection, this.canvasBg].forEach(c => {
            c.width = w;
            c.height = h;
        });

        // Draw background (checkerboard for transparent, or solid)
        this.drawBackground(bg);

        // Init layers (clears old content, creates fresh layer)
        Layers.init(w, h, bg);

        // Reset tools temp canvas to new dimensions
        Tools.tempCanvas = Utils.createCanvas(w, h);
        Tools.tempCtx = Tools.tempCanvas.getContext('2d');

        // Reset selection
        Selection.init();
        Selection.clear();

        // Reset rotation
        this.rotation = 0;

        this.updateCanvasTransform();
        this.updateCanvasInfo();
    },

    drawBackground(bg) {
        const ctx = this.canvasBg.getContext('2d');
        const w = this.canvasWidth;
        const h = this.canvasHeight;

        if (bg === 'transparent') {
            // Checkerboard
            const size = 16;
            for (let y = 0; y < h; y += size) {
                for (let x = 0; x < w; x += size) {
                    ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#ccc' : '#fff';
                    ctx.fillRect(x, y, size, size);
                }
            }
        } else {
            ctx.fillStyle = bg || 'white';
            ctx.fillRect(0, 0, w, h);
        }
    },

    // ---- Canvas Events ----
    bindCanvasEvents() {
        // Prevent Windows Ink / touch default behavior
        this.viewport.style.touchAction = 'none';
        this.viewport.style.msTouchAction = 'none';

        this.viewport.addEventListener('pointerdown', (e) => {
            // Ignore if we already have an active pointer (prevents Windows Ink dual-input)
            if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
            this.activePointerId = e.pointerId;

            e.preventDefault();

            // Middle-click or space+click or alt+click or hand tool = pan
            if (e.button === 1 || (e.button === 0 && (e.altKey || this.spaceDown || Tools.current === 'hand'))) {
                this.isPanning = true;
                this.lastPanX = e.clientX;
                this.lastPanY = e.clientY;
                this.viewport.style.cursor = 'grabbing';
                return;
            }

            // R+click = rotate
            if (e.button === 0 && this.rDown) {
                this.isRotating = true;
                this.lastRotateX = e.clientX;
                this.viewport.style.cursor = 'alias';
                return;
            }

            if (e.button === 0) {
                this.viewport.setPointerCapture(e.pointerId);
                Tools.onPointerDown(e);
            }
        });

        this.viewport.addEventListener('pointermove', (e) => {
            // Ignore events from other pointers (Windows Ink fix)
            if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
            e.preventDefault();

            // Track mouse position for zoom-toward-cursor
            this.mouseClientX = e.clientX;
            this.mouseClientY = e.clientY;

            if (this.isPanning) {
                const dx = e.clientX - this.lastPanX;
                const dy = e.clientY - this.lastPanY;
                this.panX += dx;
                this.panY += dy;
                this.lastPanX = e.clientX;
                this.lastPanY = e.clientY;
                this.updateCanvasTransform();
                return;
            }

            if (this.isRotating) {
                const dx = e.clientX - this.lastRotateX;
                this.rotation += dx * 0.5;
                this.lastRotateX = e.clientX;
                this.updateCanvasTransform();
                return;
            }

            Tools.onPointerMove(e);
            this.updateCursorPosition(e);
        });

        this.viewport.addEventListener('pointerup', (e) => {
            if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
            this.activePointerId = null;

            if (this.isPanning) {
                this.isPanning = false;
                this.viewport.style.cursor = this.spaceDown ? 'grab' : '';
                return;
            }

            if (this.isRotating) {
                this.isRotating = false;
                this.viewport.style.cursor = this.rDown ? 'alias' : '';
                return;
            }

            Tools.onPointerUp(e);
        });

        this.viewport.addEventListener('pointercancel', (e) => {
            this.activePointerId = null;
            this.isPanning = false;
            this.isRotating = false;
        });

        this.viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const dir = e.deltaY < 0 ? 1 : -1;
            const factor = 1.1;
            const newZoom = dir > 0 ? this.zoom * factor : this.zoom / factor;

            // Zoom towards cursor
            const rect = this.viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const oldZoom = this.zoom;
            this.zoom = Utils.clamp(newZoom, 0.05, 64);

            // Adjust pan to zoom toward mouse
            const zoomRatio = this.zoom / oldZoom;
            this.panX = mx - (mx - this.panX) * zoomRatio;
            this.panY = my - (my - this.panY) * zoomRatio;

            this.updateCanvasTransform();
            this.updateCanvasInfo();
        }, { passive: false });
    },

    updateCursorPosition(e) {
        const coords = Tools.screenToCanvas(e.clientX, e.clientY);
        if (coords && this.statusCoords) {
            this.statusCoords.textContent = `X: ${Math.floor(coords.x)} Y: ${Math.floor(coords.y)}`;
        }

        // Draw brush cursor
        if (['brush', 'pencil', 'eraser'].includes(Tools.current)) {
            const ctx = this.canvasCursor.getContext('2d');
            ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
            if (coords) {
                const size = Brushes.size;
                ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                ctx.lineWidth = 1 / this.zoom;
                ctx.beginPath();
                ctx.arc(coords.x, coords.y, size / 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(0,0,0,0.7)';
                ctx.setLineDash([3 / this.zoom, 3 / this.zoom]);
                ctx.beginPath();
                ctx.arc(coords.x, coords.y, size / 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    },

    // ---- Canvas Transform ----
    updateCanvasTransform() {
        const scaleX = this.flipped ? -this.zoom : this.zoom;
        // Calculate center of canvas in viewport space for rotation pivot
        const cx = this.panX + (this.canvasWidth * this.zoom) / 2;
        const cy = this.panY + (this.canvasHeight * this.zoom) / 2;

        let transform = '';
        // Move to rotation center, rotate, move back
        if (this.rotation !== 0) {
            transform += `translate(${cx}px, ${cy}px) rotate(${this.rotation}deg) translate(${-cx}px, ${-cy}px) `;
        }
        // Snap to device pixels to avoid sub-pixel rendering artifacts
        const rpx = Math.round(this.panX);
        const rpy = Math.round(this.panY);
        transform += `translate(${rpx}px, ${rpy}px) scale(${scaleX}, ${this.zoom})`;

        this.canvasStack.style.transform = transform;
        this.canvasStack.style.transformOrigin = '0 0';
        this.canvasStack.style.width = this.canvasWidth + 'px';
        this.canvasStack.style.height = this.canvasHeight + 'px';
    },

    // ---- Zoom ----
    setZoom(z, towardCursor) {
        const rect = this.viewport.getBoundingClientRect();
        let pivotX, pivotY;

        if (towardCursor) {
            pivotX = this.mouseClientX - rect.left;
            pivotY = this.mouseClientY - rect.top;
        } else {
            pivotX = rect.width / 2;
            pivotY = rect.height / 2;
        }

        const oldZoom = this.zoom;
        this.zoom = Utils.clamp(z, 0.05, 64);

        const zoomRatio = this.zoom / oldZoom;
        this.panX = pivotX - (pivotX - this.panX) * zoomRatio;
        this.panY = pivotY - (pivotY - this.panY) * zoomRatio;

        this.updateCanvasTransform();
        this.updateCanvasInfo();
    },

    zoomToFit() {
        const rect = this.viewport.getBoundingClientRect();
        const pad = 40;
        const scaleX = (rect.width - pad * 2) / this.canvasWidth;
        const scaleY = (rect.height - pad * 2) / this.canvasHeight;
        this.zoom = Math.min(scaleX, scaleY, 1);
        this.panX = (rect.width - this.canvasWidth * this.zoom) / 2;
        this.panY = (rect.height - this.canvasHeight * this.zoom) / 2;
        this.updateCanvasTransform();
        this.updateCanvasInfo();
    },

    bindZoomControls() {
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoom * 1.25));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoom / 1.25));
        document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.zoomToFit());
    },

    // ---- Grid ----
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.drawGrid();
    },

    drawGrid() {
        const ctx = this.canvasGrid.getContext('2d');
        ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

        if (!this.showGrid) return;

        const spacing = Math.max(1, Math.round(32 / this.zoom));
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
        ctx.lineWidth = 1 / this.zoom;

        for (let x = 0; x <= this.canvasWidth; x += spacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvasHeight);
            ctx.stroke();
        }
        for (let y = 0; y <= this.canvasHeight; y += spacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvasWidth, y);
            ctx.stroke();
        }
    },

    // ---- Flip View ----
    flipView() {
        this.flipped = !this.flipped;
        this.updateCanvasTransform();
    },

    // ---- Info ----
    updateCanvasInfo() {
        if (this.statusZoom) this.statusZoom.textContent = Math.round(this.zoom * 100) + '%';
        if (this.statusSize) this.statusSize.textContent = `${this.canvasWidth} × ${this.canvasHeight}`;
        if (this.statusTool) this.statusTool.textContent = Tools.current || 'Brush';
        // Also update the canvas-info overlay
        const canvasInfo = document.getElementById('canvas-info');
        if (canvasInfo) canvasInfo.textContent = `${this.canvasWidth} × ${this.canvasHeight} px`;
    },

    // ---- Keyboard ----
    bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            const ctrl = e.ctrlKey || e.metaKey;
            const shift = e.shiftKey;
            const key = e.key.toLowerCase();

            // Undo / Redo
            if (ctrl && !shift && key === 'z') { e.preventDefault(); History.undo(); return; }
            if (ctrl && shift && key === 'z') { e.preventDefault(); History.redo(); return; }
            if (ctrl && key === 'y') { e.preventDefault(); History.redo(); return; }

            // File
            if (ctrl && key === 'n') { e.preventDefault(); UI.showDialog('new-canvas-dialog'); return; }
            if (ctrl && key === 's') { e.preventDefault(); this.saveProject(); return; }
            if (ctrl && key === 'o') { e.preventDefault(); UI.openFile(); return; }
            if (ctrl && shift && key === 'e') { e.preventDefault(); this.exportImage('png'); return; }

            // Selection
            if (ctrl && key === 'a') { e.preventDefault(); Selection.selectAll(); return; }
            if (ctrl && key === 'd') { e.preventDefault(); Selection.clear(); return; }
            if (ctrl && shift && key === 'i') { e.preventDefault(); Selection.invert(); return; }

            // Copy/Cut/Paste
            if (ctrl && key === 'c') { e.preventDefault(); UI.copySelection(); return; }
            if (ctrl && key === 'x') { e.preventDefault(); UI.cutSelection(); return; }
            if (ctrl && key === 'v') { e.preventDefault(); UI.pasteClipboard(); return; }

            // Delete
            if (key === 'delete' || key === 'backspace') {
                if (Selection.active) {
                    e.preventDefault();
                    Selection.deleteSelected();
                    History.push('Delete Selection');
                }
                return;
            }

            // Tools (removed l, r, o — will be mapped elsewhere)
            const toolKeys = {
                'b': 'brush',
                'p': 'pencil',
                'e': 'eraser',
                'g': 'fill',
                'i': 'eyedropper',
                'm': 'select-rect',
                'w': 'magic-wand',
                'v': 'move',
                't': 'text',
                'h': 'hand',
                'u': 'gradient'
            };

            if (!ctrl && !shift && toolKeys[key]) {
                Tools.setTool(toolKeys[key]);
                return;
            }

            // Swap colors
            if (key === 'x' && !ctrl) { ColorSystem.swap(); return; }

            // Default colors
            if (key === 'd' && !ctrl) {
                ColorSystem.primary = { h: 0, s: 0, v: 0 };
                ColorSystem.secondary = { h: 0, s: 0, v: 100 };
                ColorSystem.updateUI();
                return;
            }

            // Brush size
            if (key === '[') { Brushes.setSize(Brushes.size - 5); return; }
            if (key === ']') { Brushes.setSize(Brushes.size + 5); return; }

            // Zoom (Ctrl+= / Ctrl+- zoom toward cursor)
            if (ctrl && (key === '+' || key === '=')) { e.preventDefault(); this.setZoom(this.zoom * 1.25, true); return; }
            if (ctrl && key === '-') { e.preventDefault(); this.setZoom(this.zoom / 1.25, true); return; }
            // Plain +/- also zoom (toward center)
            if (!ctrl && (key === '+' || key === '=')) { e.preventDefault(); this.setZoom(this.zoom * 1.25); return; }
            if (!ctrl && key === '-') { e.preventDefault(); this.setZoom(this.zoom / 1.25); return; }
            if (key === '0' && ctrl) { e.preventDefault(); this.zoomToFit(); return; }
            if (key === '1' && ctrl) { e.preventDefault(); this.setZoom(1); return; }

            // Space for panning (hold)
            if (key === ' ' && !this.spaceDown) {
                e.preventDefault();
                this.spaceDown = true;
                if (!this.isPanning) this.viewport.style.cursor = 'grab';
            }

            // R for rotation (hold)
            if (key === 'r' && !ctrl && !shift && !this.rDown) {
                this.rDown = true;
                if (!this.isRotating) this.viewport.style.cursor = 'alias';
            }

            // Reset rotation with Shift+R
            if (key === 'r' && shift && !ctrl) {
                this.rotation = 0;
                this.updateCanvasTransform();
                return;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === ' ') {
                this.spaceDown = false;
                if (!this.isPanning) this.viewport.style.cursor = '';
            }
            if (e.key.toLowerCase() === 'r') {
                this.rDown = false;
                if (!this.isRotating) this.viewport.style.cursor = '';
            }
        });
    },

    // ---- New Canvas Dialog ----
    bindNewCanvasDialog() {
        // Preset sizes
        document.querySelectorAll('.preset-sizes button').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = parseInt(btn.dataset.w);
                const h = parseInt(btn.dataset.h);
                document.getElementById('new-width').value = w;
                document.getElementById('new-height').value = h;
            });
        });

        // Create
        document.getElementById('new-canvas-ok').addEventListener('click', () => {
            const w = parseInt(document.getElementById('new-width').value) || 1280;
            const h = parseInt(document.getElementById('new-height').value) || 720;
            const bg = document.getElementById('new-bg').value;
            this.createCanvas(
                Utils.clamp(w, 1, 8192),
                Utils.clamp(h, 1, 8192),
                bg
            );
            History.init();
            History.push('New Canvas');
            this.zoomToFit();
            UI.closeDialogs();
        });
    },

    // ---- Dialog Close ----
    bindDialogClose() {
        // Close buttons
        document.querySelectorAll('.dialog-close, .btn-cancel, .dialog-cancel').forEach(btn => {
            btn.addEventListener('click', () => UI.closeDialogs());
        });

        // Overlay click
        document.getElementById('dialog-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) UI.closeDialogs();
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') UI.closeDialogs();
        });
    },

    // ---- Symmetry ----
    bindSymmetryToggle() {
        document.getElementById('symmetry-mode')?.addEventListener('change', (e) => {
            Symmetry.setMode(e.target.value);
        });
        document.getElementById('symmetry-segments')?.addEventListener('input', (e) => {
            Symmetry.segments = parseInt(e.target.value) || 6;
        });
    },

    // ---- Save / Export ----
    saveProject() {
        const project = {
            version: 2,
            width: this.canvasWidth,
            height: this.canvasHeight,
            layers: Layers.serializeForFile()
        };
        const json = JSON.stringify(project);
        const blob = new Blob([json], { type: 'application/json' });
        Utils.downloadBlob(blob, 'painting.paintono');
    },

    loadProject(project) {
        const w = project.width;
        const h = project.height;

        this.canvasWidth = w;
        this.canvasHeight = h;

        // Resize all overlay canvases
        [this.canvasOverlay, this.canvasCursor, this.canvasGrid, this.canvasSelection, this.canvasBg].forEach(c => {
            c.width = w;
            c.height = h;
        });

        this.drawBackground('transparent');

        // Reset tools temp canvas to new dimensions
        Tools.tempCanvas = Utils.createCanvas(w, h);
        Tools.tempCtx = Tools.tempCanvas.getContext('2d');

        // Reset selection
        Selection.init();
        Selection.clear();

        // Reset rotation
        this.rotation = 0;

        // Load layers from file (uses deserializeFromFile with data URLs)
        Layers.deserializeFromFile(project.layers, w, h);

        History.init();
        History.push('Load Project');
        this.updateCanvasTransform();
        this.updateCanvasInfo();
        this.zoomToFit();
    },

    exportImage(format) {
        const composited = Layers.getComposited();
        let mimeType = 'image/png';
        let ext = 'png';
        let quality = undefined;

        if (format === 'jpg' || format === 'jpeg') {
            // Need to flatten onto white background for JPG
            const final = Utils.createCanvas(this.canvasWidth, this.canvasHeight);
            const fCtx = final.getContext('2d');
            fCtx.fillStyle = 'white';
            fCtx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
            fCtx.drawImage(composited, 0, 0);

            final.toBlob((blob) => {
                Utils.downloadBlob(blob, `painting.jpg`);
            }, 'image/jpeg', 0.92);
            return;
        }

        if (format === 'bmp') {
            // Export as PNG since BMP not natively supported
            ext = 'png';
        }

        composited.toBlob((blob) => {
            Utils.downloadBlob(blob, `painting.${ext}`);
        }, mimeType, quality);
    },

    // ---- Viewport Resize ----
    bindViewportResize() {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                Layers.updateNavigator();
                if (this.showGrid) this.drawGrid();
            }, 100);
        });
    },

    // ---- Context Menu ----
    bindContextMenu() {
        this.viewport.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
};

// ---- Start ----
window.addEventListener('DOMContentLoaded', () => {
    App.init();
});
