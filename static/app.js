// === GLOBAL STATE ===
let excelColumns = [];
let availableFonts = [];
let zones = []; 
let activeZoneId = null;

// Zoom & Pan
let scale = 1;
let panX = 0, panY = 0;
let isPanning = false;
let startPanX = 0, startPanY = 0;
let sourceMode = 'single';
let currentUiScale = 1;

// Drawing
let isDrawing = false;
let startDrawX, startDrawY, tempZone;

// Files
let currentImagePath = ""; 
let currentExcelPath = ""; 

// Settings
let globalSettings = {
    seed: 'default',
    font: 'random_per_doc',
    size: {min: 18, max: 24}, 
    color: '#1414A0',
    fonts_config: {},
    // Добавили cvar
    color_var: {min: 0, max: 20}, 
    shakiness: {min: 2, max: 3},
    opacity: {min: 7, max: 9},
    blur: {min: 0, max: 0.5},
    slant: {min: -0.5, max: 0.5},
    kerning: {min: 1, max: 3}
};

// === SEED LOGIC ===
function randomizeSeed() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('projectSeed').value = result;
    updateGlobals();
}

function setSourceMode(mode) {
    sourceMode = mode;
    
    // Визуал переключателя
    document.getElementById('modeSingle').className = (mode === 'single') ? 'switch-opt active' : 'switch-opt';
    document.getElementById('modeFolder').className = (mode === 'folder') ? 'switch-opt active' : 'switch-opt';
    
    // Текст кнопки
    const btn = document.getElementById('btnSelectBg');
    if (mode === 'single') btn.innerText = '📄 Выбрать файл';
    else btn.innerText = '📂 Выбрать папку';
}

function selectBackground() {
    if (sourceMode === 'single') {
        window.pywebview.api.pick_image().then(handleBgResponse);
    } else {
        window.pywebview.api.pick_background_folder().then(handleBgResponse);
    }
}

function handleBgResponse(r) {
    if (!r) return;
    if (r.error) return alert(r.error);
    
    // r.mode, r.path/first_path, r.data, r.count
    
    if (r.mode === 'single') {
        currentImagePath = r.path;
        document.getElementById('imgName').innerText = r.path.split(/[\\/]/).pop(); // Только имя файла
    } else {
        currentImagePath = r.first_path;
        document.getElementById('imgName').innerText = `Папка (${r.count} фото)`;
    }
    
    const img = document.getElementById('docImage');

    img.onload = () => {
        updateUiScale();
        resetZoom();
    };
    img.src = r.data;    
        
    // Отображаем (первую) картинку на холсте
    document.getElementById('docImage').src = r.data;
    resetZoom();
}

function openFontManager() {
    const container = document.getElementById('fontListContainer');
    container.innerHTML = '';

    // Если конфиг пустой, считаем что все включены на 5 (средне)
    const currentCfg = globalSettings.fonts_config || {};

    availableFonts.forEach(fontName => {
        // Получаем текущий вес (если нет в конфиге, то 5)
        const weight = (currentCfg[fontName] !== undefined) ? currentCfg[fontName] : 5;

        const row = document.createElement('div');
        row.className = 'font-row';
        row.innerHTML = `
            <input type="checkbox" class="font-check" ${weight > 0 ? 'checked' : ''}>
            <label title="${fontName}">${fontName}</label>
            <input type="range" min="1" max="10" value="${weight > 0 ? weight : 5}" 
                class="font-slider" style="width: 80px; margin-right: 5px;" 
                ${weight === 0 ? 'disabled' : ''}>
            <span class="font-val" style="font-size: 11px; width: 20px; text-align: right;">${weight > 0 ? weight : 0}</span>
        `;

        // Логика внутри строки (чекбокс включает/выключает слайдер)
        const chk = row.querySelector('.font-check');
        const sld = row.querySelector('.font-slider');
        const val = row.querySelector('.font-val');

        // Событие слайдера
        sld.oninput = () => { val.innerText = sld.value; };

        // Событие чекбокса
        chk.onchange = () => {
            sld.disabled = !chk.checked;
            val.innerText = chk.checked ? sld.value : 0;
            // Визуально обесцветить если выключено
            row.style.opacity = chk.checked ? 1 : 0.5;
        };
        
        // Инит состояние
        row.style.opacity = weight > 0 ? 1 : 0.5;

        // Сохраняем имя шрифта в dataset для сборки
        row.dataset.font = fontName;
        
        container.appendChild(row);
    });

    document.getElementById('fontManagerModal').style.display = 'flex';
}

function closeFontManager() {
    document.getElementById('fontManagerModal').style.display = 'none';
}

function saveFontConfig() {
    const rows = document.querySelectorAll('.font-row');
    const newConfig = {};
    
    rows.forEach(row => {
        const fontName = row.dataset.font;
        const chk = row.querySelector('.font-check');
        const sld = row.querySelector('.font-slider');
        
        // Если чекбокс выключен -> вес 0. Если включен -> значение слайдера.
        newConfig[fontName] = chk.checked ? parseInt(sld.value) : 0;
    });

    globalSettings.fonts_config = newConfig;
    
    // Также можно обновить UI (слайдеры) в главном окне, но у нас шрифты скрыты в меню
    closeFontManager();
    // Принудительно дернем обновление, на всякий случай
    updateGlobals(); 
}

function updateUiScale() {
    const img = document.getElementById('docImage');
    if (!img.naturalWidth) return;

    // Базовая ширина, под которую мы верстали (например, 1000px).
    // Если картинка 4000px, скейл будет 4.
    // Math.max(1, ...) значит, что мы не уменьшаем UI для маленьких картинок (меньше 1000px), 
    // чтобы он не стал микроскопическим.
    const factor = Math.max(1, img.naturalWidth / 1000);
    
    currentUiScale = factor;
    
    // Передаем переменную в CSS
    document.getElementById('canvasWrapper').style.setProperty('--ui-scale', factor);
}

// UI Elements
const workspace = document.getElementById('workspace');
const panContainer = document.getElementById('panContainer');
const wrapper = document.getElementById('canvasWrapper');
const toolbar = document.getElementById('floatingToolbar');

const inpLocalCol = document.getElementById('localColumn');
const chkOverride = document.getElementById('localOverride');
const divLocalSet = document.getElementById('localSettings');
const inpLocalFont = document.getElementById('localFont');
const inpLocalSize = document.getElementById('localSize');

// === INIT ===
window.addEventListener('pywebviewready', () => {
    // Добавь 'cvar' в список
    ['size', 'cvar', 'shake', 'opacity', 'blur', 'slant', 'kern'].forEach(id => dualSlide(id, true));
    
    setTimeout(() => {
        window.pywebview.api.get_fonts_list().then(f => {
            availableFonts = f;
            updateGlobalFontSelect();
            updateLocalFontSelect();
        }).catch(()=>{});
    }, 1000);
});

// === 1. DUAL SLIDER LOGIC ===
function dualSlide(prefix, skipUpdateGlobal = false) {
    const minRange = document.getElementById(prefix + 'Min');
    const maxRange = document.getElementById(prefix + 'Max');
    const fill = document.getElementById('fill-' + prefix);
    const disp = document.getElementById('disp-' + prefix);

    let minVal = parseFloat(minRange.value);
    let maxVal = parseFloat(maxRange.value);

    // "Толкание" ползунков
    if (minVal > maxVal) {
        if (document.activeElement === minRange) { maxRange.value = minVal; maxVal = minVal; } 
        else { minRange.value = maxVal; minVal = maxVal; }
    }

    const range = parseFloat(minRange.max) - parseFloat(minRange.min);
    const absMin = parseFloat(minRange.min);
    const leftPercent = ((minVal - absMin) / range) * 100;
    const rightPercent = ((maxVal - absMin) / range) * 100;

    fill.style.left = leftPercent + '%';
    fill.style.width = (rightPercent - leftPercent) + '%';
    disp.innerText = `${minVal} - ${maxVal}`;

    if (!skipUpdateGlobal) updateGlobals();
}

function getRangeValues(prefix) {
    return {
        min: parseFloat(document.getElementById(prefix + 'Min').value),
        max: parseFloat(document.getElementById(prefix + 'Max').value)
    };
}

// === 2. ZOOM & PAN LOGIC ===
function updateTransform() {
    panContainer.style.transform = `translate(${panX}px, ${panY}px)`;
    wrapper.style.transform = `scale(${scale})`;
}

workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; 
    e.preventDefault();
    const zoomSpeed = 0.001;
    scale = Math.max(0.1, Math.min(5, scale - e.deltaY * zoomSpeed));
    updateTransform();
}, { passive: false });

function resetZoom() {
    scale = 1; panX = 50; panY = 50;
    updateTransform();
}

// === 3. CANVAS INTERACTIONS (The Fix) ===

// Глобальный слушатель движения мыши (для Pan и Drawing)
window.addEventListener('mousemove', (e) => {
    // A. Pan Logic
    if (isPanning) {
        panX = e.clientX - startPanX;
        panY = e.clientY - startPanY;
        updateTransform();
        return;
    }
    
    // B. Drawing Logic
    if (isDrawing && tempZone) {
        const rect = wrapper.getBoundingClientRect(); 
        // Координаты мыши внутри scale-нутого элемента
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // В реальные координаты картинки
        const realX = mouseX / scale;
        const realY = mouseY / scale;
        
        const w = Math.abs(realX - startDrawX);
        const h = Math.abs(realY - startDrawY);
        const x = realX < startDrawX ? realX : startDrawX;
        const y = realY < startDrawY ? realY : startDrawY;

        tempZone.style.width = w + 'px';
        tempZone.style.height = h + 'px';
        tempZone.style.left = x + 'px';
        tempZone.style.top = y + 'px';
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; workspace.style.cursor = 'default'; }
    if (isDrawing) {
        isDrawing = false;
        if (tempZone) {
            if (parseInt(tempZone.style.width) > 20 && parseInt(tempZone.style.height) > 20) {
                createZone(tempZone);
            } else { tempZone.remove(); }
            tempZone = null;
        }
    }
});

// ГЛАВНЫЙ ОБРАБОТЧИК КЛИКОВ
// Вешаем на workspace, чтобы ловить всё, но фильтруем
workspace.addEventListener('mousedown', (e) => {
    // 1. Если клик по тулбару - игнор
    if (e.target.closest('#floatingToolbar')) return;
    
    // 2. Если Средняя кнопка или Пробел+Клик -> PAN
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        workspace.style.cursor = 'grabbing';
        e.preventDefault();
        return;
    }

    // 3. Если клик по Зоне или её ручке -> Пусть зона сама разбирается (она имеет свой listener)
    if (e.target.closest('.zone') || e.target.closest('.resize-handle')) {
        return; 
    }

    // 4. Если Левая кнопка и есть картинка -> DRAW
    if (e.button === 0 && document.getElementById('docImage').src) {
        deselectZone();
        isDrawing = true;
        
        const rect = wrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        startDrawX = mouseX / scale;
        startDrawY = mouseY / scale;
        
        tempZone = document.createElement('div');
        tempZone.className = 'zone';
        tempZone.style.left = startDrawX + 'px';
        tempZone.style.top = startDrawY + 'px';
        wrapper.appendChild(tempZone);
        e.preventDefault();
    }
});


// === 4. ZONE LOGIC ===
function createZone(element, initialSettings = null) {
    const id = Date.now() + Math.random();
    
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    element.appendChild(handle);

    const label = document.createElement('div');
    label.className = 'zone-label';
    label.innerText = initialSettings ? initialSettings.column : (excelColumns[0] || "");
    element.appendChild(label);

    // НАСТРОЙКИ ПО УМОЛЧАНИЮ
    const defaults = { 
        sourceType: 'excel', // 'excel' или 'text'
        content: excelColumns[0] || "", // Имя колонки ИЛИ статический текст
        font: null, 
        size: null 
    };

    const settings = initialSettings ? { ...defaults, ...initialSettings } : defaults;

    label.innerText = settings.content; // Показываем контент

    const data = {
        id: id,
        element: element,
        settings: settings
    };
    zones.push(data);

    // MOUSE DOWN ON ZONE (Move)
    element.addEventListener('mousedown', (e) => {
        if(e.button !== 0 || e.altKey) return; // Игнорируем, если это попытка Pan
        
        e.stopPropagation(); // Не даем событию уйти на workspace (чтобы не начать рисовать новую)
        selectZone(id);
        
        if(e.target === handle) return; // Если это ресайз, то ниже сработает другой listener
        
        const startX = parseFloat(element.style.left);
        const startY = parseFloat(element.style.top);
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;

        const move = (ev) => {
            const dx = (ev.clientX - mouseStartX) / scale;
            const dy = (ev.clientY - mouseStartY) / scale;
            element.style.left = (startX + dx) + 'px';
            element.style.top = (startY + dy) + 'px';
            updateToolbarPos();
        };
        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', stop);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
    });

    // MOUSE DOWN ON HANDLE (Resize)
    handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const startW = parseFloat(element.style.width);
        const startH = parseFloat(element.style.height);
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;
        
        const rz = (ev) => {
            const dx = (ev.clientX - mouseStartX) / scale;
            const dy = (ev.clientY - mouseStartY) / scale;
            element.style.width = Math.max(20, startW + dx) + 'px';
            element.style.height = Math.max(20, startH + dy) + 'px';
            updateToolbarPos();
        };
        const stp = () => { window.removeEventListener('mousemove', rz); window.removeEventListener('mouseup', stp); };
        window.addEventListener('mousemove', rz);
        window.addEventListener('mouseup', stp);
    });

    element.addEventListener('mousedown', (e) => {/*...*/});
    handle.addEventListener('mousedown', (e) => {/*...*/});
    selectZone(id);
}

// 2. Новая функция переключения режима в тулбаре
function setZoneMode(mode) {
    if(!activeZoneId) return;
    const z = zones.find(x => x.id === activeZoneId);
    z.settings.sourceType = mode;
    
    updateToolbarUI(z);
}


function selectZone(id) {
    activeZoneId = id;
    zones.forEach(z => z.element.classList.remove('selected'));
    const z = zones.find(x => x.id === id);
    if(!z) return;

    z.element.classList.add('selected');
    toolbar.style.display = 'block';
    
    // Заполняем UI значениями из зоны
    updateToolbarUI(z);

    // Локальные стили (как было)
    const isOverride = (z.settings.font !== null);
    chkOverride.checked = isOverride;
    divLocalSet.style.display = isOverride ? 'block' : 'none';
    if(isOverride) { inpLocalFont.value = z.settings.font; inpLocalSize.value = z.settings.size; }

    updateToolbarPos();
}

function updateToolbarPos() {
    if(!activeZoneId) return;
    const z = zones.find(x => x.id === activeZoneId);
    
    let left = parseFloat(z.element.style.left);
    // Добавляем отступ, умноженный на скейл, чтобы меню не наезжало на рамку
    let top = parseFloat(z.element.style.top) + parseFloat(z.element.style.height) + (10 * currentUiScale);
    
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
}

function updateToolbarUI(z) {
    const mode = z.settings.sourceType || 'excel'; // fallback
    const excelInput = document.getElementById('localColumn');
    const textInput = document.getElementById('localStaticText');
    const btnExcel = document.getElementById('modeExcel');
    const btnText = document.getElementById('modeText');

    // Переключаем видимость инпутов
    if (mode === 'excel') {
        excelInput.style.display = 'block';
        textInput.style.display = 'none';
        btnExcel.classList.add('active');
        btnText.classList.remove('active');
        excelInput.value = z.settings.content; // Выбираем колонку
    } else {
        excelInput.style.display = 'none';
        textInput.style.display = 'block';
        btnExcel.classList.remove('active');
        btnText.classList.add('active');
        textInput.value = z.settings.content; // Пишем текст
    }
}

document.getElementById('localStaticText').oninput = (e) => {
    if(!activeZoneId) return;
    const z = zones.find(x => x.id === activeZoneId);
    z.settings.content = e.target.value; // Сохраняем текст
    z.element.querySelector('.zone-label').innerText = e.target.value;
}

function deselectZone() {
    activeZoneId = null;
    zones.forEach(z => z.element.classList.remove('selected'));
    toolbar.style.display = 'none';
}

function deleteActiveZone() {
    if(!activeZoneId) return;
    const idx = zones.findIndex(x => x.id === activeZoneId);
    if(idx > -1) {
        zones[idx].element.remove();
        zones.splice(idx, 1);
        deselectZone();
    }
}

function duplicateActiveZone() {
    if (!activeZoneId) return;
    const original = zones.find(z => z.id === activeZoneId);
    if (!original) return;

    const newSettings = JSON.parse(JSON.stringify(original.settings));
    const newEl = document.createElement('div');
    newEl.className = 'zone';
    
    newEl.style.width = original.element.style.width;
    newEl.style.height = original.element.style.height;
    
    const currentLeft = parseFloat(original.element.style.left);
    const currentTop = parseFloat(original.element.style.top);
    
    newEl.style.left = (currentLeft + 30) + 'px';
    newEl.style.top = (currentTop + 30) + 'px';

    document.getElementById('canvasWrapper').appendChild(newEl);
    createZone(newEl, newSettings);
}

// === HOTKEYS ===
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Delete') deleteActiveZone();
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D' || e.key === 'в')) {
        e.preventDefault(); duplicateActiveZone();
    }
});


// === UI & API HELPERS ===
function updateGlobals() {
    globalSettings.seed = document.getElementById('projectSeed').value;
    // 1. Простые поля
    globalSettings.font = document.getElementById('globalFont').value;
    globalSettings.color = document.getElementById('globalColor').value;
    
    // 2. Двойные слайдеры (читаем через getRangeValues)
    globalSettings.size = getRangeValues('size');
    globalSettings.shakiness = getRangeValues('shake');
    globalSettings.opacity = getRangeValues('opacity');
    globalSettings.blur = getRangeValues('blur');
    globalSettings.slant = getRangeValues('slant');
    globalSettings.kerning = getRangeValues('kern');
    globalSettings.color_var = getRangeValues('cvar'); // Не забываем новый слайдер цвета!

    // 3. Конфиг шрифтов (fonts_config) обновляется через модальное окно, 
    // поэтому здесь его не трогаем, чтобы не стереть.
}
inpLocalCol.onchange = () => {
    if(!activeZoneId) return;
    const z = zones.find(x => x.id === activeZoneId);
    z.settings.content = inpLocalCol.value; // Сохраняем имя колонки
    z.element.querySelector('.zone-label').innerText = inpLocalCol.value;
};
chkOverride.onchange = () => {
    if(!activeZoneId) return;
    const z = zones.find(x => x.id === activeZoneId);
    divLocalSet.style.display = chkOverride.checked ? 'block' : 'none';
    if(chkOverride.checked) {
        z.settings.font = globalSettings.font === 'random_per_doc' || globalSettings.font === 'random' ? availableFonts[0] : globalSettings.font;
        z.settings.size = globalSettings.size;
        inpLocalFont.value = z.settings.font;
        inpLocalSize.value = z.settings.size;
    } else { z.settings.font = null; z.settings.size = null; }
    updateToolbarPos();
};
inpLocalFont.onchange = () => { if(activeZoneId) zones.find(x=>x.id===activeZoneId).settings.font = inpLocalFont.value; };
inpLocalSize.oninput = () => { if(activeZoneId) zones.find(x=>x.id===activeZoneId).settings.size = parseInt(inpLocalSize.value); };

function updateGlobalFontSelect() {
    const s = document.getElementById('globalFont');
    s.innerHTML = `<option value="random_per_doc">🎲 Случайный (Один на док)</option><option value="random">🎲 Случайный (Разные поля)</option>`;
    availableFonts.forEach(f => s.add(new Option(f, f)));
}
function updateLocalFontSelect() {
    const s = document.getElementById('localFont');
    s.innerHTML = ``;
    availableFonts.forEach(f => s.add(new Option(f, f)));
}
function updateColumnSelects() {
    const fill = (sel) => { sel.innerHTML=''; excelColumns.forEach(c => sel.add(new Option(c, c))); };
    fill(inpLocalCol);
}

function selectImage() { 
    window.pywebview.api.pick_image().then(r => { 
        if(r){ 
            currentImagePath=r.path; document.getElementById('docImage').src = r.data; 
            document.getElementById('imgName').innerText = r.path; resetZoom(); 
        }
    }); 
}
function selectExcel() { 
    window.pywebview.api.pick_excel().then(r => { 
        if(r && r.columns){ 
            currentExcelPath=r.path; excelColumns=r.columns; document.getElementById('xlsName').innerText = r.path; 
            document.getElementById('genBtn').disabled = false; updateColumnSelects(); 
        }
    }); 
}

function getConfig() {
    updateGlobals();
    const zonesConfig = zones.map(z => ({
        sourceType: z.settings.sourceType || 'excel', // Передаем тип
        content: z.settings.content,                  // И контент (имя колонки или сам текст)
        
        font: z.settings.font,
        size: z.settings.size,
        x: parseInt(z.element.style.left),
        y: parseInt(z.element.style.top),
        width: parseInt(z.element.style.width),
        height: parseInt(z.element.style.height)
    }));
    return JSON.stringify({ globals: globalSettings, zones: zonesConfig });
}

function startGen() {
    if(zones.length === 0) return;
    document.getElementById('progressInfo').style.display = 'block';
    window.pywebview.api.generate_docs(getConfig());
}
function stopGen() { window.pywebview.api.stop_generation().then(alert); }

function showPreview() {
    if(zones.length === 0) return alert("Нет зон");
    window.pywebview.api.get_preview(getConfig()).then(res => {
        if(res.data) { document.getElementById('previewImg').src = res.data; document.getElementById('previewModal').style.display = 'flex'; } 
        else alert(res.error);
    });
}

function updateProgress(c,t) { document.getElementById('progressBar').value=c; document.getElementById('progressBar').max=t; document.getElementById('progVal').innerText=`${c}/${t}`; }
function finishGeneration(m) { alert(m); document.getElementById('progressInfo').style.display='none'; }
function closePreview() { document.getElementById('previewModal').style.display='none'; }

function saveProject() { 
    // Сначала читаем актуальное состояние интерфейса
    updateGlobals();

    const data = { 
        image: currentImagePath, 
        excel: currentExcelPath, 
        globals: globalSettings, // Теперь здесь полный набор
        zones: zones.map(z => ({ 
            x: parseFloat(z.element.style.left), 
            y: parseFloat(z.element.style.top),
            w: parseFloat(z.element.style.width), 
            h: parseFloat(z.element.style.height),
            settings: z.settings 
        })) 
    };
    
    // Для отладки можно глянуть в консоль (F12)
    // console.log("Saving:", data); 
    
    window.pywebview.api.save_template(JSON.stringify(data));
}

function loadProject() {
    window.pywebview.api.load_template().then(res => {
        if(!res || res.error) return;

        // === 1. ОЧИСТКА ===
        deselectZone(); 
        zones.forEach(z => z.element.remove()); 
        zones = []; 
        resetZoom();

        // === 2. ЗАГРУЗКА ИСТОЧНИКОВ ===
        if(res.excel) { 
            currentExcelPath = res.excel.path || res.excel; 
            excelColumns = res.excel.columns || []; 
            document.getElementById('xlsName').innerText = currentExcelPath; 
            document.getElementById('genBtn').disabled = false; 
            updateColumnSelects(); 
        }
        
        if(res.image) { 
            const imgPath = (typeof res.image === 'object') ? res.image.path : res.image;
            const imgData = (typeof res.image === 'object') ? res.image.data : null;
            
            // Если в JSON сохранился режим папки (мы пока не сохраняем явно, но путь может намекать)
            // Пока оставим простую логику:
            currentImagePath = imgPath; 
            document.getElementById('imgName').innerText = imgPath;
            
            if (imgData) { 
                const img = document.getElementById('docImage');
                img.onload = () => {
                    updateUiScale();
                    setTimeout(() => { if(res.zones) loadZonesUI(res.zones); }, 100);
                };
                img.src = imgData; 
            }
        }

        // === 3. ЗАГРУЗКА ГЛОБАЛЬНЫХ НАСТРОЕК ===
        if(res.globals) {
            const g = res.globals;
            
            // А. Простые поля
            if (g.font) document.getElementById('globalFont').value = g.font;
            if (g.color) document.getElementById('globalColor').value = g.color;
            if (g.seed) document.getElementById('projectSeed').value = g.seed;
            else document.getElementById('projectSeed').value = 'default';
            
            // Б. Хелпер для двойных слайдеров
            const setDual = (prefix, val) => {
                if (val === undefined || val === null) return; // Защита от отсутствующих полей
                
                let mn = 0, mx = 0;
                
                // Поддержка старого формата (число)
                if (typeof val === 'number') { 
                    mn = val; mx = val; 
                } 
                // Новый формат ({min, max})
                else { 
                    mn = val.min; mx = val.max; 
                }
                
                const elMin = document.getElementById(prefix + 'Min');
                const elMax = document.getElementById(prefix + 'Max');
                
                if(elMin && elMax) {
                    elMin.value = mn;
                    elMax.value = mx;
                    dualSlide(prefix, true); // true = не вызывать updateGlobals лишний раз
                }
            };

            // В. Применяем ко всем слайдерам
            setDual('size', g.size);
            setDual('shake', g.shakiness);

            if (g.opacity) {
                setDual('opacity', g.opacity);
            } else {
                // Если открываем старый проект, ставим дефолтную плотность
                setDual('opacity', {min: 7, max: 9});
            }
            
            setDual('blur', g.blur);
            setDual('slant', g.slant);
            setDual('kern', g.kerning);
            setDual('cvar', g.color_var); // Вариативность цвета

            // Г. Конфиг весов шрифтов
            if (g.fonts_config) {
                globalSettings.fonts_config = g.fonts_config;
            } else {
                globalSettings.fonts_config = {};
            }

            // Д. Применяем всё в память
            updateGlobals();
        }
    });
}

function loadZonesUI(zonesList) {
    zonesList.forEach(z => {
        const el = document.createElement('div'); el.className = 'zone';
        let tx, ty, tw, th;
        if (z.x !== undefined) { tx = z.x; ty = z.y; tw = z.w; th = z.h; } 
        else if (z.style) { tx = parseFloat(z.style.left); ty = parseFloat(z.style.top); tw = parseFloat(z.style.width); th = parseFloat(z.style.height); }
        el.style.left = tx + 'px'; el.style.top = ty + 'px'; el.style.width = tw + 'px'; el.style.height = th + 'px';
        document.getElementById('canvasWrapper').appendChild(el);
        createZone(el, z.settings);
    });
}