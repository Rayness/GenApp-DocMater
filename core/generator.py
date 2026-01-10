import os
import random
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from core.utils import wrap_text, vary_color, resource_path

FONTS_FOLDER = resource_path("fonts")
OUTPUT_FOLDER = "output"

class Generator:
    def __init__(self):
        self.font_cache = {}
        self.is_running = False

    def get_fonts(self):
        if not os.path.exists(FONTS_FOLDER): return []
        return [f for f in os.listdir(FONTS_FOLDER) if f.endswith(('.ttf', '.otf'))]

    def _get_cached_font(self, font_name, size):
        key = f"{font_name}_{size}"
        if key in self.font_cache: return self.font_cache[key]
        try:
            path = os.path.join(FONTS_FOLDER, font_name)
            font = ImageFont.truetype(path, size)
            self.font_cache[key] = font
            return font
        except: return None

    def _hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    def _pick_weighted_font(self, available_fonts, fonts_config):
        # fonts_config = {"Arial.ttf": 10, "BadScript.ttf": 1, ...}
        
        # 1. Фильтруем только те, что есть в наличии и включены (вес > 0)
        candidates = []
        weights = []
        
        for f in available_fonts:
            # Если конфига нет, считаем вес = 5 (средний)
            # Если конфиг есть, берем значение. Если 0 - пропускаем.
            w = fonts_config.get(f, 5) if fonts_config else 5
            if w > 0:
                candidates.append(f)
                weights.append(w)
        
        # Если вдруг все отключили или список пуст — берем любой доступный
        if not candidates:
            return random.choice(available_fonts) if available_fonts else None
            
        # 2. Магия взвешенного рандома
        # k=1 возвращает список из 1 элемента
        return random.choices(candidates, weights=weights, k=1)[0]

    # Вспомогательная функция для получения значения из диапазона
    def _get_val(self, param):
        if isinstance(param, dict) and 'min' in param and 'max' in param:
            return random.uniform(param['min'], param['max'])
        return float(param)

    def _draw_line(self, img, text, font, x, y, phys, base_color):
        shake = phys['shakiness']
        ink = phys['ink']
        slant = phys['slant']
        blur = phys['blur']
        max_kern = int(phys['kerning'])
        
        cursor_x = x
        scale_factor = 2 
        
        for char in text:
            if char == ' ':
                cursor_x += font.getlength(' ') + random.randint(0, int(max_kern/2+1))
                continue
            
            # Цвет
            current_color = vary_color(base_color, variance=20)
            
            # Прозрачность: делаем более зависимой от Ink
            # Ink 0 = бледный (180), Ink 10 = плотный (255)
            alpha_base = 180 + (ink * 7.5) 
            alpha = int(max(100, min(255, alpha_base + random.randint(-20, 20))))
            
            orig_size = int(font.size * 2.5)
            c_size = orig_size * scale_factor
            
            big_font = self._get_cached_font(os.path.basename(font.path), font.size * scale_factor)
            if not big_font: big_font = font

            char_img = Image.new('RGBA', (c_size, c_size), (255,255,255,0))
            d = ImageDraw.Draw(char_img)
            
            # === ИСПРАВЛЕННАЯ ЛОГИКА ТОЛЩИНЫ ===
            # scale_factor = 2, значит stroke_width=1 даст 0.5px в оригинале (чуть жирнее обычного)
            # stroke_width=2 даст 1px (жирно)
            
            sw = 0
            if ink < 3.0:
                sw = 0 # Очень тонко (стандарт)
            elif ink < 5.5:
                sw = 1 # Чуть жирнее (полужирный)
            elif ink < 8.0:
                sw = 2 # Жирный
            else:
                sw = 3 # Очень жирный
            
            # Важный нюанс: stroke_width рисует обводку. 
            # Чтобы она не съедала букву, цвет заливки и обводки одинаковый.
            d.text((c_size//4, c_size//4), char, font=big_font, fill=(*current_color, alpha), stroke_width=sw)
            
            # === ТРАНСФОРМАЦИИ (без изменений) ===
            shear_val = slant * 0.1 + random.uniform(-0.02, 0.02)
            if abs(shear_val) > 0.01:
                char_img = char_img.transform((c_size, c_size), Image.AFFINE, (1, -shear_val, 0, 0, 1, 0), resample=Image.BICUBIC)

            ang = random.uniform(-shake, shake)
            char_img = char_img.rotate(ang, resample=Image.BICUBIC)
            
            char_img = char_img.resize((orig_size, orig_size), resample=Image.LANCZOS)
            
            if blur > 0:
                radius = (blur / 5.0) + random.uniform(0, 0.1)
                char_img = char_img.filter(ImageFilter.GaussianBlur(radius=radius))

            y_off = random.randint(-int(shake), int(shake)) if shake > 0 else 0
            img.paste(char_img, (int(cursor_x - orig_size//4), int(y + y_off - orig_size//4)), char_img)
            
            cursor_x += font.getlength(char) + random.randint(-int(max_kern/2), max_kern)

    def _fit_and_draw(self, img, text, font_name, max_size, zone, phys, color):
        w_box = zone['width']
        h_box = zone['height']
        x_start = zone['x']
        y_start = zone['y']
        
        line_spacing_factor = 1.0 + (random.uniform(-0.02, 0.02))

        current_size = max_size
        min_size = 12
        final_font = None
        final_lines = []
        text_pixel_height = 0
        
        while current_size >= min_size:
            font = self._get_cached_font(font_name, current_size)
            if not font: break
            lines = wrap_text(text, font, w_box)
            if not lines: break
            
            ascent, descent = font.getmetrics()
            line_height = (ascent + descent) * line_spacing_factor
            total_h = len(lines) * line_height
            
            if total_h <= h_box:
                final_font = font
                final_lines = lines
                text_pixel_height = total_h
                break
            current_size -= 2
        
        if not final_font: return

        available_space = h_box - text_pixel_height
        y_offset = available_space / 2
        
        ascent, descent = final_font.getmetrics()
        line_height = (ascent + descent) * line_spacing_factor
        curr_y = y_start + y_offset
        
        for line in final_lines:
            self._draw_line(img, line, final_font, x_start, curr_y, phys, color)
            curr_y += line_height

    def process(self, img_path, df_row, config_json):
        try: 
            base_img = Image.open(img_path).convert("RGBA")
            txt_layer = Image.new('RGBA', base_img.size, (255,255,255,0))
        except: return None

        cfg = json.loads(config_json)
        glo = cfg['globals']
        zones = cfg['zones']
        avail = self.get_fonts()
        if not avail: return base_img

        # Получаем конфиг весов из JSON (если его нет, будет None)
        fonts_cfg = glo.get('fonts_config', {})

        # === ВЫБОР ГЛОБАЛЬНОГО ШРИФТА ===
        doc_font_name = None
        if glo['font'] == 'random_per_doc':
            # ТУТ ИСПОЛЬЗУЕМ ВЕСА
            doc_font_name = self._pick_weighted_font(avail, fonts_cfg)
        elif glo['font'] != 'random' and glo['font'] in avail:
            doc_font_name = glo['font']

        # ... (код физики и цвета без изменений) ...
        # (Просто скопируй то, что было, или оставь как есть)
        doc_base_size = int(self._get_val(glo.get('size', 20)))
        doc_phys = {
            'shakiness': self._get_val(glo.get('shakiness', 0)),
            'ink':       self._get_val(glo.get('ink', 5)),
            'kerning':   self._get_val(glo.get('kerning', 0)),
            'slant':     self._get_val(glo.get('slant', 0)),
            'blur':      self._get_val(glo.get('blur', 0))
        }
        
        # Цвет... (тот же код)
        base_rgb = self._hex_to_rgb(glo['color'])
        c_var = int(self._get_val(glo.get('color_var', 0)))
        r, g, b = base_rgb
        r = max(0, min(255, r + random.randint(-c_var, c_var)))
        g = max(0, min(255, g + random.randint(-c_var, c_var)))
        b = max(0, min(255, b + random.randint(-c_var, c_var)))
        doc_color = (r, g, b)

        for z in zones:
            fname = z['font']
            # Если шрифт не задан локально
            if not fname:
                if glo['font'] == 'random': 
                    # ТУТ ТОЖЕ ИСПОЛЬЗУЕМ ВЕСА (если режим "разные поля")
                    fname = self._pick_weighted_font(avail, fonts_cfg)
                elif glo['font'] == 'random_per_doc': 
                    fname = doc_font_name
                else: 
                    fname = glo['font']
                
                # Страховка
                if fname not in avail: fname = random.choice(avail)
            
            size = z['size'] if z['size'] else doc_base_size
            txt = str(df_row.get(z['column'], ""))
            if not txt: continue

            self._fit_and_draw(txt_layer, txt, fname, size, z, doc_phys, doc_color)

        out = Image.alpha_composite(base_img, txt_layer)
        return out
    
    # preview, batch, stop остаются без изменений (наследуют self.process)
    def preview(self, img_path, config_json, df):
        if df is not None and not df.empty: row = df.iloc[0].to_dict()
        else:
            cfg = json.loads(config_json)
            row = {z['column']: z['column'] for z in cfg['zones']}
        return self.process(img_path, row, config_json)

    def batch(self, bg_source, df, config_json, cb_prog, cb_done):
        # bg_source может быть списком (из API) или строкой (если вдруг старый вызов)
        if isinstance(bg_source, str):
            bg_list = [bg_source]
        else:
            bg_list = bg_source
            
        self.is_running = True
        total = len(df)
        if not os.path.exists(OUTPUT_FOLDER): os.makedirs(OUTPUT_FOLDER)
        
        bg_count = len(bg_list)
        
        for i, row in df.iterrows():
            if not self.is_running: break
            try:
                # === РОТАЦИЯ ФОНОВ ===
                # Берем i-й фон по модулю (0, 1, 2 ... 0, 1, 2)
                current_bg_path = bg_list[i % bg_count]
                
                img = self.process(current_bg_path, row, config_json)
                if img: 
                    # Имя файла: doc_1.jpg, doc_2.jpg...
                    img.convert("RGB").save(os.path.join(OUTPUT_FOLDER, f"doc_{i+1}.jpg"))
                
                if cb_prog: cb_prog(i+1, total)
            except Exception as e:
                print(f"Err row {i}: {e}")
        
        self.font_cache.clear()
        self.is_running = False
        if cb_done: cb_done()
    
    def stop(self): self.is_running = False