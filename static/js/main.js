window.onload = function() {
    UI.init();
    Canvas.init();
    
    // Auto-init API
    if (window.pywebview) {
        API.initFonts();
    }
};

window.addEventListener('pywebviewready', () => {
    setTimeout(() => {
        API.initFonts();
    }, 500);
});