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

// Paint tool
let currentTool = 'zone';   // 'zone' | 'paint' | 'eyedrop'
let paintPatches = [];       // [{el, x, y, w, h, color}]
let currentPaintColor = '#ffffff';
let isPaintDrawing = false;
let paintStartX, paintStartY, tempPatch;

// Font type
let fontType = 'handwriting'; // 'handwriting' | 'system'

// Files
let currentImagePath = ""; 
let currentExcelPath = ""; 

// Settings
let globalSettings = {
    seed: 'default',
    fontType: 'handwriting',
    font: 'random_per_doc',
    size: {min: 18, max: 24},
    // #1414A0 был вне охвата CMYK и на бумаге уходил в тусклый грязный оттенок
    color: '#2A3B8F',
    print_dpi: 300,
    output_format: 'png',
    output_pdf: true,
    fonts_config: {},
    // Добавили cvar
    color_var: {min: 0, max: 20}, 
    shakiness: {min: 2, max: 3},
    opacity: {min: 7, max: 9},
    blur: {min: 0, max: 0.5},
    slant: {min: -0.5, max: 0.5},
    kerning: {min: 1, max: 3},
    height_variation: {min: 0, max: 15},  // Вариация высоты букв (%)
    width_variation: {min: 0, max: 10},   // Вариация ширины букв (%)
    distortion: {min: 0, max: 20}         // Деформация букв (0-100)
};

// === SEED LOGIC ===
function randomizeSeed() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('projectSeed').value = result;
    updateGlobals();
}

// === FONT TYPE ===
function setFontType(type) {
    fontType = type;
    globalSettings.fontType = type;

    document.getElementById('fontTypeHandwriting').className = (type === 'handwriting') ? 'switch-opt active' : 'switch-opt';
    document.getElementById('fontTypeSystem').className       = (type === 'system')      ? 'switch-opt active' : 'switch-opt';

    // Show/hide physics panel and font manager button
    const physicsDetails = document.querySelector('details');
    const btnFM = document.getElementById('btnFontManager');
    if (type === 'system') {
        if (physicsDetails) physicsDetails.style.opacity = '0.4';
        if (physicsDetails) physicsDetails.style.pointerEvents = 'none';
        if (btnFM) btnFM.style.display = 'none';
        loadSystemFonts();
    } else {
        if (physicsDetails) physicsDetails.style.opacity = '';
        if (physicsDetails) physicsDetails.style.pointerEvents = '';
        if (btnFM) btnFM.style.display = '';
        // Restore handwriting fonts
        updateGlobalFontSelect();
        updateLocalFontSelect();
    }
}

function loadSystemFonts() {
    window.pywebview.api.get_system_fonts_list().then(fonts => {
        const gSel = document.getElementById('globalFont');
        const lSel = document.getElementById('localFont');
        const prevG = gSel.value;
        gSel.innerHTML = `<option value="random_per_doc">🎲 Случайный (Один на документ)</option><option value="random">🎲 Случайный (Разные поля)</option>`;
        lSel.innerHTML = '';
        fonts.forEach(f => {
            const name = f.replace(/\.[^/.]+$/, ''); // strip extension for display
            gSel.add(new Option(name, f));
            lSel.add(new Option(name, f));
        });
        if (prevG) gSel.value = prevG;
    }).catch(() => {});
}

// === TOOL SELECTION ===
function setTool(tool) {
    currentTool = tool;
    ['zone', 'paint', 'eyedrop'].forEach(t => {
        const btn = document.getElementById('tool' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) btn.classList.toggle('active', t === tool);
    });
    // Cursor feedback
    const ws = document.getElementById('workspace');
    if (tool === 'eyedrop') ws.style.cursor = 'crosshair';
    else ws.style.cursor = 'default';
}

// === EYEDROPPER ===
function sampleColorAt(e) {
    const img = document.getElementById('docImage');
    if (!img.src || img.src === window.location.href) return;

    const rect = wrapper.getBoundingClientRect();
    const imgX = Math.floor((e.clientX - rect.left) / scale);
    const imgY = Math.floor((e.clientY - rect.top)  / scale);

    const canvas = document.getElementById('eyedropCanvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const px = ctx.getImageData(Math.max(0, imgX), Math.max(0, imgY), 1, 1).data;
    const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');

    currentPaintColor = hex;
    document.getElementById('paintColorPicker').value = hex;

    // Switch to paint tool automatically
    setTool('paint');
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

    // r.mode, r.path/first_path, r.data, r.count, r.dpi

    if (r.dpi) setBgDpi(r.dpi);

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
    initPatchContextMenu();
    ['size', 'cvar', 'shake', 'opacity', 'blur', 'slant', 'kern', 'hvar', 'wvar', 'distort'].forEach(id => dualSlide(id, true));
    
    setTimeout(() => {
        window.pywebview.api.get_fonts_list().then(f => {
            availableFonts = f;
            updateGlobalFontSelect();
            updateLocalFontSelect();
        }).catch(()=>{});

        // Метрики нужны, чтобы посчитать, какой кегль реально вытянет зона
        window.pywebview.api.get_font_metrics().then(m => {
            fontMetrics = m || {};
            dualSlide('size', true);
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

    if (prefix === 'size') updateSizeHint(minVal, maxVal);

    if (!skipUpdateGlobal) updateGlobals();
}

// Размер шрифта задаётся в пикселях фона, поэтому одно и то же число даёт
// разный почерк на разных бланках: 18px на скане 96 dpi — это 4.8 мм (норма),
// а на бланке 300 dpi — уже 1.5 мм, штрих тоньше пикселя и текста просто не видно.
// Поэтому показываем реальную высоту в миллиметрах и предупреждаем о мелком.
let bgDpi = 96;

function setBgDpi(dpi) {
    bgDpi = dpi || 96;
    const el = document.getElementById('bgDpiInfo');
    if (el) el.innerText = `Фон: ${Math.round(bgDpi)} dpi`;
    dualSlide('size', true);
}

// Генератор ужимает шрифт, пока строка не влезет в высоту зоны, поэтому слишком
// низкая зона молча срезает размер — ползунок при этом выглядит нерабочим.
// Отношение высоты строки к кеглю у шрифтов разное (от 1.0 до 1.98), поэтому
// метрики берём из бэкенда и считаем по худшему из реально включённых шрифтов.
let fontMetrics = {};

function activeLineRatio() {
    const names = Object.keys(fontMetrics);
    if (!names.length) return 2.0;   // метрики ещё не пришли — берём худший случай

    // Выбран конкретный шрифт — считаем строго по нему
    const chosen = globalSettings.font;
    if (chosen && chosen !== 'random' && chosen !== 'random_per_doc' && fontMetrics[chosen]) {
        return fontMetrics[chosen];
    }

    const cfg = globalSettings.fonts_config || {};
    const weighted = names.filter(n => cfg[n] > 0);
    const pool = weighted.length ? weighted : names;

    return Math.max(...pool.map(n => fontMetrics[n] || 2.0));
}

function neededZoneHeight(fontSize) {
    return Math.ceil(fontSize * activeLineRatio());
}

function shortZones(fontSize) {
    const need = neededZoneHeight(fontSize);
    return zones.filter(z => parseInt(z.element.style.height) < need);
}

function updateSizeHint(minVal, maxVal) {
    const hint = document.getElementById('sizeHint');
    if (!hint) return;
    const mm = v => (v / bgDpi * 25.4);
    const lo = mm(minVal), hi = mm(maxVal);

    let msg = `≈ ${lo.toFixed(1)}–${hi.toFixed(1)} мм на бумаге`;
    let color = '#2e7d32';

    // Ниже ~3 мм сплошного ядра штриха не остаётся, остаётся одно сглаживание
    if (hi < 3.0) {
        color = '#c62828';
        msg += ' — слишком мелко, почерк будет бледным';
    } else if (hi > 8.0) {
        color = '#c62828';
        msg += ' — слишком крупно';
    }

    const short = shortZones(maxVal);
    const btn = document.getElementById('btnFitZones');
    if (short.length) {
        color = '#c62828';
        msg += ` · ${short.length} зон(ы) ниже ${neededZoneHeight(maxVal)} px — размер в них ужмётся`;
        if (btn) btn.style.display = 'block';
    } else if (btn) {
        btn.style.display = 'none';
    }

    hint.style.color = color;
    hint.innerText = msg;
}

// Растит низкие зоны до высоты, при которой запрошенный кегль реально применится.
// Растим симметрично от центра: генератор центрирует текст в зоне по вертикали,
// поэтому надпись останется на том же месте.
function fitZoneHeights() {
    const maxVal = parseFloat(document.getElementById('sizeMax').value);
    const need = neededZoneHeight(maxVal);
    const short = shortZones(maxVal);
    if (!short.length) return;

    short.forEach(z => {
        const el = z.element;
        const h = parseInt(el.style.height);
        const top = parseInt(el.style.top);
        el.style.height = need + 'px';
        el.style.top = Math.max(0, Math.round(top - (need - h) / 2)) + 'px';
    });

    dualSlide('size', true);
    updateGlobals();
    alert(`Высота увеличена у ${short.length} зон(ы) до ${need} px.`);
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

// Глобальный слушатель движения мыши (для Pan, Drawing и Paint)
window.addEventListener('mousemove', (e) => {
    // A. Pan
    if (isPanning) {
        panX = e.clientX - startPanX;
        panY = e.clientY - startPanY;
        updateTransform();
        return;
    }

    const rect = wrapper.getBoundingClientRect();
    const realX = (e.clientX - rect.left) / scale;
    const realY = (e.clientY - rect.top)  / scale;

    // B. Zone drawing
    if (isDrawing && tempZone) {
        const w = Math.abs(realX - startDrawX);
        const h = Math.abs(realY - startDrawY);
        tempZone.style.width  = w + 'px';
        tempZone.style.height = h + 'px';
        tempZone.style.left   = (realX < startDrawX ? realX : startDrawX) + 'px';
        tempZone.style.top    = (realY < startDrawY ? realY : startDrawY) + 'px';
    }

    // C. Paint patch drawing
    if (isPaintDrawing && tempPatch) {
        const w = Math.abs(realX - paintStartX);
        const h = Math.abs(realY - paintStartY);
        tempPatch.style.width  = w + 'px';
        tempPatch.style.height = h + 'px';
        tempPatch.style.left   = (realX < paintStartX ? realX : paintStartX) + 'px';
        tempPatch.style.top    = (realY < paintStartY ? realY : paintStartY) + 'px';
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        workspace.style.cursor = currentTool === 'eyedrop' ? 'crosshair' : 'default';
    }
    if (isDrawing) {
        isDrawing = false;
        if (tempZone) {
            if (parseInt(tempZone.style.width) > 20 && parseInt(tempZone.style.height) > 20) {
                createZone(tempZone);
            } else { tempZone.remove(); }
            tempZone = null;
        }
    }
    if (isPaintDrawing) {
        isPaintDrawing = false;
        if (tempPatch) {
            const w = parseInt(tempPatch.style.width)  || 0;
            const h = parseInt(tempPatch.style.height) || 0;
            if (w > 5 && h > 5) {
                registerPaintPatch(tempPatch);
            } else {
                tempPatch.remove();
            }
            tempPatch = null;
        }
    }
});

// ГЛАВНЫЙ ОБРАБОТЧИК КЛИКОВ
workspace.addEventListener('mousedown', (e) => {
    // 1. Игнор служебных элементов
    if (e.target.closest('#floatingToolbar')) return;
    if (e.target.closest('#toolPanel')) return;

    // 2. Pan — средняя кнопка или Alt+ЛКМ
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        workspace.style.cursor = 'grabbing';
        e.preventDefault();
        return;
    }

    // 3. Зоны — пусть обрабатывают сами
    if (e.target.closest('.zone') || e.target.closest('.resize-handle')) return;

    // Только ЛКМ дальше
    if (e.button !== 0) return;
    const imgEl = document.getElementById('docImage');
    if (!imgEl.src || imgEl.src === window.location.href) return;

    const rect = wrapper.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) / scale;
    const imgY = (e.clientY - rect.top)  / scale;

    if (currentTool === 'eyedrop') {
        sampleColorAt(e);
        e.preventDefault();
    } else if (currentTool === 'paint') {
        // patch сам перехватывает клики через stopPropagation
        // Начало рисования patch
        isPaintDrawing = true;
        paintStartX = imgX;
        paintStartY = imgY;
        tempPatch = document.createElement('div');
        tempPatch.className = 'paint-patch';
        tempPatch.style.left   = imgX + 'px';
        tempPatch.style.top    = imgY + 'px';
        tempPatch.style.width  = '0px';
        tempPatch.style.height = '0px';
        tempPatch.style.background = currentPaintColor;
        wrapper.appendChild(tempPatch);
        e.preventDefault();
    } else {
        // zone tool — рисуем зону
        deselectZone();
        isDrawing = true;
        startDrawX = imgX;
        startDrawY = imgY;
        tempZone = document.createElement('div');
        tempZone.className = 'zone';
        tempZone.style.left = startDrawX + 'px';
        tempZone.style.top  = startDrawY + 'px';
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

// === PAINT PATCHES ===
let activePatchEl = null;

function registerPaintPatch(el) {
    const data = {
        el,
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
        color: currentPaintColor
    };
    paintPatches.push(data);

    // Drag
    el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();

        const d = paintPatches.find(p => p.el === el);
        const startLeft = parseFloat(el.style.left);
        const startTop  = parseFloat(el.style.top);
        const mouseStartX = e.clientX;
        const mouseStartY = e.clientY;

        const move = (ev) => {
            const dx = (ev.clientX - mouseStartX) / scale;
            const dy = (ev.clientY - mouseStartY) / scale;
            const nx = startLeft + dx;
            const ny = startTop  + dy;
            el.style.left = nx + 'px';
            el.style.top  = ny + 'px';
            if (d) { d.x = nx; d.y = ny; }
        };
        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup',   stop);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup',   stop);
    });

    // ПКМ — контекстное меню
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activePatchEl = el;
        const menu = document.getElementById('patchContextMenu');
        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top  = e.clientY + 'px';
    });
}

function deletePaintPatch(el) {
    const idx = paintPatches.findIndex(p => p.el === el);
    if (idx > -1) { paintPatches.splice(idx, 1); }
    el.remove();
}

function initPatchContextMenu() {
    document.getElementById('ctxPatchDelete').onclick = () => {
        if (activePatchEl) deletePaintPatch(activePatchEl);
        activePatchEl = null;
        document.getElementById('patchContextMenu').style.display = 'none';
    };
    document.addEventListener('click', () => {
        document.getElementById('patchContextMenu').style.display = 'none';
    });
    document.addEventListener('contextmenu', () => {
        // Закрываем если ПКМ не на patch (patch сам откроет)
        document.getElementById('patchContextMenu').style.display = 'none';
    });
}

function clearAllPatches() {
    paintPatches.forEach(p => p.el.remove());
    paintPatches = [];
}

function loadPatchesUI(list) {
    clearAllPatches();
    const savedColor = currentPaintColor;
    (list || []).forEach(p => {
        const el = document.createElement('div');
        el.className = 'paint-patch';
        el.style.left       = p.x + 'px';
        el.style.top        = p.y + 'px';
        el.style.width      = p.w + 'px';
        el.style.height     = p.h + 'px';
        el.style.background = p.color;
        wrapper.appendChild(el);
        currentPaintColor = p.color;
        registerPaintPatch(el);
    });
    currentPaintColor = savedColor;
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
    globalSettings.seed     = document.getElementById('projectSeed').value;
    globalSettings.fontType = fontType;
    // 1. Простые поля
    globalSettings.font  = document.getElementById('globalFont').value;
    globalSettings.color = document.getElementById('globalColor').value;
    
    // 2. Двойные слайдеры (читаем через getRangeValues)
    globalSettings.size = getRangeValues('size');
    globalSettings.shakiness = getRangeValues('shake');
    globalSettings.opacity = getRangeValues('opacity');
    globalSettings.blur = getRangeValues('blur');
    globalSettings.slant = getRangeValues('slant');
    globalSettings.kerning = getRangeValues('kern');
    globalSettings.color_var = getRangeValues('cvar'); // Не забываем новый слайдер цвета!
    globalSettings.height_variation = getRangeValues('hvar'); // Вариация высоты
    globalSettings.width_variation = getRangeValues('wvar');  // Вариация ширины
    globalSettings.distortion = getRangeValues('distort');    // Деформация букв

    // 3. Печать
    globalSettings.print_dpi     = parseInt(document.getElementById('printDpi').value, 10) || 300;
    globalSettings.output_format = document.getElementById('outputFormat').value;
    globalSettings.output_pdf    = document.getElementById('outputPdf').checked;

    // 4. Конфиг шрифтов (fonts_config) обновляется через модальное окно,
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
    const patchesConfig = paintPatches.map(p => ({
        x: p.x, y: p.y, w: p.w, h: p.h, color: p.color
    }));

    return JSON.stringify({ globals: globalSettings, zones: zonesConfig, patches: patchesConfig });
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
        if(res.data) {
            const img = document.getElementById('previewImg');
            img.onload = () => resetPreviewZoom();
            img.src = res.data;
            document.getElementById('previewModal').style.display = 'flex';
        } else alert(res.error);
    });
}

// === PREVIEW ZOOM & PAN ===
let previewScale = 1;
let previewPanX = 0, previewPanY = 0;
let previewDragging = false;
let previewDragStartX = 0, previewDragStartY = 0;

function _updatePreviewTransform() {
    const c = document.getElementById('previewPanContainer');
    if (c) c.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewScale})`;
    const lbl = document.getElementById('previewZoomLabel');
    if (lbl) lbl.innerText = Math.round(previewScale * 100) + '%';
}

function resetPreviewZoom() {
    const vp = document.getElementById('previewViewport');
    const img = document.getElementById('previewImg');
    if (!vp || !img.naturalWidth) return;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    previewScale = Math.min(vw / img.naturalWidth, vh / img.naturalHeight) * 0.97;
    previewPanX = (vw - img.naturalWidth  * previewScale) / 2;
    previewPanY = (vh - img.naturalHeight * previewScale) / 2;
    _updatePreviewTransform();
}

function setPreviewZoom(z) {
    const vp = document.getElementById('previewViewport');
    const img = document.getElementById('previewImg');
    if (!vp || !img.naturalWidth) return;
    previewScale = z;
    previewPanX = (vp.clientWidth  - img.naturalWidth  * z) / 2;
    previewPanY = (vp.clientHeight - img.naturalHeight * z) / 2;
    _updatePreviewTransform();
}

(function initPreviewZoom() {
    // Ждём, пока DOM будет готов
    window.addEventListener('DOMContentLoaded', () => {
        const vp = document.getElementById('previewViewport');
        if (!vp) return;

        // Колесо → зум относительно курсора
        vp.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = vp.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const prev = previewScale;
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            previewScale = Math.max(0.05, Math.min(20, previewScale * factor));
            previewPanX = mx - (mx - previewPanX) * (previewScale / prev);
            previewPanY = my - (my - previewPanY) * (previewScale / prev);
            _updatePreviewTransform();
        }, { passive: false });

        // Зажать → панорама
        vp.addEventListener('mousedown', (e) => {
            previewDragging = true;
            previewDragStartX = e.clientX - previewPanX;
            previewDragStartY = e.clientY - previewPanY;
            vp.style.cursor = 'grabbing';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!previewDragging) return;
            previewPanX = e.clientX - previewDragStartX;
            previewPanY = e.clientY - previewDragStartY;
            _updatePreviewTransform();
        });
        window.addEventListener('mouseup', () => {
            if (!previewDragging) return;
            previewDragging = false;
            const vp2 = document.getElementById('previewViewport');
            if (vp2) vp2.style.cursor = 'grab';
        });

        // Закрытие по клику на фон (не на вьюпорт)
        document.getElementById('previewModal').addEventListener('mousedown', (e) => {
            if (e.target === document.getElementById('previewModal')) closePreview();
        });
    });
})();

function updateProgress(c,t) { document.getElementById('progressBar').value=c; document.getElementById('progressBar').max=t; document.getElementById('progVal').innerText=`${c}/${t}`; }
function finishGeneration(m) { alert(m); document.getElementById('progressInfo').style.display='none'; }
function closePreview() {
    document.getElementById('previewModal').style.display='none';
    previewDragging = false;
}

function saveProject() { 
    // Сначала читаем актуальное состояние интерфейса
    updateGlobals();

    const data = {
        image: currentImagePath,
        excel: currentExcelPath,
        globals: globalSettings,
        zones: zones.map(z => ({
            x: parseFloat(z.element.style.left),
            y: parseFloat(z.element.style.top),
            w: parseFloat(z.element.style.width),
            h: parseFloat(z.element.style.height),
            settings: z.settings
        })),
        patches: paintPatches.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, color: p.color }))
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
        clearAllPatches();
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

            if (typeof res.image === 'object' && res.image.dpi) setBgDpi(res.image.dpi);

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

            // Настройки печати (в старых шаблонах их нет — подставляем дефолты)
            document.getElementById('printDpi').value = g.print_dpi || 300;
            document.getElementById('outputFormat').value = g.output_format || 'png';
            document.getElementById('outputPdf').checked = (g.output_pdf !== false);
            
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
            setDual('hvar', g.height_variation); // Вариация высоты
            setDual('wvar', g.width_variation);  // Вариация ширины
            setDual('distort', g.distortion);    // Деформация букв

            // Г. Конфиг весов шрифтов
            if (g.fonts_config) {
                globalSettings.fonts_config = g.fonts_config;
            } else {
                globalSettings.fonts_config = {};
            }

            // Д. Тип шрифта
            if (g.fontType) setFontType(g.fontType);

            // Е. Применяем всё в память
            updateGlobals();
        }

        // === 4. ЗАКРАСКИ ===
        if (res.patches) {
            // Ждём загрузки картинки
            const applyPatches = () => loadPatchesUI(res.patches);
            if (document.getElementById('docImage').complete) applyPatches();
            else document.getElementById('docImage').addEventListener('load', applyPatches, { once: true });
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