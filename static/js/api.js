const API = {
    // Получить шрифты и инициализировать UI
    async initFonts() {
        try {
            const fonts = await window.pywebview.api.get_fonts_list();
            State.availableFonts = fonts || [];
            
            // Вызываем методы UI, так как API загрузился
            if (window.UI) {
                UI.updateFontSelects();
                UI.requestGlobalSample();
            }
        } catch (e) {
            console.error("Fonts load error:", e);
            State.availableFonts = ['Arial']; 
            if (window.UI) UI.updateFontSelects();
        }
    },

    async selectImage() {
        const res = await window.pywebview.api.pick_image();
        if (res) {
            State.currentImagePath = res.path;
            const img = document.getElementById('docImage');
            img.src = res.data;
            document.getElementById('fileStatus').innerText = "Бланк: " + res.path.split(/[\\/]/).pop();
        }
    },

    async selectExcel() {
        const res = await window.pywebview.api.pick_excel();
        if (res && res.columns) {
            State.currentExcelPath = res.path;
            State.excelColumns = res.columns;
            document.getElementById('fileStatus').innerText = "Excel: " + res.path.split(/[\\/]/).pop();
            document.getElementById('genBtn').disabled = false;
            
            // Обновляем списки колонок в UI
            if (window.UI) UI.updateColumnSelects();
        }
    },

    async getSample(params) {
        if (!params.font) params.font = "Arial";
        return await window.pywebview.api.get_sample_image(JSON.stringify(params));
    },

    async getPreview(config) {
        return await window.pywebview.api.get_preview(config);
    },

    generate(config) {
        window.pywebview.api.generate_docs(config);
    },

    async save(json) {
        await window.pywebview.api.save_template(json);
    },

    async load() {
        return await window.pywebview.api.load_template();
    }
};