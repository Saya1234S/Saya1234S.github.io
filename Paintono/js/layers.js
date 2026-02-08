// ========================================
// PAINTONO - Layer System
// ========================================

const Layers = {
    layers: [],
    activeIndex: 0,
    canvasWidth: 1200,
    canvasHeight: 800,

    init(width, height, bgColor) {
        this.canvasWidth = width;
        this.canvasHeight = height;

        // Remove old layer canvases from DOM before resetting
        this.layers.forEach(l => {
            if (l.canvas && l.canvas.parentNode) l.canvas.remove();
        });

        this.layers = [];
        this.activeIndex = 0;

        // Set up system canvases
        ['canvas-bg', 'canvas-grid', 'canvas-selection', 'canvas-overlay', 'canvas-cursor'].forEach(id => {
            const c = document.getElementById(id);
            c.width = width;
            c.height = height;
        });

        // Draw background
        this.drawBackground(bgColor);

        // Add initial layer
        this.addLayer('Layer 1');

        // Set container size
        const container = document.getElementById('canvas-container');
        container.style.width = width + 'px';
        container.style.height = height + 'px';
    },

    drawBackground(bgColor) {
        const bgCanvas = document.getElementById('canvas-bg');
        const ctx = bgCanvas.getContext('2d');
        if (bgColor === 'transparent') {
            // Checker pattern
            const size = 8;
            for (let y = 0; y < bgCanvas.height; y += size) {
                for (let x = 0; x < bgCanvas.width; x += size) {
                    ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#cccccc' : '#ffffff';
                    ctx.fillRect(x, y, size, size);
                }
            }
        } else if (bgColor === 'black') {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        }
    },

    addLayer(name, insertAbove) {
        const canvas = document.createElement('canvas');
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;
        canvas.className = 'layer-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';

        const layer = {
            id: Utils.uid(),
            name: name || `Layer ${this.layers.length + 1}`,
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            alphaLock: false,
            clipping: false
        };

        const idx = insertAbove !== undefined ? insertAbove + 1 : this.layers.length;
        this.layers.splice(idx, 0, layer);
        this.activeIndex = idx;

        this.rebuildCanvasStack();
        this.updateUI();
        return layer;
    },

    removeLayer(index) {
        if (this.layers.length <= 1) return;
        const idx = index !== undefined ? index : this.activeIndex;
        this.layers[idx].canvas.remove();
        this.layers.splice(idx, 1);
        if (this.activeIndex >= this.layers.length) {
            this.activeIndex = this.layers.length - 1;
        }
        this.rebuildCanvasStack();
        this.render();
        this.updateUI();
    },

    duplicateLayer(index) {
        const idx = index !== undefined ? index : this.activeIndex;
        const src = this.layers[idx];
        const newLayer = this.addLayer(src.name + ' copy', idx);
        newLayer.ctx.drawImage(src.canvas, 0, 0);
        newLayer.opacity = src.opacity;
        newLayer.blendMode = src.blendMode;
        this.render();
        return newLayer;
    },

    mergeDown(index) {
        const idx = index !== undefined ? index : this.activeIndex;
        if (idx <= 0) return;
        const upper = this.layers[idx];
        const lower = this.layers[idx - 1];
        lower.ctx.globalAlpha = upper.opacity;
        lower.ctx.globalCompositeOperation = upper.blendMode;
        lower.ctx.drawImage(upper.canvas, 0, 0);
        lower.ctx.globalAlpha = 1;
        lower.ctx.globalCompositeOperation = 'source-over';
        this.removeLayer(idx);
        this.activeIndex = idx - 1;
        this.render();
        this.updateUI();
    },

    flatten() {
        const result = Utils.createCanvas(this.canvasWidth, this.canvasHeight);
        const ctx = result.getContext('2d');
        // Draw white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

        this.layers.forEach(layer => {
            if (!layer.visible) return;
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.drawImage(layer.canvas, 0, 0);
        });
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Clear all layers except one
        while (this.layers.length > 1) {
            this.layers[this.layers.length - 1].canvas.remove();
            this.layers.pop();
        }
        this.activeIndex = 0;
        this.layers[0].ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.layers[0].ctx.drawImage(result, 0, 0);
        this.layers[0].name = 'Background';
        this.layers[0].opacity = 1;
        this.layers[0].blendMode = 'source-over';

        this.render();
        this.updateUI();
    },

    moveLayer(fromIdx, toIdx) {
        if (toIdx < 0 || toIdx >= this.layers.length) return;
        const layer = this.layers.splice(fromIdx, 1)[0];
        this.layers.splice(toIdx, 0, layer);
        this.activeIndex = toIdx;
        this.rebuildCanvasStack();
        this.render();
        this.updateUI();
    },

    getActive() {
        return this.layers[this.activeIndex];
    },

    getActiveCtx() {
        return this.layers[this.activeIndex].ctx;
    },

    // Rebuild the DOM order of layer canvases
    rebuildCanvasStack() {
        const container = document.getElementById('canvas-container');
        // Remove all layer canvases
        this.layers.forEach(l => {
            if (l.canvas.parentNode) l.canvas.remove();
        });
        // Re-add in order (bottom to top)
        const bgCanvas = document.getElementById('canvas-bg');
        this.layers.forEach((l, i) => {
            l.canvas.style.zIndex = i + 1;
            container.insertBefore(l.canvas, document.getElementById('canvas-grid'));
        });
    },

    // Composite render (for export / navigator)
    render() {
        // Update individual layer canvas visibility/opacity
        this.layers.forEach(layer => {
            layer.canvas.style.display = layer.visible ? 'block' : 'none';
            layer.canvas.style.opacity = layer.opacity;
            layer.canvas.style.mixBlendMode = this.blendModeToCSS(layer.blendMode);
        });

        // Handle clipping masks
        // Note: True clipping masks require composited rendering (not CSS).
        // We approximate by adjusting the DOM structure when clipping is on.
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (layer.clipping && i > 0 && layer.visible) {
                // Simple CSS approach: use mask-image on the clipped layer's canvas
                // by converting the base layer to a mask
                try {
                    const baseLayer = this.layers[i - 1];
                    const tmpCanvas = Utils.createCanvas(this.canvasWidth, this.canvasHeight);
                    const tmpCtx = tmpCanvas.getContext('2d');
                    tmpCtx.drawImage(baseLayer.canvas, 0, 0);
                    const maskUrl = tmpCanvas.toDataURL();
                    layer.canvas.style.webkitMaskImage = `url(${maskUrl})`;
                    layer.canvas.style.maskImage = `url(${maskUrl})`;
                    layer.canvas.style.webkitMaskSize = '100% 100%';
                    layer.canvas.style.maskSize = '100% 100%';
                } catch (ex) {
                    // Fallback: no clipping
                }
            } else {
                // Remove any clipping mask
                layer.canvas.style.webkitMaskImage = '';
                layer.canvas.style.maskImage = '';
            }
        }

        // Update navigator
        this.updateNavigator();
    },

    blendModeToCSS(mode) {
        const map = {
            'source-over': 'normal',
            'multiply': 'multiply',
            'screen': 'screen',
            'overlay': 'overlay',
            'darken': 'darken',
            'lighten': 'lighten',
            'color-dodge': 'color-dodge',
            'color-burn': 'color-burn',
            'hard-light': 'hard-light',
            'soft-light': 'soft-light',
            'difference': 'difference',
            'exclusion': 'exclusion',
            'hue': 'hue',
            'saturation': 'saturation',
            'color': 'color',
            'luminosity': 'luminosity'
        };
        return map[mode] || 'normal';
    },

    updateNavigator() {
        const navCanvas = document.getElementById('navigator-canvas');
        const navCtx = navCanvas.getContext('2d');
        navCtx.clearRect(0, 0, navCanvas.width, navCanvas.height);

        // Draw checkerboard bg
        const size = 4;
        for (let y = 0; y < navCanvas.height; y += size) {
            for (let x = 0; x < navCanvas.width; x += size) {
                navCtx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#ccc' : '#fff';
                navCtx.fillRect(x, y, size, size);
            }
        }

        // Scale and draw all visible layers
        const scale = Math.min(navCanvas.width / this.canvasWidth, navCanvas.height / this.canvasHeight);
        const offX = (navCanvas.width - this.canvasWidth * scale) / 2;
        const offY = (navCanvas.height - this.canvasHeight * scale) / 2;

        this.layers.forEach(layer => {
            if (!layer.visible) return;
            navCtx.globalAlpha = layer.opacity;
            navCtx.drawImage(layer.canvas, offX, offY, this.canvasWidth * scale, this.canvasHeight * scale);
        });
        navCtx.globalAlpha = 1;
    },

    // Serialize for history (in-memory ImageData, fast)
    serialize() {
        return this.layers.map(l => ({
            id: l.id,
            name: l.name,
            imageData: l.ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight),
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode,
            locked: l.locked,
            alphaLock: l.alphaLock,
            clipping: l.clipping
        }));
    },

    // Serialize for file save (data URLs, JSON-safe)
    serializeForFile() {
        return this.layers.map(l => ({
            id: l.id,
            name: l.name,
            dataURL: l.canvas.toDataURL('image/png'),
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode,
            locked: l.locked,
            alphaLock: l.alphaLock,
            clipping: l.clipping
        }));
    },

    // Deserialize from history (in-memory ImageData)
    deserialize(data) {
        // Clear existing
        this.layers.forEach(l => {
            if (l.canvas && l.canvas.parentNode) l.canvas.remove();
        });
        this.layers = [];

        data.forEach(d => {
            const canvas = document.createElement('canvas');
            canvas.width = this.canvasWidth;
            canvas.height = this.canvasHeight;
            canvas.className = 'layer-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';

            const ctx = canvas.getContext('2d');
            ctx.putImageData(d.imageData, 0, 0);

            this.layers.push({
                id: d.id,
                name: d.name,
                canvas,
                ctx,
                visible: d.visible,
                opacity: d.opacity,
                blendMode: d.blendMode,
                locked: d.locked,
                alphaLock: d.alphaLock,
                clipping: d.clipping
            });
        });

        this.rebuildCanvasStack();
    },

    // Deserialize from file (data URLs)
    deserializeFromFile(data, width, height) {
        // Update dimensions
        this.canvasWidth = width;
        this.canvasHeight = height;

        // Clear existing
        this.layers.forEach(l => {
            if (l.canvas && l.canvas.parentNode) l.canvas.remove();
        });
        this.layers = [];

        // Set container size
        const container = document.getElementById('canvas-container');
        container.style.width = width + 'px';
        container.style.height = height + 'px';

        let loaded = 0;
        const total = data.length;

        data.forEach((d, i) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.className = 'layer-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';

            const ctx = canvas.getContext('2d');

            const layer = {
                id: d.id,
                name: d.name,
                canvas,
                ctx,
                visible: d.visible,
                opacity: d.opacity,
                blendMode: d.blendMode,
                locked: d.locked || false,
                alphaLock: d.alphaLock || false,
                clipping: d.clipping || false
            };
            this.layers.push(layer);

            // Load image data from data URL
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                loaded++;
                if (loaded === total) {
                    this.rebuildCanvasStack();
                    this.render();
                    this.updateUI();
                    this.updateNavigator();
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded === total) {
                    this.rebuildCanvasStack();
                    this.render();
                    this.updateUI();
                    this.updateNavigator();
                }
            };
            img.src = d.dataURL;
        });

        // If no layers, just rebuild
        if (total === 0) {
            this.rebuildCanvasStack();
            this.render();
            this.updateUI();
        }
    },

    // Get composited canvas for export
    getComposited(includeBackground) {
        const result = Utils.createCanvas(this.canvasWidth, this.canvasHeight);
        const ctx = result.getContext('2d');

        if (includeBackground) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        }

        this.layers.forEach(layer => {
            if (!layer.visible) return;
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.drawImage(layer.canvas, 0, 0);
        });

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return result;
    },

    // Update the layers panel UI
    updateUI() {
        const list = document.getElementById('layer-list');
        list.innerHTML = '';

        // Render layers top to bottom (reverse order)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            const el = document.createElement('div');
            el.className = 'layer-item' + (i === this.activeIndex ? ' active' : '');
            el.dataset.index = i;

            // Visibility
            const vis = document.createElement('span');
            vis.className = 'layer-visibility';
            vis.textContent = layer.visible ? '👁' : '·';
            vis.addEventListener('click', (e) => {
                e.stopPropagation();
                layer.visible = !layer.visible;
                this.render();
                this.updateUI();
            });

            // Thumbnail
            const thumb = document.createElement('canvas');
            thumb.className = 'layer-thumb';
            thumb.width = 32;
            thumb.height = 32;
            const thumbCtx = thumb.getContext('2d');
            // Checker bg
            for (let y = 0; y < 32; y += 4) {
                for (let x = 0; x < 32; x += 4) {
                    thumbCtx.fillStyle = ((x / 4 + y / 4) % 2 === 0) ? '#ccc' : '#fff';
                    thumbCtx.fillRect(x, y, 4, 4);
                }
            }
            thumbCtx.drawImage(layer.canvas, 0, 0, 32, 32);

            // Name
            const name = document.createElement('span');
            name.className = 'layer-name';
            name.textContent = layer.name;
            name.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = layer.name;
                input.style.cssText = 'width:100%;background:var(--bg-input);border:1px solid var(--accent);color:var(--text);font-size:11px;padding:1px 3px;';
                name.replaceWith(input);
                input.focus();
                input.select();
                const finish = () => {
                    layer.name = input.value || layer.name;
                    this.updateUI();
                };
                input.addEventListener('blur', finish);
                input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finish(); });
            });

            // Alpha lock
            const alphaLock = document.createElement('span');
            alphaLock.className = 'layer-icon layer-alpha-lock' + (layer.alphaLock ? ' active' : '');
            alphaLock.textContent = 'A';
            alphaLock.title = 'Alpha Lock' + (layer.alphaLock ? ' (ON)' : '');
            alphaLock.addEventListener('click', (e) => {
                e.stopPropagation();
                layer.alphaLock = !layer.alphaLock;
                this.updateUI();
            });

            // Clip
            const clip = document.createElement('span');
            clip.className = 'layer-icon layer-clip' + (layer.clipping ? ' active' : '');
            clip.textContent = 'C';
            clip.title = 'Clipping Mask' + (layer.clipping ? ' (ON)' : '');
            clip.addEventListener('click', (e) => {
                e.stopPropagation();
                layer.clipping = !layer.clipping;
                this.render();
                this.updateUI();
            });

            // Lock
            const lock = document.createElement('span');
            lock.className = 'layer-icon layer-lock' + (layer.locked ? ' active' : '');
            lock.textContent = 'L';
            lock.title = 'Lock Layer' + (layer.locked ? ' (ON)' : '');
            lock.addEventListener('click', (e) => {
                e.stopPropagation();
                layer.locked = !layer.locked;
                this.updateUI();
            });


            el.appendChild(vis);
            el.appendChild(thumb);
            el.appendChild(name);
            el.appendChild(alphaLock);
            el.appendChild(clip);
            el.appendChild(lock);

            el.addEventListener('click', () => {
                this.activeIndex = i;
                this.updateUI();
                // Update blend mode/opacity controls
                document.getElementById('layer-blend-mode').value = layer.blendMode;
                document.getElementById('layer-opacity').value = Math.round(layer.opacity * 100);
                document.getElementById('layer-opacity-val').textContent = Math.round(layer.opacity * 100) + '%';
            });

            list.appendChild(el);
        }

        // Update controls to reflect active layer
        const active = this.getActive();
        if (active) {
            document.getElementById('layer-blend-mode').value = active.blendMode;
            document.getElementById('layer-opacity').value = Math.round(active.opacity * 100);
            document.getElementById('layer-opacity-val').textContent = Math.round(active.opacity * 100) + '%';
        }
    }
};
