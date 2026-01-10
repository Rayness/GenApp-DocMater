import webview
import pandas as pd
import threading
import json
import os
import glob # Добавили для поиска файлов
from concurrent.futures import ThreadPoolExecutor
from core.utils import image_to_base64, pillow_to_base64
from core.generator import Generator

class Api:
    def __init__(self):
        self._window = None
        self._gen = Generator()
        
        # Теперь поддерживаем и одиночный путь, и список
        self.background_mode = 'single' # 'single' или 'folder'
        self.image_path = None          # Путь к одиночному файлу (или первому из папки)
        self.bg_list = []               # Список всех картинок из папки
        
        self.excel_path = None
        self.df = None
        self.pool = ThreadPoolExecutor(max_workers=1)

    def set_window(self, w): self._window = w
    def get_fonts_list(self): return self._gen.get_fonts()

    # === НОВЫЙ МЕТОД: ВЫБОР ПАПКИ ===
    def pick_background_folder(self):
        r = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if r:
            folder = r[0]
            # Ищем картинки (регистронезависимо по расширению - упрощенно)
            exts = ['*.jpg', '*.jpeg', '*.png', '*.bmp']
            files = []
            for ext in exts:
                files.extend(glob.glob(os.path.join(folder, ext)))
                files.extend(glob.glob(os.path.join(folder, ext.upper())))
            
            # Убираем дубликаты и сортируем
            files = sorted(list(set(files)))
            
            if not files:
                return {"error": "В папке нет картинок!"}
            
            self.background_mode = 'folder'
            self.bg_list = files
            self.image_path = files[0] # Берем первую для превью
            
            return {
                "mode": "folder",
                "count": len(files),
                "first_path": self.image_path,
                "data": image_to_base64(self.image_path) # Отдаем фронту только одну
            }
        return None

    # === ОБНОВЛЕННЫЙ МЕТОД: ВЫБОР ФАЙЛА ===
    def pick_image(self):
        r = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=('Images (*.jpg;*.png)','Documents (*.pdf;*.docx)',))
        if r:
            self.background_mode = 'single'
            self.image_path = r[0]
            self.bg_list = [r[0]] # Список из одного элемента
            return {
                "mode": "single",
                "path": r[0],
                "data": image_to_base64(r[0])
            }
        return None

    # pick_excel, save_template, load_template, get_preview - ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ
    # (код их пропущу, он тот же)
    def pick_excel(self):
        r = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=('Excel (*.xlsx;*.xls)',))
        if r:
            self.excel_path = r[0]
            try:
                self.df = pd.read_excel(r[0], dtype=str).fillna("")
                return {"path": r[0], "columns": list(self.df.columns)}
            except: pass
        return None

    def save_template(self, json_data):
        r = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename='template.json')
        if r:
            p = r[0] if isinstance(r, tuple) else r
            with open(p, 'w', encoding='utf-8') as f: f.write(json_data)

    def load_template(self):
        r = self._window.create_file_dialog(webview.OPEN_DIALOG)
        if r:
            p = r[0] if isinstance(r, tuple) else r
            try:
                with open(p, 'r', encoding='utf-8') as f: 
                    data = json.load(f)
                
                # ЛОГИКА ЗАГРУЗКИ (УПРОЩЕННАЯ):
                # Если в сохранении был режим folder, нам по-хорошему надо бы сохранить путь к папке.
                # Но пока предположим, что грузим одиночную картинку, 
                # либо юзер сам перевыберет папку после загрузки шаблона.
                if 'image' in data:
                    img_path = data['image']
                    if isinstance(img_path, dict): img_path = img_path.get('path')
                    if img_path and os.path.exists(img_path):
                        # Считаем это single mode по умолчанию при загрузке
                        self.background_mode = 'single'
                        self.image_path = img_path
                        self.bg_list = [img_path]
                        data['image'] = {"path": img_path, "data": image_to_base64(img_path)}
                    else:
                        data['image'] = {"path": img_path, "data": None}
                return data
            except Exception as e: return {"error": str(e)}
        return None

    def get_preview(self, config_json):
        if not self.image_path: return {"error": "No Image"}
        # Превью всегда генерируем на self.image_path (первый файл)
        f = self.pool.submit(self._gen.preview, self.image_path, config_json, self.df)
        img = f.result()
        if img: return {"data": pillow_to_base64(img)}
        return {"error": "Gen failed"}

    # === ОБНОВЛЕННАЯ ГЕНЕРАЦИЯ ===
    def generate_docs(self, config_json):
        if not self.bg_list or self.df is None: return
        
        def prog(c, t): self._window.evaluate_js(f"updateProgress({c},{t})")
        def done(): self._window.evaluate_js("finishGeneration('Генерация завершена!')")
        
        # Передаем весь список фонов
        t = threading.Thread(
            target=self._gen.batch, 
            args=(self.bg_list, self.df, config_json, prog, done)
        )
        t.start()

    def stop_generation(self):
        self._gen.stop()
        return "Остановка..."