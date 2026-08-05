import base64
import io
import sys
import os
import random
from PIL import Image

def resource_path(relative_path):
    """Получает абсолютный путь к ресурсу, работает для dev и для PyInstaller"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def get_external_path(folder_name):
    """Возвращает путь к папке, лежащей РЯДОМ с exe файлом"""
    if getattr(sys, 'frozen', False):
        # Если запущено как exe
        base_path = os.path.dirname(sys.executable)
    else:
        # Если запущено из скрипта (мы сейчас в core/utils.py, нам нужно на уровень выше)
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    return os.path.join(base_path, folder_name)

A4_INCHES = (8.267, 11.692)

def detect_dpi(path):
    """DPI изображения: из метаданных, иначе выводим из размера как для листа A4.

    Нужен и генератору (масштаб под печать), и интерфейсу (показать реальный
    размер шрифта в миллиметрах — иначе на 300-dpi бланке дефолтные 18px
    превращаются в 1.5 мм, и почерка попросту не видно).
    """
    try:
        with Image.open(path) as im:
            dpi = im.info.get('dpi')
            if dpi and dpi[0] and dpi[0] > 1:
                return float(dpi[0])
            implied = im.size[0] / A4_INCHES[0]
    except Exception:
        return 96.0
    return float(min((72, 96, 150, 200, 300, 400, 600, 1200),
                     key=lambda d: abs(d - implied)))

def image_to_base64(path):
    try:
        with open(path, "rb") as image_file:
            encoded = base64.b64encode(image_file.read()).decode('utf-8')
            return f"data:image/jpeg;base64,{encoded}"
    except Exception as e:
        print(f"Error loading image: {e}")
        return None

def pillow_to_base64(img_obj):
    buffer = io.BytesIO()
    img_obj.convert("RGB").save(buffer, format="JPEG", quality=80)
    img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{img_str}"

def wrap_text(text, font, max_width):
    lines = []
    paragraphs = text.split('\n')
    for paragraph in paragraphs:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current_line = words[0]
        for word in words[1:]:
            if font.getlength(current_line + " " + word) <= max_width:
                current_line += " " + word
            else:
                lines.append(current_line)
                current_line = word
        lines.append(current_line)
    return lines

def vary_color(rgb, variance=20):
    """Добавляет шум в цвет для реализма"""
    r, g, b = rgb
    return (
        max(0, min(255, r + random.randint(-variance, variance))),
        max(0, min(255, g + random.randint(-variance, variance))),
        max(0, min(255, b + random.randint(-variance, variance)))
    )
