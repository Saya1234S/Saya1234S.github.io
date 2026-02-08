// ========================================
// PAINTONO - Symmetry System
// ========================================

const Symmetry = {
    mode: 'none', // none, horizontal, vertical, both, radial
    segments: 6,

    init() {
        const modeSelect = document.getElementById('symmetry-mode');
        const segSlider = document.getElementById('symmetry-segments');
        const segVal = document.getElementById('symmetry-segments-val');
        const radialLabel = document.getElementById('radial-count-label');

        modeSelect.addEventListener('change', () => {
            this.mode = modeSelect.value;
            radialLabel.style.display = this.mode === 'radial' ? '' : 'none';
        });

        segSlider.addEventListener('input', () => {
            this.segments = parseInt(segSlider.value);
            segVal.textContent = this.segments;
        });
    },

    // Get mirrored points for a given position
    getPoints(x, y) {
        const cx = Layers.canvasWidth / 2;
        const cy = Layers.canvasHeight / 2;
        const points = [{ x, y }];

        switch (this.mode) {
            case 'horizontal':
                points.push({ x: 2 * cx - x, y });
                break;
            case 'vertical':
                points.push({ x, y: 2 * cy - y });
                break;
            case 'both':
                points.push({ x: 2 * cx - x, y });
                points.push({ x, y: 2 * cy - y });
                points.push({ x: 2 * cx - x, y: 2 * cy - y });
                break;
            case 'radial':
                const angle = Math.atan2(y - cy, x - cx);
                const dist = Utils.dist(cx, cy, x, y);
                for (let i = 1; i < this.segments; i++) {
                    const a = angle + (2 * Math.PI * i) / this.segments;
                    points.push({
                        x: cx + Math.cos(a) * dist,
                        y: cy + Math.sin(a) * dist
                    });
                }
                break;
        }

        return points;
    },

    // Draw symmetry guide on overlay
    drawGuide(overlayCtx) {
        if (this.mode === 'none') return;

        const w = Layers.canvasWidth;
        const h = Layers.canvasHeight;
        const cx = w / 2;
        const cy = h / 2;

        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(0, 120, 212, 0.5)';
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([6, 4]);

        switch (this.mode) {
            case 'horizontal':
                overlayCtx.beginPath();
                overlayCtx.moveTo(cx, 0);
                overlayCtx.lineTo(cx, h);
                overlayCtx.stroke();
                break;
            case 'vertical':
                overlayCtx.beginPath();
                overlayCtx.moveTo(0, cy);
                overlayCtx.lineTo(w, cy);
                overlayCtx.stroke();
                break;
            case 'both':
                overlayCtx.beginPath();
                overlayCtx.moveTo(cx, 0);
                overlayCtx.lineTo(cx, h);
                overlayCtx.moveTo(0, cy);
                overlayCtx.lineTo(w, cy);
                overlayCtx.stroke();
                break;
            case 'radial':
                for (let i = 0; i < this.segments; i++) {
                    const angle = (2 * Math.PI * i) / this.segments;
                    overlayCtx.beginPath();
                    overlayCtx.moveTo(cx, cy);
                    overlayCtx.lineTo(cx + Math.cos(angle) * Math.max(w, h), cy + Math.sin(angle) * Math.max(w, h));
                    overlayCtx.stroke();
                }
                break;
        }

        overlayCtx.restore();
    }
};
