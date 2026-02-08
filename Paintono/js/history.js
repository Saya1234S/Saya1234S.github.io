// ========================================
// PAINTONO - History (Undo/Redo) System
// ========================================

const History = {
    stack: [],
    index: -1,
    maxSize: 50,

    init() {
        this.stack = [];
        this.index = -1;
    },

    // Save a snapshot of all layers
    push(actionName) {
        // Remove any future states
        if (this.index < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.index + 1);
        }

        // Capture current state
        const state = {
            name: actionName || 'Action',
            layers: Layers.serialize(),
            activeIndex: Layers.activeIndex,
            timestamp: Date.now()
        };

        this.stack.push(state);

        // Limit size
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        } else {
            this.index++;
        }

        this.updateUI();
    },

    undo() {
        if (this.index <= 0) return;
        this.index--;
        this.restore(this.stack[this.index]);
        this.updateUI();
    },

    redo() {
        if (this.index >= this.stack.length - 1) return;
        this.index++;
        this.restore(this.stack[this.index]);
        this.updateUI();
    },

    restore(state) {
        Layers.deserialize(state.layers);
        Layers.activeIndex = state.activeIndex;
        Layers.render();
        Layers.updateUI();
    },

    updateUI() {
        const list = document.getElementById('history-list');
        list.innerHTML = '';
        this.stack.forEach((state, i) => {
            const el = document.createElement('div');
            el.className = 'history-item';
            if (i === this.index) el.classList.add('current');
            if (i > this.index) el.classList.add('future');
            el.textContent = state.name;
            el.addEventListener('click', () => {
                this.index = i;
                this.restore(state);
                this.updateUI();
            });
            list.appendChild(el);
        });
        list.scrollTop = list.scrollHeight;
    }
};
