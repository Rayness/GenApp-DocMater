const State = {
    // Данные файлов
    excelColumns: [],
    availableFonts: [],
    
    // Объекты зон { id, element, settings }
    zones: [], 
    
    // Текущий выбор
    activeZoneId: null,
    contextZoneId: null, // ID зоны, на которую кликнули ПКМ
    
    // Пути файлов
    currentImagePath: "",
    currentExcelPath: "",
    
    // Глобальные настройки (значения по умолчанию)
    globalConfig: {
        font: 'random_per_doc',
        size: 50,
        color: '#1414A0',
        shakiness: 3,
        ink: 5,
        kerning: 2,
        sizeVar: 2
    },
    
    // Таймер для дебаунса превью
    previewTimeout: null,

    // === ХЕЛПЕРЫ ===
    getActiveZone: function() {
        return this.zones.find(z => z.id === this.activeZoneId);
    },
    
    getZoneById: function(id) {
        return this.zones.find(z => z.id === id);
    },

    removeZone: function(id) {
        const idx = this.zones.findIndex(z => z.id === id);
        if (idx > -1) {
            this.zones[idx].element.remove();
            this.zones.splice(idx, 1);
        }
    }
};