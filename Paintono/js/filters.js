// ========================================
// PAINTONO - Filters & Adjustments
// ========================================

const Filters = {
    // Apply filter to active layer
    applyToActive(filterFn) {
        const layer = Layers.getActive();
        const cw = Layers.canvasWidth;
        const ch = Layers.canvasHeight;
        const imgData = layer.ctx.getImageData(0, 0, cw, ch);

        // If selection active, only apply to selected area
        const result = filterFn(imgData, cw, ch);

        if (Selection.active && Selection.mask) {
            const original = layer.ctx.getImageData(0, 0, cw, ch);
            for (let i = 0; i < Selection.mask.length; i++) {
                const factor = Selection.mask[i] / 255;
                const pi = i * 4;
                result.data[pi] = Math.round(original.data[pi] * (1 - factor) + result.data[pi] * factor);
                result.data[pi+1] = Math.round(original.data[pi+1] * (1 - factor) + result.data[pi+1] * factor);
                result.data[pi+2] = Math.round(original.data[pi+2] * (1 - factor) + result.data[pi+2] * factor);
                result.data[pi+3] = Math.round(original.data[pi+3] * (1 - factor) + result.data[pi+3] * factor);
            }
        }

        layer.ctx.putImageData(result, 0, 0);
        Layers.render();
    },

    // ---- Blur Filters ----
    gaussianBlur(imgData, w, h, radius) {
        const data = new Uint8ClampedArray(imgData.data);
        const result = new ImageData(new Uint8ClampedArray(data), w, h);
        const kernel = this.makeGaussianKernel(radius);
        const kSize = kernel.length;
        const half = Math.floor(kSize / 2);

        // Horizontal pass
        const temp = new Uint8ClampedArray(data.length);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let r = 0, g = 0, b = 0, a = 0, wt = 0;
                for (let k = 0; k < kSize; k++) {
                    const nx = Utils.clamp(x + k - half, 0, w - 1);
                    const idx = (y * w + nx) * 4;
                    const weight = kernel[k];
                    r += data[idx] * weight;
                    g += data[idx+1] * weight;
                    b += data[idx+2] * weight;
                    a += data[idx+3] * weight;
                    wt += weight;
                }
                const oi = (y * w + x) * 4;
                temp[oi] = r / wt;
                temp[oi+1] = g / wt;
                temp[oi+2] = b / wt;
                temp[oi+3] = a / wt;
            }
        }

        // Vertical pass
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let r = 0, g = 0, b = 0, a = 0, wt = 0;
                for (let k = 0; k < kSize; k++) {
                    const ny = Utils.clamp(y + k - half, 0, h - 1);
                    const idx = (ny * w + x) * 4;
                    const weight = kernel[k];
                    r += temp[idx] * weight;
                    g += temp[idx+1] * weight;
                    b += temp[idx+2] * weight;
                    a += temp[idx+3] * weight;
                    wt += weight;
                }
                const oi = (y * w + x) * 4;
                result.data[oi] = r / wt;
                result.data[oi+1] = g / wt;
                result.data[oi+2] = b / wt;
                result.data[oi+3] = a / wt;
            }
        }

        return result;
    },

    makeGaussianKernel(radius) {
        const size = radius * 2 + 1;
        const kernel = new Float32Array(size);
        const sigma = radius / 3;
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        for (let i = 0; i < size; i++) kernel[i] /= sum;
        return kernel;
    },

    boxBlur(imgData, w, h, radius) {
        const data = new Uint8ClampedArray(imgData.data);
        const result = new ImageData(new Uint8ClampedArray(data.length), w, h);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let r = 0, g = 0, b = 0, a = 0, count = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = Utils.clamp(x + dx, 0, w - 1);
                        const ny = Utils.clamp(y + dy, 0, h - 1);
                        const idx = (ny * w + nx) * 4;
                        r += data[idx]; g += data[idx+1]; b += data[idx+2]; a += data[idx+3];
                        count++;
                    }
                }
                const oi = (y * w + x) * 4;
                result.data[oi] = r / count;
                result.data[oi+1] = g / count;
                result.data[oi+2] = b / count;
                result.data[oi+3] = a / count;
            }
        }

        return result;
    },

    // ---- Sharpen ----
    sharpen(imgData, w, h, amount) {
        const data = imgData.data;
        const result = new ImageData(new Uint8ClampedArray(data.length), w, h);
        // Unsharp mask: sharpen = original + amount * (original - blurred)
        const blurred = this.gaussianBlur(imgData, w, h, 1);

        for (let i = 0; i < data.length; i += 4) {
            result.data[i] = Utils.clamp(data[i] + amount * (data[i] - blurred.data[i]), 0, 255);
            result.data[i+1] = Utils.clamp(data[i+1] + amount * (data[i+1] - blurred.data[i+1]), 0, 255);
            result.data[i+2] = Utils.clamp(data[i+2] + amount * (data[i+2] - blurred.data[i+2]), 0, 255);
            result.data[i+3] = data[i+3];
        }
        return result;
    },

    // ---- Noise ----
    addNoise(imgData, w, h, amount) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const noise = (Math.random() - 0.5) * amount;
            result.data[i] = Utils.clamp(result.data[i] + noise, 0, 255);
            result.data[i+1] = Utils.clamp(result.data[i+1] + noise, 0, 255);
            result.data[i+2] = Utils.clamp(result.data[i+2] + noise, 0, 255);
        }
        return result;
    },

    // ---- Color Adjustments ----
    brightnessContrast(imgData, w, h, brightness, contrast) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] = Utils.clamp(factor * (result.data[i] - 128) + 128 + brightness, 0, 255);
            result.data[i+1] = Utils.clamp(factor * (result.data[i+1] - 128) + 128 + brightness, 0, 255);
            result.data[i+2] = Utils.clamp(factor * (result.data[i+2] - 128) + 128 + brightness, 0, 255);
        }
        return result;
    },

    hueSaturation(imgData, w, h, hueShift, satMult, lightness) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);

        for (let i = 0; i < result.data.length; i += 4) {
            const hsv = ColorSystem.rgbToHsv(result.data[i], result.data[i+1], result.data[i+2]);
            hsv.h = (hsv.h + hueShift + 360) % 360;
            hsv.s = Utils.clamp(hsv.s * (satMult / 100), 0, 100);
            hsv.v = Utils.clamp(hsv.v + lightness, 0, 100);
            const rgb = ColorSystem.hsvToRgb(hsv.h, hsv.s, hsv.v);
            result.data[i] = rgb.r;
            result.data[i+1] = rgb.g;
            result.data[i+2] = rgb.b;
        }
        return result;
    },

    colorBalance(imgData, w, h, redShift, greenShift, blueShift) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] = Utils.clamp(result.data[i] + redShift, 0, 255);
            result.data[i+1] = Utils.clamp(result.data[i+1] + greenShift, 0, 255);
            result.data[i+2] = Utils.clamp(result.data[i+2] + blueShift, 0, 255);
        }
        return result;
    },

    levels(imgData, w, h, inputMin, inputMax, outputMin, outputMax) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        const range = inputMax - inputMin || 1;
        const outRange = outputMax - outputMin;

        for (let i = 0; i < result.data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                let val = (result.data[i + c] - inputMin) / range;
                val = Utils.clamp(val, 0, 1);
                result.data[i + c] = Math.round(outputMin + val * outRange);
            }
        }
        return result;
    },

    curves(imgData, w, h, curvePoints) {
        // Build LUT from curve points
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = i;
        }

        if (curvePoints && curvePoints.length >= 2) {
            // Sort points by x
            curvePoints.sort((a, b) => a.x - b.x);

            // Linear interpolation between points
            for (let i = 0; i < 256; i++) {
                const x = i / 255;
                let y = x;

                // Find surrounding points
                for (let j = 0; j < curvePoints.length - 1; j++) {
                    if (x >= curvePoints[j].x && x <= curvePoints[j+1].x) {
                        const t = (x - curvePoints[j].x) / (curvePoints[j+1].x - curvePoints[j].x || 1);
                        y = curvePoints[j].y + t * (curvePoints[j+1].y - curvePoints[j].y);
                        break;
                    }
                }
                lut[i] = Utils.clamp(Math.round(y * 255), 0, 255);
            }
        }

        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] = lut[result.data[i]];
            result.data[i+1] = lut[result.data[i+1]];
            result.data[i+2] = lut[result.data[i+2]];
        }
        return result;
    },

    // ---- Effects ----
    invertColors(imgData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] = 255 - result.data[i];
            result.data[i+1] = 255 - result.data[i+1];
            result.data[i+2] = 255 - result.data[i+2];
        }
        return result;
    },

    grayscale(imgData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const gray = Math.round(0.299 * result.data[i] + 0.587 * result.data[i+1] + 0.114 * result.data[i+2]);
            result.data[i] = gray;
            result.data[i+1] = gray;
            result.data[i+2] = gray;
        }
        return result;
    },

    sepia(imgData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const r = result.data[i], g = result.data[i+1], b = result.data[i+2];
            result.data[i] = Utils.clamp(r * 0.393 + g * 0.769 + b * 0.189, 0, 255);
            result.data[i+1] = Utils.clamp(r * 0.349 + g * 0.686 + b * 0.168, 0, 255);
            result.data[i+2] = Utils.clamp(r * 0.272 + g * 0.534 + b * 0.131, 0, 255);
        }
        return result;
    },

    // Gradient map
    gradientMap(imgData, w, h, color1, color2) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const gray = (result.data[i] + result.data[i+1] + result.data[i+2]) / 3 / 255;
            result.data[i] = Math.round(color1.r + gray * (color2.r - color1.r));
            result.data[i+1] = Math.round(color1.g + gray * (color2.g - color1.g));
            result.data[i+2] = Math.round(color1.b + gray * (color2.b - color1.b));
        }
        return result;
    },

    // Chromatic aberration
    chromaticAberration(imgData, w, h, offset) {
        const result = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const oi = (y * w + x) * 4;
                // Shift red channel
                const rx = Utils.clamp(x + offset, 0, w - 1);
                const ri = (y * w + rx) * 4;
                result.data[oi] = imgData.data[ri];
                // Green stays
                result.data[oi+1] = imgData.data[oi+1];
                // Shift blue channel
                const bx = Utils.clamp(x - offset, 0, w - 1);
                const bi = (y * w + bx) * 4;
                result.data[oi+2] = imgData.data[bi+2];
            }
        }
        return result;
    },

    // ---- Dialog system for filters ----
    showFilterDialog(title, controls, applyFn) {
        const dialog = document.getElementById('filter-dialog');
        const titleEl = document.getElementById('filter-dialog-title');
        const body = document.getElementById('filter-dialog-body');

        titleEl.textContent = title;
        body.innerHTML = '';

        const values = {};

        controls.forEach(ctrl => {
            const row = document.createElement('div');
            row.className = 'filter-row';

            const label = document.createElement('label');
            label.textContent = ctrl.label;
            row.appendChild(label);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = ctrl.min;
            slider.max = ctrl.max;
            slider.value = ctrl.default;
            slider.step = ctrl.step || 1;
            row.appendChild(slider);

            const valSpan = document.createElement('span');
            valSpan.textContent = ctrl.default;
            row.appendChild(valSpan);

            values[ctrl.key] = ctrl.default;

            slider.addEventListener('input', () => {
                values[ctrl.key] = parseFloat(slider.value);
                valSpan.textContent = slider.value;
            });

            body.appendChild(row);
        });

        // Show dialog
        document.getElementById('dialog-overlay').classList.remove('hidden');
        dialog.classList.remove('hidden');

        // Apply button
        document.getElementById('filter-apply').onclick = () => {
            applyFn(values);
            History.push(title);
            this.closeDialog();
        };
    },

    closeDialog() {
        document.getElementById('dialog-overlay').classList.add('hidden');
        document.querySelectorAll('.dialog').forEach(d => d.classList.add('hidden'));
    }
};
