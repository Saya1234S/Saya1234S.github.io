// ========================================
// PAINTONO - Tools System
// ========================================

const Tools = {
    current: 'brush',
    isDrawing: false,
    lastX: 0, lastY: 0,
    lastPressure: 0.5,
    startX: 0, startY: 0,
    prevTool: null,

    // For shape/selection preview
    tempCanvas: null,
    tempCtx: null,

    // For lasso
    lassoPoints: [],

    // For move tool
    moveOffsetX: 0,
    moveOffsetY: 0,
    moveImageData: null,

    // For transform
    transformActive: false,
    transformData: null,

    // For text
    textInput: null,

    init() {
        this.tempCanvas = Utils.createCanvas(Layers.canvasWidth, Layers.canvasHeight);
        this.tempCtx = this.tempCanvas.getContext('2d');
    },

    setTool(tool) {
        // Save current tool's brush settings before switching
        if (['brush', 'pencil', 'eraser'].includes(this.current)) {
            Brushes.saveToolSettings(this.current);
        }

        // Track previous tool for eyedropper revert
        if (this.current !== 'eyedropper' && tool === 'eyedropper') {
            this._eyedropperPrevTool = this.current;
        }

        this.current = tool;

        // Load the new tool's brush settings
        if (['brush', 'pencil', 'eraser'].includes(tool)) {
            Brushes.loadToolSettings(tool);
        }

        // Update UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Show/hide appropriate options
        document.querySelectorAll('.option-group').forEach(el => el.style.display = 'none');

        const toolOptionsMap = {
            'brush': 'brush-options',
            'pencil': 'brush-options',
            'eraser': 'brush-options',
            'line': 'shape-options',
            'rect': 'shape-options',
            'ellipse': 'shape-options',
            'fill': 'fill-options',
            'gradient': 'gradient-options',
            'select-rect': 'select-options',
            'select-ellipse': 'select-options',
            'select-lasso': 'select-options',
            'magic-wand': 'wand-options',
            'text': 'text-options',
            'symmetry': 'symmetry-options',
            'transform': 'transform-options'
        };

        const optId = toolOptionsMap[tool];
        if (optId) {
            document.getElementById(optId).style.display = 'flex';
        }

        // Update status
        const names = {
            'brush': 'Brush', 'pencil': 'Pencil', 'eraser': 'Eraser',
            'line': 'Line', 'rect': 'Rectangle', 'ellipse': 'Ellipse',
            'fill': 'Fill Bucket', 'gradient': 'Gradient', 'eyedropper': 'Eyedropper',
            'select-rect': 'Rect Selection', 'select-ellipse': 'Ellipse Selection',
            'select-lasso': 'Lasso', 'magic-wand': 'Magic Wand',
            'move': 'Move', 'transform': 'Transform', 'hand': 'Hand',
            'text': 'Text', 'symmetry': 'Symmetry'
        };
        document.getElementById('status-tool').textContent = names[tool] || tool;

        // Set cursor
        const viewport = document.getElementById('canvas-viewport');
        const cursorMap = {
            'hand': 'grab',
            'move': 'move',
            'eyedropper': 'crosshair',
            'text': 'text',
            'fill': 'crosshair',
            'gradient': 'crosshair'
        };
        viewport.style.cursor = cursorMap[tool] || 'crosshair';
    },

    // Convert screen coords to canvas coords (handles zoom, pan, rotation, flip)
    screenToCanvas(clientX, clientY) {
        const viewportRect = document.getElementById('canvas-viewport').getBoundingClientRect();
        const sx = clientX - viewportRect.left;
        const sy = clientY - viewportRect.top;

        const zoom = App.zoom;
        const scaleX = App.flipped ? -zoom : zoom;
        const cx = App.panX + (App.canvasWidth * zoom) / 2;
        const cy = App.panY + (App.canvasHeight * zoom) / 2;

        let m = new DOMMatrix();
        if (App.rotation !== 0) {
            m = m.translate(cx, cy).rotate(App.rotation).translate(-cx, -cy);
        }
        m = m.translate(App.panX, App.panY).scale(scaleX, zoom);

        const inv = m.inverse();
        const p = new DOMPoint(sx, sy).matrixTransform(inv);
        return { x: p.x, y: p.y };
    },

    onPointerDown(e) {
        const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
        const pressure = e.pressure || 0.5;

        // Alt+click = eyedropper
        if (e.altKey && this.current !== 'eyedropper') {
            ColorSystem.pickFromCanvas(Math.floor(x), Math.floor(y));
            return;
        }

        this.isDrawing = true;
        this.startX = x;
        this.startY = y;
        this.lastX = x;
        this.lastY = y;
        this.lastPressure = pressure;

        const layer = Layers.getActive();
        if (layer.locked && ['brush', 'pencil', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'text', 'gradient'].includes(this.current)) {
            this.isDrawing = false;
            return;
        }

        switch (this.current) {
            case 'brush':
            case 'pencil':
                // Save layer state for stroke compositing + selection masking
                this._layerBeforeStroke = layer.ctx.getImageData(0, 0, Layers.canvasWidth, Layers.canvasHeight);
                if (Selection.active) {
                    this._preStrokeData = this._layerBeforeStroke;
                }
                Brushes.beginStroke(Layers.canvasWidth, Layers.canvasHeight);
                Brushes.resetStabilizer();
                if (Symmetry.mode !== 'none') {
                    const points = Symmetry.getPoints(x, y);
                    points.forEach(p => {
                        Brushes.stamp(layer.ctx, p.x, p.y, pressure);
                    });
                } else {
                    Brushes.stamp(layer.ctx, x, y, pressure);
                }
                this._compositeStrokePreview(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                break;

            case 'eraser':
                this._layerBeforeStroke = layer.ctx.getImageData(0, 0, Layers.canvasWidth, Layers.canvasHeight);
                if (Selection.active) {
                    this._preStrokeData = this._layerBeforeStroke;
                }
                Brushes.beginStroke(Layers.canvasWidth, Layers.canvasHeight);
                Brushes.resetStabilizer();
                Brushes.eraseStamp(layer.ctx, x, y, pressure);
                this._compositeEraseStrokePreview(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                break;

            case 'eyedropper':
                // Save current tool before switching, then pick and revert
                if (!this._eyedropperPrevTool) {
                    this._eyedropperPrevTool = this.prevTool || 'brush';
                }
                ColorSystem.pickFromCanvas(Math.floor(x), Math.floor(y));
                // Revert to previous tool after picking
                setTimeout(() => {
                    const revertTo = this._eyedropperPrevTool || 'brush';
                    this._eyedropperPrevTool = null;
                    this.setTool(revertTo);
                }, 50);
                break;

            case 'fill':
                this.floodFill(Math.floor(x), Math.floor(y));
                History.push('Fill');
                break;

            case 'magic-wand':
                const tolerance = parseInt(document.getElementById('wand-tolerance').value);
                const contiguous = document.getElementById('wand-contiguous').checked;
                Selection.magicWand(Math.floor(x), Math.floor(y), tolerance, contiguous);
                break;

            case 'select-lasso':
                this.lassoPoints = [{ x, y }];
                break;

            case 'move':
                this.moveOffsetX = 0;
                this.moveOffsetY = 0;
                break;

            case 'hand':
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                document.getElementById('canvas-viewport').style.cursor = 'grabbing';
                break;

            case 'text':
                this.placeText(Math.floor(x), Math.floor(y));
                break;

            case 'line':
            case 'rect':
            case 'ellipse':
            case 'gradient':
            case 'select-rect':
            case 'select-ellipse':
                // Preview will be drawn on move
                break;

            case 'transform':
                if (!this.transformActive) {
                    this.startTransform();
                }
                break;
        }
    },

    onPointerMove(e) {
        const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
        const pressure = e.pressure || 0.5;

        // Update status bar
        document.getElementById('status-pos').textContent = `X: ${Math.floor(x)} Y: ${Math.floor(y)}`;
        document.getElementById('status-pressure').textContent = `Pressure: ${pressure.toFixed(2)}`;

        // Update cursor circle
        this.drawCursor(x, y);

        if (!this.isDrawing) return;

        const layer = Layers.getActive();
        if (layer.locked && ['brush', 'pencil', 'eraser'].includes(this.current)) return;

        switch (this.current) {
            case 'brush':
            case 'pencil': {
                const stabilized = Brushes.stabilize(x, y);
                const sx = stabilized.x, sy = stabilized.y;

                if (Symmetry.mode !== 'none') {
                    const pts = Symmetry.getPoints(sx, sy);
                    const lastPts = Symmetry.getPoints(this.lastX, this.lastY);
                    for (let i = 0; i < pts.length; i++) {
                        Brushes.strokeBetween(layer.ctx, lastPts[i].x, lastPts[i].y, pts[i].x, pts[i].y, this.lastPressure, pressure);
                    }
                } else {
                    Brushes.strokeBetween(layer.ctx, this.lastX, this.lastY, sx, sy, this.lastPressure, pressure);
                }

                this.lastX = sx;
                this.lastY = sy;
                this.lastPressure = pressure;
                this._compositeStrokePreview(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                break;
            }

            case 'eraser':
                Brushes.eraseStrokeBetween(layer.ctx, this.lastX, this.lastY, x, y, this.lastPressure, pressure);
                this.lastX = x;
                this.lastY = y;
                this.lastPressure = pressure;
                this._compositeEraseStrokePreview(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                break;

            case 'eyedropper':
                ColorSystem.pickFromCanvas(Math.floor(x), Math.floor(y));
                break;

            case 'select-lasso':
                this.lassoPoints.push({ x, y });
                this.drawLassoPreview();
                break;

            case 'move': {
                const dx = x - this.startX;
                const dy = y - this.startY;
                this.moveLayer(dx - this.moveOffsetX, dy - this.moveOffsetY);
                this.moveOffsetX = dx;
                this.moveOffsetY = dy;
                Layers.render();
                break;
            }

            case 'line':
            case 'rect':
            case 'ellipse':
            case 'gradient':
            case 'select-rect':
            case 'select-ellipse':
                this.drawShapePreview(x, y);
                break;
        }
    },

    onPointerUp(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this._preStrokeData = null;

        const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
        const layer = Layers.getActive();

        switch (this.current) {
            case 'brush':
            case 'pencil':
                // Finalize stroke: restore original, composite stroke at opacity, alpha lock
                this._finalizeStroke(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                History.push('Brush Stroke');
                break;

            case 'eraser':
                this._finalizeEraseStroke(layer);
                if (Selection.active) this.applySelectionMask(layer);
                Layers.render();
                History.push('Erase');
                break;

            case 'line':
                this.drawLine(layer.ctx, this.startX, this.startY, x, y);
                this.clearOverlay();
                History.push('Line');
                Layers.render();
                break;

            case 'rect':
                this.drawRect(layer.ctx, this.startX, this.startY, x, y);
                this.clearOverlay();
                History.push('Rectangle');
                Layers.render();
                break;

            case 'ellipse':
                this.drawEllipseShape(layer.ctx, this.startX, this.startY, x, y);
                this.clearOverlay();
                History.push('Ellipse');
                Layers.render();
                break;

            case 'gradient':
                this.drawGradient(layer.ctx, this.startX, this.startY, x, y);
                this.clearOverlay();
                History.push('Gradient');
                Layers.render();
                break;

            case 'select-rect': {
                const feather = parseInt(document.getElementById('select-feather').value);
                const sx = Math.min(this.startX, x);
                const sy = Math.min(this.startY, y);
                const sw = Math.abs(x - this.startX);
                const sh = Math.abs(y - this.startY);
                Selection.setRect(Math.floor(sx), Math.floor(sy), Math.floor(sw), Math.floor(sh), feather);
                this.clearOverlay();
                break;
            }

            case 'select-ellipse': {
                const feather = parseInt(document.getElementById('select-feather').value);
                const cx2 = (this.startX + x) / 2;
                const cy2 = (this.startY + y) / 2;
                const rx = Math.abs(x - this.startX) / 2;
                const ry = Math.abs(y - this.startY) / 2;
                Selection.setEllipse(Math.floor(cx2), Math.floor(cy2), Math.floor(rx), Math.floor(ry), feather);
                this.clearOverlay();
                break;
            }

            case 'select-lasso': {
                const feather = parseInt(document.getElementById('select-feather').value);
                if (this.lassoPoints.length >= 3) {
                    Selection.setLasso(this.lassoPoints, feather);
                }
                this.lassoPoints = [];
                this.clearOverlay();
                break;
            }

            case 'move':
                History.push('Move');
                break;
        }
    },

    // Draw cursor circle on cursor canvas
    drawCursor(x, y) {
        const cursorCanvas = document.getElementById('canvas-cursor');
        const ctx = cursorCanvas.getContext('2d');
        ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

        if (['brush', 'pencil', 'eraser'].includes(this.current)) {
            const radius = Brushes.size / 2;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, radius + 1, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.stroke();
        }

        // Draw symmetry guides
        if (this.current === 'symmetry' || Symmetry.mode !== 'none') {
            const overlayCtx = document.getElementById('canvas-overlay').getContext('2d');
            overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
            Symmetry.drawGuide(overlayCtx);
        }
    },

    clearOverlay() {
        const overlay = document.getElementById('canvas-overlay').getContext('2d');
        overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
    },

    // Shape preview on overlay
    drawShapePreview(x, y) {
        const overlay = document.getElementById('canvas-overlay').getContext('2d');
        overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);

        overlay.save();
        overlay.strokeStyle = ColorSystem.getPrimaryCSS();
        overlay.fillStyle = ColorSystem.getPrimaryCSS();
        overlay.lineWidth = parseInt(document.getElementById('shape-stroke-width')?.value || 2);
        overlay.setLineDash([]);

        switch (this.current) {
            case 'line':
                overlay.beginPath();
                overlay.moveTo(this.startX, this.startY);
                overlay.lineTo(x, y);
                overlay.stroke();
                break;

            case 'rect':
                if (document.getElementById('shape-fill')?.checked) {
                    overlay.fillRect(this.startX, this.startY, x - this.startX, y - this.startY);
                } else {
                    overlay.strokeRect(this.startX, this.startY, x - this.startX, y - this.startY);
                }
                break;

            case 'ellipse': {
                const cx2 = (this.startX + x) / 2;
                const cy2 = (this.startY + y) / 2;
                const rx = Math.abs(x - this.startX) / 2;
                const ry = Math.abs(y - this.startY) / 2;
                overlay.beginPath();
                overlay.ellipse(cx2, cy2, rx, ry, 0, 0, Math.PI * 2);
                if (document.getElementById('shape-fill')?.checked) {
                    overlay.fill();
                } else {
                    overlay.stroke();
                }
                break;
            }

            case 'gradient':
                overlay.strokeStyle = 'rgba(255,255,255,0.5)';
                overlay.lineWidth = 1;
                overlay.setLineDash([4, 4]);
                overlay.beginPath();
                overlay.moveTo(this.startX, this.startY);
                overlay.lineTo(x, y);
                overlay.stroke();
                break;

            case 'select-rect':
                overlay.strokeStyle = 'rgba(0,120,212,0.8)';
                overlay.lineWidth = 1;
                overlay.setLineDash([4, 4]);
                overlay.strokeRect(this.startX, this.startY, x - this.startX, y - this.startY);
                break;

            case 'select-ellipse': {
                const cx3 = (this.startX + x) / 2;
                const cy3 = (this.startY + y) / 2;
                const rx2 = Math.abs(x - this.startX) / 2;
                const ry2 = Math.abs(y - this.startY) / 2;
                overlay.strokeStyle = 'rgba(0,120,212,0.8)';
                overlay.lineWidth = 1;
                overlay.setLineDash([4, 4]);
                overlay.beginPath();
                overlay.ellipse(cx3, cy3, rx2, ry2, 0, 0, Math.PI * 2);
                overlay.stroke();
                break;
            }
        }
        overlay.restore();
    },

    drawLassoPreview() {
        const overlay = document.getElementById('canvas-overlay').getContext('2d');
        overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);

        if (this.lassoPoints.length < 2) return;

        overlay.save();
        overlay.strokeStyle = 'rgba(0,120,212,0.8)';
        overlay.lineWidth = 1;
        overlay.setLineDash([4, 4]);
        overlay.beginPath();
        overlay.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
        for (let i = 1; i < this.lassoPoints.length; i++) {
            overlay.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
        }
        overlay.stroke();
        overlay.restore();
    },

    // Draw shapes on context
    drawLine(ctx, x1, y1, x2, y2) {
        ctx.save();
        ctx.strokeStyle = ColorSystem.getPrimaryCSS();
        ctx.lineWidth = parseInt(document.getElementById('shape-stroke-width')?.value || 2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    },

    drawRect(ctx, x1, y1, x2, y2) {
        ctx.save();
        ctx.strokeStyle = ColorSystem.getPrimaryCSS();
        ctx.fillStyle = ColorSystem.getPrimaryCSS();
        ctx.lineWidth = parseInt(document.getElementById('shape-stroke-width')?.value || 2);
        if (document.getElementById('shape-fill')?.checked) {
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        } else {
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        }
        ctx.restore();
    },

    drawEllipseShape(ctx, x1, y1, x2, y2) {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        ctx.save();
        ctx.strokeStyle = ColorSystem.getPrimaryCSS();
        ctx.fillStyle = ColorSystem.getPrimaryCSS();
        ctx.lineWidth = parseInt(document.getElementById('shape-stroke-width')?.value || 2);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (document.getElementById('shape-fill')?.checked) {
            ctx.fill();
        } else {
            ctx.stroke();
        }
        ctx.restore();
    },

    drawGradient(ctx, x1, y1, x2, y2) {
        const type = document.getElementById('gradient-type').value;
        let gradient;

        if (type === 'radial') {
            const dist = Utils.dist(x1, y1, x2, y2);
            gradient = ctx.createRadialGradient(x1, y1, 0, x1, y1, dist);
        } else {
            gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        }

        gradient.addColorStop(0, ColorSystem.getPrimaryCSS());
        gradient.addColorStop(1, ColorSystem.getSecondaryCSS());

        ctx.save();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, Layers.canvasWidth, Layers.canvasHeight);
        ctx.restore();
    },

    // Flood fill
    floodFill(startX, startY) {
        const layer = Layers.getActive();
        const ctx = layer.ctx;
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        const imgData = ctx.getImageData(0, 0, cw, ch);
        const data = imgData.data;
        const tolerance = parseInt(document.getElementById('fill-tolerance').value);
        const contiguous = document.getElementById('fill-contiguous').checked;

        const startIdx = (startY * cw + startX) * 4;
        const tr = data[startIdx], tg = data[startIdx + 1], tb = data[startIdx + 2], ta = data[startIdx + 3];

        const fr = ColorSystem.primary.r;
        const fg = ColorSystem.primary.g;
        const fb = ColorSystem.primary.b;
        const fa = Math.round(ColorSystem.primary.a * (Brushes.opacity / 100));

        // Don't fill if same color
        if (fr === tr && fg === tg && fb === tb && fa === ta) return;

        const colorMatch = (i) => {
            return Math.abs(data[i] - tr) + Math.abs(data[i+1] - tg) +
                   Math.abs(data[i+2] - tb) + Math.abs(data[i+3] - ta) <= tolerance * 4;
        };

        if (contiguous) {
            const visited = new Uint8Array(cw * ch);
            const stack = [startX + startY * cw];

            while (stack.length > 0) {
                const pos = stack.pop();
                if (visited[pos]) continue;
                visited[pos] = 1;

                const px = pos % cw;
                const py = Math.floor(pos / cw);
                const pi = pos * 4;

                if (!colorMatch(pi)) continue;

                // Check selection
                if (Selection.active && !Selection.isSelected(px, py)) continue;

                data[pi] = fr;
                data[pi+1] = fg;
                data[pi+2] = fb;
                data[pi+3] = fa;

                if (px > 0) stack.push(pos - 1);
                if (px < cw - 1) stack.push(pos + 1);
                if (py > 0) stack.push(pos - cw);
                if (py < ch - 1) stack.push(pos + cw);
            }
        } else {
            for (let i = 0; i < data.length; i += 4) {
                if (colorMatch(i)) {
                    const px = (i / 4) % cw;
                    const py = Math.floor((i / 4) / cw);
                    if (Selection.active && !Selection.isSelected(px, py)) continue;
                    data[i] = fr;
                    data[i+1] = fg;
                    data[i+2] = fb;
                    data[i+3] = fa;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        Layers.render();
    },

    // Move layer content
    moveLayer(dx, dy) {
        const layer = Layers.getActive();
        const tmpCanvas = Utils.createCanvas(Layers.canvasWidth, Layers.canvasHeight);
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(layer.canvas, 0, 0);
        layer.ctx.clearRect(0, 0, Layers.canvasWidth, Layers.canvasHeight);
        layer.ctx.drawImage(tmpCanvas, dx, dy);
    },

    // Text placement
    placeText(x, y) {
        const layer = Layers.getActive();
        const font = document.getElementById('text-font').value;
        const size = parseInt(document.getElementById('text-size').value);
        const bold = document.getElementById('text-bold').classList.contains('active');
        const italic = document.getElementById('text-italic').classList.contains('active');

        // Prompt for text (simple approach)
        const text = prompt('Enter text:');
        if (!text) return;

        layer.ctx.save();
        layer.ctx.fillStyle = ColorSystem.getPrimaryCSS();
        layer.ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${font}"`;
        layer.ctx.textBaseline = 'top';
        layer.ctx.fillText(text, x, y);
        layer.ctx.restore();

        Layers.render();
        History.push('Text');
    },

    // ---- Stroke compositing helpers ----
    // Live preview: restore original layer, then composite stroke canvas at brush opacity
    _compositeStrokePreview(layer) {
        if (!this._layerBeforeStroke || !Brushes._strokeCanvas) return;
        layer.ctx.putImageData(this._layerBeforeStroke, 0, 0);
        layer.ctx.save();
        layer.ctx.globalAlpha = Brushes.opacity / 100;
        layer.ctx.drawImage(Brushes._strokeCanvas, 0, 0);
        layer.ctx.restore();
    },

    _compositeEraseStrokePreview(layer) {
        if (!this._layerBeforeStroke || !Brushes._strokeCanvas) return;
        layer.ctx.putImageData(this._layerBeforeStroke, 0, 0);
        layer.ctx.save();
        layer.ctx.globalCompositeOperation = 'destination-out';
        layer.ctx.globalAlpha = Brushes.opacity / 100;
        layer.ctx.drawImage(Brushes._strokeCanvas, 0, 0);
        layer.ctx.restore();
    },

    // Finalize a brush stroke: restore original, composite stroke at opacity, apply alpha lock, clean up
    _finalizeStroke(layer) {
        if (!this._layerBeforeStroke || !Brushes._strokeCanvas) {
            this._layerBeforeStroke = null;
            Brushes._strokeCanvas = null;
            Brushes._strokeCtx = null;
            return;
        }
        layer.ctx.putImageData(this._layerBeforeStroke, 0, 0);
        Brushes.endStroke(layer.ctx);

        // Apply alpha lock: restore original alpha where pixels didn't exist before
        if (layer.alphaLock) {
            const cw = Layers.canvasWidth;
            const ch = Layers.canvasHeight;
            const after = layer.ctx.getImageData(0, 0, cw, ch);
            const before = this._layerBeforeStroke.data;
            for (let i = 3; i < after.data.length; i += 4) {
                after.data[i] = Math.min(after.data[i], before[i]);
            }
            layer.ctx.putImageData(after, 0, 0);
        }
        this._layerBeforeStroke = null;
    },

    _finalizeEraseStroke(layer) {
        if (!this._layerBeforeStroke || !Brushes._strokeCanvas) {
            this._layerBeforeStroke = null;
            Brushes._strokeCanvas = null;
            Brushes._strokeCtx = null;
            return;
        }
        layer.ctx.putImageData(this._layerBeforeStroke, 0, 0);
        Brushes.endEraseStroke(layer.ctx);
        this._layerBeforeStroke = null;
    },

    // Apply alpha lock after stroke finalization
    _applyAlphaLock(layer) {
        if (!this._preStrokeData) return;
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        const after = layer.ctx.getImageData(0, 0, cw, ch);
        const before = this._preStrokeData.data;
        for (let i = 3; i < after.data.length; i += 4) {
            after.data[i] = Math.min(after.data[i], before[i]);
        }
        layer.ctx.putImageData(after, 0, 0);
    },

    // Apply selection mask to constrain drawing to selected area
    applySelectionMask(layer) {
        if (!Selection.active || !Selection.mask) return;
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        const imgData = layer.ctx.getImageData(0, 0, cw, ch);
        const data = imgData.data;
        // We need the state before we started this stroke — stored in _preStrokeData
        if (!this._preStrokeData) return;
        const pre = this._preStrokeData.data;
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                const idx = y * cw + x;
                const mask = Selection.mask[idx];
                if (mask === 0) {
                    // Restore pixels outside selection
                    const pi = idx * 4;
                    data[pi] = pre[pi];
                    data[pi + 1] = pre[pi + 1];
                    data[pi + 2] = pre[pi + 2];
                    data[pi + 3] = pre[pi + 3];
                } else if (mask < 255) {
                    // Blend for feathered edges
                    const pi = idx * 4;
                    const t = mask / 255;
                    data[pi] = Math.round(pre[pi] * (1 - t) + data[pi] * t);
                    data[pi + 1] = Math.round(pre[pi + 1] * (1 - t) + data[pi + 1] * t);
                    data[pi + 2] = Math.round(pre[pi + 2] * (1 - t) + data[pi + 2] * t);
                    data[pi + 3] = Math.round(pre[pi + 3] * (1 - t) + data[pi + 3] * t);
                }
            }
        }
        layer.ctx.putImageData(imgData, 0, 0);
    },

    // Alpha lock drawing helper
    drawWithAlphaLock(layer, drawFn) {
        const imgDataBefore = layer.ctx.getImageData(0, 0, Layers.canvasWidth, Layers.canvasHeight);
        drawFn();
        const imgDataAfter = layer.ctx.getImageData(0, 0, Layers.canvasWidth, Layers.canvasHeight);

        // Restore original alpha
        for (let i = 3; i < imgDataAfter.data.length; i += 4) {
            imgDataAfter.data[i] = Math.min(imgDataAfter.data[i], imgDataBefore.data[i]);
        }
        layer.ctx.putImageData(imgDataAfter, 0, 0);
    },

    // Transform tool
    startTransform() {
        this.transformActive = true;
        // Just show the transform options - actual implementation uses simple flip/rotate
    },

    applyFlipH() {
        const layer = Layers.getActive();
        const tmp = Utils.createCanvas(Layers.canvasWidth, Layers.canvasHeight);
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.translate(Layers.canvasWidth, 0);
        tmpCtx.scale(-1, 1);
        tmpCtx.drawImage(layer.canvas, 0, 0);
        layer.ctx.clearRect(0, 0, Layers.canvasWidth, Layers.canvasHeight);
        layer.ctx.drawImage(tmp, 0, 0);
        Layers.render();
        History.push('Flip Horizontal');
    },

    applyFlipV() {
        const layer = Layers.getActive();
        const tmp = Utils.createCanvas(Layers.canvasWidth, Layers.canvasHeight);
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.translate(0, Layers.canvasHeight);
        tmpCtx.scale(1, -1);
        tmpCtx.drawImage(layer.canvas, 0, 0);
        layer.ctx.clearRect(0, 0, Layers.canvasWidth, Layers.canvasHeight);
        layer.ctx.drawImage(tmp, 0, 0);
        Layers.render();
        History.push('Flip Vertical');
    },

    applyRotate(degrees) {
        const layer = Layers.getActive();
        const w = Layers.canvasWidth;
        const h = Layers.canvasHeight;
        const tmp = Utils.createCanvas(w, h);
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.translate(w / 2, h / 2);
        tmpCtx.rotate(degrees * Math.PI / 180);
        tmpCtx.drawImage(layer.canvas, -w / 2, -h / 2);
        layer.ctx.clearRect(0, 0, w, h);
        layer.ctx.drawImage(tmp, 0, 0);
        Layers.render();
        History.push(`Rotate ${degrees}°`);
    }
};
