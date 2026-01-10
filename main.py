import webview
import os
import sys
from core.api import Api
from core.utils import resource_path # Импортируем нашу функцию путей

# Убедимся, что папки существуют (рядом с exe)
if not os.path.exists('output'): os.makedirs('output')

# Папку fonts создавать не обязательно, так как мы берем шрифты изнутри EXE,
# но если ты хочешь, чтобы пользователь мог добавлять свои шрифты снаружи,
# логику в generator.py придется немного усложнить. 
# Пока считаем, что шрифты "вшиты" в программу.

if __name__ == '__main__':
    api = Api()
    
    # Оборачиваем путь к HTML
    index_path = resource_path(os.path.join('static', 'index.html'))
    
    window = webview.create_window(
        'GenApp DocMaster Pro', 
        url=index_path, 
        width=1400, 
        height=950, 
        js_api=api,
        min_size=(1000, 700)
    )
    
    api.set_window(window)
    
    # gui='edgechromium' выберется автоматически в Windows
    webview.start(debug=False) # Debug False для продакшна