const Canvas = {
    isDrawing: false,
    startX: 0, startY: 0, tempZone: null,

    init: function() {
        const area = document.getElementById('canvasArea');
        const ctxMenu = document.getElementById('contextMenu');

        // Рисование
        area.addEventListener('mousedown', (e) => {
            // Игнор ПКМ и кликов по существующим зонам
            if (e.button === 2) return;
            if (e.target.closest('.zone') || e.target.closest('#floatingToolbar')) return;
            
            if (!document.getElementById('docImage').src) return;

            // Снимаем выделение
            if (window.UI) UI.deselectAll();

            this.isDrawing = true;
            const rect = area.getBoundingClientRect();
            this.startX = e.clientX - rect.left;
            this.startY = e.clientY - rect.top;

            this.tempZone = document.createElement('div');
            this.tempZone.className = 'zone';
            this.tempZone.style.left = this.startX + 'px';
            this.tempZone.style.top = this.startY + 'px';
            area.appendChild(this.tempZone);
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDrawing) return;
            const rect = document.getElementById('canvasArea').getBoundingClientRect();
            const currX = e.clientX - rect.left;
            const currY = e.clientY - rect.top;

            const w = Math.abs(currX - this.startX);
            const h = Math.abs(currY - this.startY);
            const l = currX < this.startX ? currX : this.startX;
            const t = currY < this.startY ? currY : this.startY;

            this.tempZone.style.width = w + 'px';
            this.tempZone.style.height = h + 'px';
            this.tempZone.style.left = l + 'px';
            this.tempZone.style.top = t + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (this.isDrawing) {
                this.isDrawing = false;
                if (parseInt(this.tempZone.style.width) > 20 && parseInt(this.tempZone.style.height) > 20) {
                    this.registerZone(this.tempZone);
                } else {
                    this.tempZone.remove();
                }
                this.tempZone = null;
            }
        });

        // Контекстное меню
        document.addEventListener('click', () => ctxMenu.style.display = 'none');
        document.getElementById('ctxDelete').onclick = () => this.deleteFromContext();
        document.getElementById('ctxDuplicate').onclick = () => this.duplicateFromContext();
    },

    registerZone: function(element, initialSettings = null) {
        const id = Date.now() + Math.random();
        
        // Ручки управления
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        element.appendChild(handle);

        const label = document.createElement('div');
        label.className = 'zone-label';
        // Если Excel загружен, берем 1-ю колонку
        const defCol = State.excelColumns.length > 0 ? State.excelColumns[0] : "";
        label.innerText = initialSettings ? initialSettings.column : defCol;
        element.appendChild(label);

        const data = {
            id: id,
            element: element,
            settings: initialSettings || {
                column: defCol,
                font: null, size: null,
                shiftX: 5, shiftY: 0
            }
        };
        State.zones.push(data);

        // --- СОБЫТИЯ ЗОНЫ ---
        
        // Выбор (ЛКМ)
        element.addEventListener('mousedown', (e) => {
            if (e.button === 2) return;
            e.stopPropagation();
            if (window.UI) UI.selectZone(id);
            
            if (e.target === handle) return; 

            // Drag Logic
            const area = document.getElementById('canvasArea');
            const offX = e.clientX - area.getBoundingClientRect().left - element.offsetLeft;
            const offY = e.clientY - area.getBoundingClientRect().top - element.offsetTop;

            const move = (ev) => {
                const rect = area.getBoundingClientRect();
                element.style.left = (ev.clientX - rect.left - offX) + 'px';
                element.style.top = (ev.clientY - rect.top - offY) + 'px';
                if (window.UI) UI.updateToolbarPosition();
            };
            const stop = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', stop);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', stop);
        });

        // Resize
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const sW = parseInt(element.style.width);
            const sH = parseInt(element.style.height);
            const sX = e.clientX;
            const sY = e.clientY;
            
            const resize = (ev) => {
                element.style.width = (sW + ev.clientX - sX) + 'px';
                element.style.height = (sH + ev.clientY - sY) + 'px';
                if (window.UI) UI.updateToolbarPosition();
            };
            const stop = () => {
                window.removeEventListener('mousemove', resize);
                window.removeEventListener('mouseup', stop);
            };
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stop);
        });

        // Контекстное меню (ПКМ)
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            State.contextZoneId = id;
            if (window.UI) UI.selectZone(id);
            
            const menu = document.getElementById('contextMenu');
            menu.style.display = 'block';
            menu.style.left = e.pageX + 'px';
            menu.style.top = e.pageY + 'px';
        });

        if (window.UI) UI.selectZone(id);
    },

    deleteFromContext: function() {
        if (State.contextZoneId) {
            State.removeZone(State.contextZoneId);
            State.contextZoneId = null;
            if (window.UI) UI.deselectAll();
        }
    },

    // === ИСПРАВЛЕННОЕ КОПИРОВАНИЕ ===
    duplicateFromContext: function() {
        if (State.contextZoneId) {
            const original = State.getZoneById(State.contextZoneId);
            if (original) {
                const newElem = document.createElement('div');
                newElem.className = 'zone';
                
                // Сдвиг копии
                const l = parseInt(original.element.style.left);
                const t = parseInt(original.element.style.top);
                newElem.style.left = (l + 20) + 'px';
                newElem.style.top = (t + 20) + 'px';
                newElem.style.width = original.element.style.width;
                newElem.style.height = original.element.style.height;
                
                // Добавляем в правильный контейнер
                document.getElementById('canvasArea').appendChild(newElem);
                
                // Глубокая копия настроек
                const newSettings = JSON.parse(JSON.stringify(original.settings));
                
                this.registerZone(newElem, newSettings);
            }
            State.contextZoneId = null;
        }
    }
};