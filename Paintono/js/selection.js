// ========================================
// PAINTONO - Selection System
// ========================================

const Selection = {
    active: false,
    mask: null, // Uint8Array mask (255 = selected, 0 = not)
    bounds: null, // {x, y, w, h}
    marchingAnts: null,
    animFrame: null,
    offset: 0,

    init() {
        this.canvas = document.getElementById('canvas-selection');
        this.ctx = this.canvas.getContext('2d');
    },

    clear() {
        this.active = false;
        this.mask = null;
        this.bounds = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
    },

    // Create rect selection
    setRect(x, y, w, h, feather) {
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.mask = new Uint8Array(cw * ch);

        const x1 = Math.max(0, Math.min(x, x + w));
        const y1 = Math.max(0, Math.min(y, y + h));
        const x2 = Math.min(cw, Math.max(x, x + w));
        const y2 = Math.min(ch, Math.max(y, y + h));

        for (let py = y1; py < y2; py++) {
            for (let px = x1; px < x2; px++) {
                this.mask[py * cw + px] = 255;
            }
        }

        if (feather > 0) this.applyFeather(feather);

        this.bounds = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        this.active = true;
        this.drawMarchingAnts();
    },

    // Elliptical selection
    setEllipse(cx, cy, rx, ry, feather) {
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.mask = new Uint8Array(cw * ch);

        const x1 = Math.max(0, Math.floor(cx - rx));
        const y1 = Math.max(0, Math.floor(cy - ry));
        const x2 = Math.min(cw, Math.ceil(cx + rx));
        const y2 = Math.min(ch, Math.ceil(cy + ry));

        for (let py = y1; py < y2; py++) {
            for (let px = x1; px < x2; px++) {
                const dx = (px - cx) / rx;
                const dy = (py - cy) / ry;
                if (dx * dx + dy * dy <= 1) {
                    this.mask[py * cw + px] = 255;
                }
            }
        }

        if (feather > 0) this.applyFeather(feather);

        this.bounds = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        this.active = true;
        this.drawMarchingAnts();
    },

    // Lasso selection from array of points
    setLasso(points, feather) {
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.mask = new Uint8Array(cw * ch);

        if (points.length < 3) return;

        // Use a temporary canvas to rasterize the polygon
        const tmpCanvas = Utils.createCanvas(cw, ch);
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.fillStyle = '#ffffff';
        tmpCtx.beginPath();
        tmpCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            tmpCtx.lineTo(points[i].x, points[i].y);
        }
        tmpCtx.closePath();
        tmpCtx.fill();

        const imgData = tmpCtx.getImageData(0, 0, cw, ch);
        let minX = cw, minY = ch, maxX = 0, maxY = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
            const idx = i / 4;
            if (imgData.data[i] > 128) {
                this.mask[idx] = 255;
                const px = idx % cw;
                const py = Math.floor(idx / cw);
                minX = Math.min(minX, px);
                minY = Math.min(minY, py);
                maxX = Math.max(maxX, px);
                maxY = Math.max(maxY, py);
            }
        }

        if (feather > 0) this.applyFeather(feather);

        this.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        this.active = true;
        this.drawMarchingAnts();
    },

    // Magic wand selection
    magicWand(startX, startY, tolerance, contiguous) {
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.mask = new Uint8Array(cw * ch);

        // Get composited image
        const composited = Layers.getComposited(true);
        const ctx = composited.getContext('2d');
        const imgData = ctx.getImageData(0, 0, cw, ch).data;

        const idx = (startY * cw + startX) * 4;
        const tr = imgData[idx], tg = imgData[idx + 1], tb = imgData[idx + 2], ta = imgData[idx + 3];

        const colorMatch = (i) => {
            const dr = Math.abs(imgData[i] - tr);
            const dg = Math.abs(imgData[i + 1] - tg);
            const db = Math.abs(imgData[i + 2] - tb);
            return (dr + dg + db) / 3 <= tolerance;
        };

        if (contiguous) {
            // Flood fill based selection
            const visited = new Uint8Array(cw * ch);
            const stack = [startX + startY * cw];
            let minX = cw, minY = ch, maxX = 0, maxY = 0;

            while (stack.length > 0) {
                const pos = stack.pop();
                if (visited[pos]) continue;
                visited[pos] = 1;

                const px = pos % cw;
                const py = Math.floor(pos / cw);
                const pi = pos * 4;

                if (!colorMatch(pi)) continue;

                this.mask[pos] = 255;
                minX = Math.min(minX, px);
                minY = Math.min(minY, py);
                maxX = Math.max(maxX, px);
                maxY = Math.max(maxY, py);

                if (px > 0) stack.push(pos - 1);
                if (px < cw - 1) stack.push(pos + 1);
                if (py > 0) stack.push(pos - cw);
                if (py < ch - 1) stack.push(pos + cw);
            }
            this.bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        } else {
            // Select all matching colors
            let minX = cw, minY = ch, maxX = 0, maxY = 0;
            for (let i = 0; i < cw * ch; i++) {
                if (colorMatch(i * 4)) {
                    this.mask[i] = 255;
                    const px = i % cw;
                    const py = Math.floor(i / cw);
                    minX = Math.min(minX, px);
                    minY = Math.min(minY, py);
                    maxX = Math.max(maxX, px);
                    maxY = Math.max(maxY, py);
                }
            }
            this.bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        }

        this.active = true;
        this.drawMarchingAnts();
    },

    // Invert selection
    invert() {
        if (!this.mask) return;
        for (let i = 0; i < this.mask.length; i++) {
            this.mask[i] = 255 - this.mask[i];
        }
        this.drawMarchingAnts();
    },

    // Select all
    selectAll() {
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        this.mask = new Uint8Array(cw * ch).fill(255);
        this.bounds = { x: 0, y: 0, w: cw, h: ch };
        this.active = true;
        this.drawMarchingAnts();
    },

    applyFeather(radius) {
        // Simple box blur on mask
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        const temp = new Float32Array(cw * ch);

        for (let pass = 0; pass < radius; pass++) {
            // Horizontal pass
            for (let y = 0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                    let sum = 0, count = 0;
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        if (nx >= 0 && nx < cw) {
                            sum += this.mask[y * cw + nx];
                            count++;
                        }
                    }
                    temp[y * cw + x] = sum / count;
                }
            }
            for (let i = 0; i < temp.length; i++) this.mask[i] = temp[i];

            // Vertical pass
            for (let y = 0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                    let sum = 0, count = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        const ny = y + dy;
                        if (ny >= 0 && ny < ch) {
                            sum += this.mask[ny * cw + x];
                            count++;
                        }
                    }
                    temp[y * cw + x] = sum / count;
                }
            }
            for (let i = 0; i < temp.length; i++) this.mask[i] = Math.round(temp[i]);
        }
    },

    // Delete selected pixels from active layer
    deleteSelected() {
        if (!this.active || !this.mask) return;
        const layer = Layers.getActive();
        const cw = Layers.canvasWidth;
        const imgData = layer.ctx.getImageData(0, 0, cw, Layers.canvasHeight);

        for (let i = 0; i < this.mask.length; i++) {
            if (this.mask[i] > 0) {
                const pi = i * 4;
                const factor = this.mask[i] / 255;
                imgData.data[pi + 3] = Math.round(imgData.data[pi + 3] * (1 - factor));
            }
        }

        layer.ctx.putImageData(imgData, 0, 0);
        Layers.render();
    },

    // Draw marching ants animation
    drawMarchingAnts() {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);

        const animate = () => {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            if (!this.active || !this.mask) return;

            // Draw selection outline
            const cw = Layers.canvasWidth;
            const ch = Layers.canvasHeight;

            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.lineDashOffset = -this.offset;

            // Find edge pixels and draw path
            const tmpCanvas = Utils.createCanvas(cw, ch);
            const tmpCtx = tmpCanvas.getContext('2d');
            const imgData = tmpCtx.createImageData(cw, ch);
            for (let i = 0; i < this.mask.length; i++) {
                if (this.mask[i] > 128) {
                    imgData.data[i * 4 + 3] = 255;
                }
            }
            tmpCtx.putImageData(imgData, 0, 0);

            // Draw the selection as a path using canvas tracing
            this.ctx.save();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.lineDashOffset = -this.offset;
            this.ctx.drawImage(tmpCanvas, 0, 0);
            this.ctx.globalCompositeOperation = 'source-in';
            this.ctx.clearRect(0, 0, cw, ch);
            this.ctx.restore();

            // Simple outline approach
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Draw border of mask
            for (let y = 0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                    const idx = y * cw + x;
                    if (this.mask[idx] > 128) {
                        // Check if it's a border pixel
                        const isEdge =
                            (x === 0 || this.mask[idx - 1] <= 128) ||
                            (x === cw - 1 || this.mask[idx + 1] <= 128) ||
                            (y === 0 || this.mask[idx - cw] <= 128) ||
                            (y === ch - 1 || this.mask[idx + cw] <= 128);

                        if (isEdge) {
                            const phase = ((x + y + Math.floor(this.offset)) % 8);
                            this.ctx.fillStyle = phase < 4 ? '#000' : '#fff';
                            this.ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }
            }

            this.offset = (this.offset + 0.5) % 8;
            this.animFrame = requestAnimationFrame(animate);
        };

        animate();
    },

    // Check if a point is within selection
    isSelected(x, y) {
        if (!this.active || !this.mask) return true;
        const idx = Math.floor(y) * Layers.canvasWidth + Math.floor(x);
        return this.mask[idx] > 0;
    },

    // Get mask value at point
    getMaskValue(x, y) {
        if (!this.active || !this.mask) return 255;
        const idx = Math.floor(y) * Layers.canvasWidth + Math.floor(x);
        return this.mask[idx] || 0;
    }
};
