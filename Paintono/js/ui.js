// ========================================
// PAINTONO - UI Manager
// ========================================

const UI = {
    init() {
        this.bindMenuBar();
        this.bindPanels();
        this.bindLayerControls();
        this.bindToolbar();
        this.bindSelectionButtons();
        this.bindTransformButtons();
        this.bindTextButtons();
        this.bindMenuActions();
    },

    // ---- Menu Bar ----
    bindMenuBar() {
        let openMenu = null;

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuName = item.dataset.menu;

                if (openMenu === menuName) {
                    this.closeMenus();
                    return;
                }

                this.closeMenus();
                openMenu = menuName;
                item.classList.add('open');

                const dropdown = document.querySelector(`.dropdown[data-menu="${menuName}"]`);
                if (dropdown) {
                    dropdown.classList.add('visible');
                    // Position dropdown under menu item
                    const rect = item.getBoundingClientRect();
                    dropdown.style.left = rect.left + 'px';
                }
            });

            item.addEventListener('mouseenter', () => {
                if (openMenu) {
                    const menuName = item.dataset.menu;
                    this.closeMenus();
                    openMenu = menuName;
                    item.classList.add('open');

                    const dropdown = document.querySelector(`.dropdown[data-menu="${menuName}"]`);
                    if (dropdown) {
                        dropdown.classList.add('visible');
                        const rect = item.getBoundingClientRect();
                        dropdown.style.left = rect.left + 'px';
                    }
                }
            });
        });

        document.addEventListener('click', () => {
            this.closeMenus();
            openMenu = null;
        });
    },

    closeMenus() {
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('open'));
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('visible'));
    },

    // ---- Menu Actions ----
    bindMenuActions() {
        document.querySelectorAll('.menu-action').forEach(action => {
            action.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeMenus();
                this.handleAction(action.dataset.action);
            });
        });
    },

    handleAction(action) {
        switch (action) {
            // File
            case 'new':
                this.showDialog('new-canvas-dialog');
                break;
            case 'open':
                this.openFile();
                break;
            case 'save':
                App.saveProject();
                break;
            case 'export-png':
                App.exportImage('png');
                break;
            case 'export-jpg':
                App.exportImage('jpg');
                break;
            case 'export-bmp':
                App.exportImage('bmp');
                break;

            // Edit
            case 'undo':
                History.undo();
                break;
            case 'redo':
                History.redo();
                break;
            case 'cut':
                this.cutSelection();
                break;
            case 'copy':
                this.copySelection();
                break;
            case 'paste':
                this.pasteClipboard();
                break;
            case 'select-all':
                Selection.selectAll();
                break;
            case 'deselect':
                Selection.clear();
                break;
            case 'invert-selection':
                Selection.invert();
                break;

            // Image
            case 'flip-h':
                Tools.applyFlipH();
                break;
            case 'flip-v':
                Tools.applyFlipV();
                break;
            case 'rotate-cw':
                Tools.applyRotate(90);
                break;
            case 'rotate-ccw':
                Tools.applyRotate(-90);
                break;

            // Layer
            case 'new-layer':
                Layers.addLayer();
                History.push('New Layer');
                break;
            case 'duplicate-layer':
                Layers.duplicateLayer();
                History.push('Duplicate Layer');
                break;
            case 'delete-layer':
                Layers.removeLayer();
                History.push('Delete Layer');
                break;
            case 'merge-down':
                Layers.mergeDown();
                History.push('Merge Down');
                break;
            case 'flatten':
                Layers.flatten();
                History.push('Flatten');
                break;

            // Filters
            case 'blur-gaussian':
                Filters.showFilterDialog('Gaussian Blur', [
                    { key: 'radius', label: 'Radius', min: 1, max: 50, default: 5 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.gaussianBlur(imgData, w, h, Math.round(vals.radius)));
                });
                break;
            case 'blur-box':
                Filters.showFilterDialog('Box Blur', [
                    { key: 'radius', label: 'Radius', min: 1, max: 30, default: 3 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.boxBlur(imgData, w, h, Math.round(vals.radius)));
                });
                break;
            case 'sharpen':
                Filters.showFilterDialog('Sharpen', [
                    { key: 'amount', label: 'Amount', min: 0.1, max: 5, default: 1, step: 0.1 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.sharpen(imgData, w, h, vals.amount));
                });
                break;
            case 'noise-add':
                Filters.showFilterDialog('Add Noise', [
                    { key: 'amount', label: 'Amount', min: 1, max: 100, default: 20 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.addNoise(imgData, w, h, vals.amount));
                });
                break;
            case 'invert-colors':
                Filters.applyToActive((imgData, w, h) => Filters.invertColors(imgData, w, h));
                History.push('Invert Colors');
                break;
            case 'grayscale':
                Filters.applyToActive((imgData, w, h) => Filters.grayscale(imgData, w, h));
                History.push('Grayscale');
                break;
            case 'sepia':
                Filters.applyToActive((imgData, w, h) => Filters.sepia(imgData, w, h));
                History.push('Sepia');
                break;
            case 'brightness-contrast':
                Filters.showFilterDialog('Brightness/Contrast', [
                    { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
                    { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.brightnessContrast(imgData, w, h, vals.brightness, vals.contrast));
                });
                break;
            case 'hue-saturation':
                Filters.showFilterDialog('Hue/Saturation', [
                    { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0 },
                    { key: 'saturation', label: 'Saturation', min: 0, max: 200, default: 100 },
                    { key: 'lightness', label: 'Lightness', min: -100, max: 100, default: 0 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.hueSaturation(imgData, w, h, vals.hue, vals.saturation, vals.lightness));
                });
                break;
            case 'color-balance':
                Filters.showFilterDialog('Color Balance', [
                    { key: 'red', label: 'Red', min: -100, max: 100, default: 0 },
                    { key: 'green', label: 'Green', min: -100, max: 100, default: 0 },
                    { key: 'blue', label: 'Blue', min: -100, max: 100, default: 0 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.colorBalance(imgData, w, h, vals.red, vals.green, vals.blue));
                });
                break;
            case 'levels':
                Filters.showFilterDialog('Levels', [
                    { key: 'inputMin', label: 'Input Min', min: 0, max: 255, default: 0 },
                    { key: 'inputMax', label: 'Input Max', min: 0, max: 255, default: 255 },
                    { key: 'outputMin', label: 'Output Min', min: 0, max: 255, default: 0 },
                    { key: 'outputMax', label: 'Output Max', min: 0, max: 255, default: 255 }
                ], (vals) => {
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.levels(imgData, w, h, vals.inputMin, vals.inputMax, vals.outputMin, vals.outputMax));
                });
                break;
            case 'curves':
                // Simplified curves - using brightness as proxy
                Filters.showFilterDialog('Curves (Simplified)', [
                    { key: 'shadows', label: 'Shadows', min: -50, max: 50, default: 0 },
                    { key: 'midtones', label: 'Midtones', min: -50, max: 50, default: 0 },
                    { key: 'highlights', label: 'Highlights', min: -50, max: 50, default: 0 }
                ], (vals) => {
                    const points = [
                        { x: 0, y: Utils.clamp(vals.shadows / 100, -0.5, 0.5) },
                        { x: 0.5, y: 0.5 + vals.midtones / 100 },
                        { x: 1, y: Utils.clamp(1 + vals.highlights / 100, 0.5, 1.5) }
                    ];
                    Filters.applyToActive((imgData, w, h) =>
                        Filters.curves(imgData, w, h, points));
                });
                break;

            // View
            case 'zoom-in':
                App.setZoom(App.zoom * 1.25);
                break;
            case 'zoom-out':
                App.setZoom(App.zoom / 1.25);
                break;
            case 'zoom-fit':
                App.zoomToFit();
                break;
            case 'zoom-100':
                App.setZoom(1);
                break;
            case 'toggle-grid':
                App.toggleGrid();
                break;
            case 'flip-view':
                App.flipView();
                break;
            case 'toggle-theme':
                document.body.classList.toggle('light-theme');
                break;

            // Help
            case 'shortcuts':
                this.showDialog('shortcuts-dialog');
                break;
            case 'about':
                this.showDialog('about-dialog');
                break;
        }
    },

    // ---- Panels ----
    bindPanels() {
        document.querySelectorAll('.panel-header').forEach(header => {
            header.addEventListener('click', () => {
                const panel = header.parentElement;
                panel.classList.toggle('collapsed');
                header.querySelector('.panel-toggle').textContent =
                    panel.classList.contains('collapsed') ? '+' : '−';
            });
        });
    },

    // ---- Layer Controls ----
    bindLayerControls() {
        document.getElementById('btn-add-layer').addEventListener('click', () => {
            Layers.addLayer();
            History.push('New Layer');
        });
        document.getElementById('btn-delete-layer').addEventListener('click', () => {
            Layers.removeLayer();
            History.push('Delete Layer');
        });
        document.getElementById('btn-merge-layer').addEventListener('click', () => {
            Layers.mergeDown();
            History.push('Merge Down');
        });
        document.getElementById('btn-duplicate-layer').addEventListener('click', () => {
            Layers.duplicateLayer();
            History.push('Duplicate Layer');
        });
        document.getElementById('btn-layer-up').addEventListener('click', () => {
            if (Layers.activeIndex < Layers.layers.length - 1) {
                Layers.moveLayer(Layers.activeIndex, Layers.activeIndex + 1);
            }
        });
        document.getElementById('btn-layer-down').addEventListener('click', () => {
            if (Layers.activeIndex > 0) {
                Layers.moveLayer(Layers.activeIndex, Layers.activeIndex - 1);
            }
        });

        document.getElementById('layer-blend-mode').addEventListener('change', (e) => {
            const layer = Layers.getActive();
            layer.blendMode = e.target.value;
            Layers.render();
        });

        document.getElementById('layer-opacity').addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('layer-opacity-val').textContent = val + '%';
            const layer = Layers.getActive();
            layer.opacity = val / 100;
            Layers.render();
        });
    },

    // ---- Toolbar ----
    bindToolbar() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            if (btn.dataset.tool) {
                btn.addEventListener('click', () => {
                    Tools.setTool(btn.dataset.tool);
                });
            }
        });
    },

    // ---- Selection Buttons ----
    bindSelectionButtons() {
        document.getElementById('btn-deselect')?.addEventListener('click', () => Selection.clear());
        document.getElementById('btn-invert-sel')?.addEventListener('click', () => Selection.invert());
        document.getElementById('btn-delete-sel')?.addEventListener('click', () => {
            Selection.deleteSelected();
            History.push('Delete Selection');
        });
        document.getElementById('btn-wand-deselect')?.addEventListener('click', () => Selection.clear());
    },

    // ---- Transform Buttons ----
    bindTransformButtons() {
        document.getElementById('btn-flip-h')?.addEventListener('click', () => Tools.applyFlipH());
        document.getElementById('btn-flip-v')?.addEventListener('click', () => Tools.applyFlipV());
        document.getElementById('btn-rotate-cw')?.addEventListener('click', () => Tools.applyRotate(90));
        document.getElementById('btn-rotate-ccw')?.addEventListener('click', () => Tools.applyRotate(-90));
    },

    // ---- Text Buttons ----
    bindTextButtons() {
        document.getElementById('text-bold')?.addEventListener('click', (e) => {
            e.target.closest('.opt-btn').classList.toggle('active');
        });
        document.getElementById('text-italic')?.addEventListener('click', (e) => {
            e.target.closest('.opt-btn').classList.toggle('active');
        });
    },

    // ---- Dialogs ----
    showDialog(id) {
        document.getElementById('dialog-overlay').classList.remove('hidden');
        document.getElementById(id).classList.remove('hidden');
    },

    closeDialogs() {
        document.getElementById('dialog-overlay').classList.add('hidden');
        document.querySelectorAll('.dialog').forEach(d => d.classList.add('hidden'));
    },

    // ---- File Operations ----
    openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.paintono';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.name.endsWith('.paintono')) {
                // Load project
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        App.loadProject(JSON.parse(reader.result));
                    } catch (err) {
                        console.error('Failed to load project:', err);
                    }
                };
                reader.readAsText(file);
            } else {
                // Load as image — use App.createCanvas to properly reset everything
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        App.createCanvas(img.width, img.height, 'white');
                        Layers.getActiveCtx().drawImage(img, 0, 0);
                        Layers.render();
                        Layers.updateUI();
                        History.init();
                        History.push('Open Image');
                        App.zoomToFit();
                    };
                    img.src = reader.result;
                };
                reader.readAsDataURL(file);
            }
        });
        input.click();
    },

    // Cut/Copy/Paste
    clipboardCanvas: null,

    cutSelection() {
        this.copySelection();
        Selection.deleteSelected();
        History.push('Cut');
    },

    copySelection() {
        const layer = Layers.getActive();
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.clipboardCanvas = Utils.createCanvas(cw, ch);
        const ctx = this.clipboardCanvas.getContext('2d');
        ctx.drawImage(layer.canvas, 0, 0);

        if (Selection.active && Selection.mask) {
            const imgData = ctx.getImageData(0, 0, cw, ch);
            for (let i = 0; i < Selection.mask.length; i++) {
                if (Selection.mask[i] === 0) {
                    const pi = i * 4;
                    imgData.data[pi + 3] = 0;
                }
            }
            ctx.putImageData(imgData, 0, 0);
        }
    },

    pasteClipboard() {
        if (!this.clipboardCanvas) return;
        const layer = Layers.addLayer('Pasted');
        layer.ctx.drawImage(this.clipboardCanvas, 0, 0);
        Layers.render();
        History.push('Paste');
    }
};
