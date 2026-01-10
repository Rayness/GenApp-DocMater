const UI = {
    init: function() {
        // === ГЛОБАЛЬНЫЕ СЛУШАТЕЛИ ===
        const gKeys = ['globalFont', 'globalSize', 'globalColor', 'globalShake', 'globalInk', 'globalKern', 'globalSizeVar'];
        gKeys.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.oninput = () => this.updateGlobalState();
                el.onchange = () => this.updateGlobalState();
            }
        });

        // === ЛОКАЛЬНЫЕ СЛУШАТЕЛИ (Toolbar) ===
        const lCol = document.getElementById('localColumn');
        lCol.onchange = () => {
            const z = State.getActiveZone();
            if (z) {
                z.settings.column = lCol.value;
                z.element.querySelector('.zone-label').innerText = lCol.value;
            }
        };

        // Кнопка настроек в тулбаре
        document.getElementById('btnToggleSettings').onclick = () => {
            const setDiv = document.getElementById('localSettings');
            const isHidden = setDiv.style.display === 'none';
            setDiv.style.display = isHidden ? 'block' : 'none';
            this.updateToolbarPosition();
        };

        // Локальные инпуты
        document.getElementById('localFont').onchange = (e) => this.updateLocal('font', e.target.value || null);
        document.getElementById('localSize').oninput = (e) => this.updateLocal('size', parseInt(e.target.value) || null);
        document.getElementById('localShiftX').oninput = (e) => this.updateLocal('shiftX', parseInt(e.target.value));
        document.getElementById('localShiftY').oninput = (e) => this.updateLocal('shiftY', parseInt(e.target.value));

        // Кнопки
        document.getElementById('btnDeleteZone').onclick = () => {
            if(State.activeZoneId) {
                State.removeZone(State.activeZoneId);
                this.deselectAll();
            }
        };
        
        // Генерация и Превью
        document.getElementById('btnGen').onclick = () => this.startGeneration();
        document.getElementById('btnPreview').onclick = () => this.showDocPreview();
        document.getElementById('btnCloseModal').onclick = () => document.getElementById('previewModal').style.display = 'none';

        // IO
        document.getElementById('btnImg').onclick = () => API.selectImage();
        document.getElementById('btnXls').onclick = () => API.selectExcel();
        document.getElementById('btnSave').onclick = () => this.saveProject();
        document.getElementById('btnLoad').onclick = () => this.loadProject();
    },

    updateLocal: function(key, val) {
        const z = State.getActiveZone();
        if(z) z.settings[key] = val;
    },

    // === GLOBAL STATE UPDATE ===
    updateGlobalState: function() {
        State.globalConfig.font = document.getElementById('globalFont').value;
        State.globalConfig.size = parseInt(document.getElementById('globalSize').value) || 50;
        State.globalConfig.color = document.getElementById('globalColor').value;
        State.globalConfig.shakiness = parseInt(document.getElementById('globalShake').value);
        State.globalConfig.ink = parseInt(document.getElementById('globalInk').value);
        State.globalConfig.kerning = parseInt(document.getElementById('globalKern').value);
        State.globalConfig.sizeVar = parseInt(document.getElementById('globalSizeVar').value);

        // Update Text Spans
        document.getElementById('valShake').innerText = State.globalConfig.shakiness;
        document.getElementById('valInk').innerText = State.globalConfig.ink;
        document.getElementById('valKern').innerText = State.globalConfig.kerning;
        document.getElementById('valSizeVar').innerText = State.globalConfig.sizeVar;

        this.requestGlobalSample();
    },

    requestGlobalSample: function() {
        if (State.previewTimeout) clearTimeout(State.previewTimeout);
        
        // document.getElementById('samplePlaceholder').innerText = "...";
        
        State.previewTimeout = setTimeout(async () => {
            const res = await API.getSample(State.globalConfig);
            if (res) {
                const img = document.getElementById('fontSamplePreview');
                img.src = res;
                img.style.display = 'block';
                document.getElementById('samplePlaceholder').style.display = 'none';
            }
        }, 200);
    },

    // === DROPDOWNS ===
    updateFontSelects: function() {
        const fill = (id, hasRandom) => {
            const sel = document.getElementById(id);
            const old = sel.value;
            sel.innerHTML = '';
            if (hasRandom) {
                sel.add(new Option("🎲 Один случайный на документ", "random_per_doc"));
                sel.add(new Option("🎲 Разные для каждого поля", "random"));
            } else {
                sel.add(new Option("🌐 Глобальный шрифт", ""));
            }
            State.availableFonts.forEach(f => sel.add(new Option(f, f)));
            if(old) sel.value = old;
        };
        fill('globalFont', true);
        fill('localFont', false);
    },

    updateColumnSelects: function() {
        const sel = document.getElementById('localColumn');
        sel.innerHTML = '';
        if (State.excelColumns.length === 0) {
            sel.add(new Option("Нет данных", ""));
            return;
        }
        State.excelColumns.forEach(c => sel.add(new Option(c, c)));
        
        // Если зона активна, вернуть её значение
        const z = State.getActiveZone();
        if (z) sel.value = z.settings.column;
    },

    // === TOOLBAR ===
    showToolbar: function(zone) {
        const tb = document.getElementById('floatingToolbar');
        tb.style.display = 'flex';
        
        // Синхронизация значений
        if (State.excelColumns.length > 0) {
            document.getElementById('localColumn').value = zone.settings.column;
        }
        document.getElementById('localFont').value = zone.settings.font || "";
        document.getElementById('localSize').value = zone.settings.size || "";
        document.getElementById('localShiftX').value = zone.settings.shiftX;
        document.getElementById('localShiftY').value = zone.settings.shiftY;

        this.updateToolbarPosition();
    },

    hideToolbar: function() {
        document.getElementById('floatingToolbar').style.display = 'none';
        document.getElementById('localSettings').style.display = 'none';
    },

    updateToolbarPosition: function() {
        const z = State.getActiveZone();
        if (!z) return;
        const tb = document.getElementById('floatingToolbar');
        tb.style.left = z.element.style.left;
        tb.style.top = (parseInt(z.element.style.top) + parseInt(z.element.style.height) + 8) + 'px';
    },

    selectZone: function(id) {
        State.activeZoneId = id;
        State.zones.forEach(z => z.element.classList.remove('selected'));
        const z = State.getZoneById(id);
        if (z) {
            z.element.classList.add('selected');
            this.showToolbar(z);
        }
    },

    deselectAll: function() {
        State.activeZoneId = null;
        State.zones.forEach(z => z.element.classList.remove('selected'));
        this.hideToolbar();
        document.getElementById('contextMenu').style.display = 'none';
    },

    // === GENERATION ===
    getConfigJSON: function() {
        const img = document.getElementById('docImage');
        const factor = img.naturalWidth / img.clientWidth;
        this.updateGlobalState();

        const zonesConfig = State.zones.map(z => ({
            column: z.settings.column,
            font: z.settings.font, size: z.settings.size,
            shiftX: z.settings.shiftX, shiftY: z.settings.shiftY,
            x: parseInt(z.element.style.left) * factor,
            y: parseInt(z.element.style.top) * factor,
            width: parseInt(z.element.style.width) * factor,
            height: parseInt(z.element.style.height) * factor
        }));

        return JSON.stringify({ globals: State.globalConfig, zones: zonesConfig });
    },

    showDocPreview: async function() {
        if(State.zones.length === 0) return alert("Нет зон!");
        const res = await API.getPreview(this.getConfigJSON());
        if(res.data) {
            document.getElementById('previewImg').src = res.data;
            document.getElementById('previewModal').style.display = 'flex';
        } else {
            alert(res.error);
        }
    },

    startGeneration: function() {
        if(State.zones.length === 0) return alert("Нет зон!");
        document.getElementById('progressContainer').style.display = 'block';
        API.generate(this.getConfigJSON());
    },

    // Callbacks from Python
    updateProgress: function(c, t) {
        const pct = (c/t)*100;
        document.getElementById('progressBar').style.width = pct + "%";
        document.getElementById('progVal').innerText = `${c} / ${t}`;
    },

    finishGen: function(msg) {
        alert(msg);
        document.getElementById('progressContainer').style.display = 'none';
    },

    // === SAVE / LOAD ===
    saveProject: async function() {
        this.updateGlobalState();
        const zonesDump = State.zones.map(z => ({
            style: { left: z.element.style.left, top: z.element.style.top, width: z.element.style.width, height: z.element.style.height },
            settings: z.settings
        }));
        const project = {
            image: State.currentImagePath, excel: State.currentExcelPath,
            globals: State.globalConfig, zones: zonesDump
        };
        await API.save(JSON.stringify(project));
    },

    loadProject: async function() {
        const res = await API.load();
        if(!res || res.error) return;

        this.deselectAll();
        State.zones.forEach(z => z.element.remove());
        State.zones = [];

        if(res.excel) {
            State.currentExcelPath = res.excel.path;
            State.excelColumns = res.excel.columns;
            document.getElementById('fileStatus').innerText = "Excel загружен";
            document.getElementById('genBtn').disabled = false;
            this.updateColumnSelects();
        }

        if(res.image) {
            State.currentImagePath = res.image.path;
            document.getElementById('docImage').src = res.image.data;
            document.getElementById('fileStatus').innerText = "Бланк загружен";
        }

        if(res.globals) {
            // Restore globals
            State.globalConfig = res.globals;
            document.getElementById('globalFont').value = res.globals.font;
            document.getElementById('globalSize').value = res.globals.size;
            document.getElementById('globalColor').value = res.globals.color;
            document.getElementById('globalShake').value = res.globals.shakiness;
            document.getElementById('globalInk').value = res.globals.ink;
            document.getElementById('globalKern').value = res.globals.kerning;
            if(res.globals.sizeVar) document.getElementById('globalSizeVar').value = res.globals.sizeVar;
            this.updateGlobalState();
        }

        if(res.zones) {
            res.zones.forEach(zData => {
                const el = document.createElement('div');
                el.className = 'zone';
                el.style.left = zData.style.left; el.style.top = zData.style.top;
                el.style.width = zData.style.width; el.style.height = zData.style.height;
                document.getElementById('canvasArea').appendChild(el);
                Canvas.registerZone(el, zData.settings);
            });
        }
    }
};

// Global Helpers
window.updateProgress = UI.updateProgress;
window.finishGeneration = UI.finishGen;