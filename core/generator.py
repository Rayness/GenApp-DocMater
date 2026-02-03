import os
import random
import json
import hashlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from core.utils import wrap_text, vary_color, resource_path, get_external_path

FONTS_FOLDER = get_external_path("fonts")
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

    def _get_val(self, param):
        if isinstance(param, dict) and 'min' in param and 'max' in param:
            return random.uniform(param['min'], param['max'])
        return float(param)

    def _hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    
    def _get_perspective_coefficients(self, src_points, dst_points):
        """
        Вычисляет коэффициенты для перспективной трансформации.
        src_points и dst_points - списки из 4 точек (x, y) каждая.
        Возвращает кортеж из 8 коэффициентов для Image.PERSPECTIVE.
        Использует numpy для решения системы уравнений.
        """
        try:
            import numpy as np
            
            # Создаем матрицу для системы уравнений
            A = []
            b = []
            
            for (x, y), (X, Y) in zip(src_points, dst_points):
                A.append([x, y, 1, 0, 0, 0, -X*x, -X*y])
                A.append([0, 0, 0, x, y, 1, -Y*x, -Y*y])
                b.extend([X, Y])
            
            A = np.array(A, dtype=float)
            b = np.array(b, dtype=float)
            
            # Решаем систему уравнений
            coeffs = np.linalg.lstsq(A, b, rcond=None)[0]
            
            return tuple(coeffs)
        except Exception as e:
            # В случае ошибки возвращаем единичную трансформацию
            return (1, 0, 0, 0, 1, 0, 0, 0)

    def _pick_weighted_font(self, available_fonts, fonts_config):
        """Выбирает один шрифт на основе весов"""
        candidates = []
        weights = []
        for f in available_fonts:
            w = fonts_config.get(f, 5) # Вес по умолчанию 5
            if w > 0:
                candidates.append(f)
                weights.append(w)
        
        if not candidates:
            return random.choice(available_fonts) if available_fonts else None
        return random.choices(candidates, weights=weights, k=1)[0]

    def _draw_line(self, img, text, font_pool, size, x, y, phys, base_color):
        shake = phys['shakiness']
        opacity_val = phys['opacity'] # Новый параметр (0-10)
        slant = phys['slant']
        blur_val = phys['blur']
        max_kern = int(phys['kerning'])
        height_var = phys.get('height_variation', 0)  # Вариация высоты (0-100%)
        width_var = phys.get('width_variation', 0)    # Вариация ширины (0-100%)
        distortion = phys.get('distortion', 0)        # Деформация букв (0-100)
        
        cursor_x = x
        scale_factor = 3 
        
        for char in text:
            if char == ' ':
                temp_f = self._get_cached_font(font_pool[0], size)
                cursor_x += temp_f.getlength(' ') + random.randint(0, int(max_kern/2+1))
                continue
            
            current_font_name = random.choice(font_pool)
            font = self._get_cached_font(current_font_name, size)
            
            # === РАСЧЕТ ПРОЗРАЧНОСТИ ===
            # Opacity 0 -> Alpha ~30 (почти не видно)
            # Opacity 10 -> Alpha 255 (полная заливка)
            # Формула: Base + (Val * Multiplier)
            alpha_base = 30 + (opacity_val * 22.5) 
            
            # Добавляем рандом, чтобы буквы немного "мерцали" по плотности
            alpha = int(max(10, min(255, alpha_base + random.randint(-15, 15))))
            
            current_color = vary_color(base_color, variance=15)
            
            # Вариация размера символа для реалистичности
            # height_var и width_var в процентах (0-100)
            # Генерируем случайные множители от (1 - var/100) до (1 + var/100)
            h_factor = 1.0 + random.uniform(-height_var/100, height_var/100)
            w_factor = 1.0 + random.uniform(-width_var/100, width_var/100)
            
            # Подготовка
            orig_size = int(size * 2.5)
            c_size = orig_size * scale_factor
            big_font = self._get_cached_font(current_font_name, size * scale_factor)
            if not big_font: big_font = font

            # Создаем холст побольше, чтобы вместить варьирующийся размер
            canvas_size = int(c_size * max(h_factor, w_factor) * 1.2)
            char_img = Image.new('RGBA', (canvas_size, canvas_size), (255,255,255,0))
            d = ImageDraw.Draw(char_img)
            
            # === НИКАКОЙ ОБВОДКИ ===
            # stroke_width убираем (ставим 0), чтобы шрифт был естественным
            d.text((canvas_size//4, canvas_size//4), char, font=big_font, fill=(*current_color, alpha), stroke_width=0)
            
            # Применяем вариацию высоты и ширины через масштабирование
            if h_factor != 1.0 or w_factor != 1.0:
                new_w = int(canvas_size * w_factor)
                new_h = int(canvas_size * h_factor)
                char_img = char_img.resize((new_w, new_h), resample=Image.LANCZOS)
                # Обрезаем/дополняем до квадрата для дальнейших трансформаций
                final_canvas = Image.new('RGBA', (canvas_size, canvas_size), (255,255,255,0))
                offset_x = (canvas_size - new_w) // 2
                offset_y = (canvas_size - new_h) // 2
                final_canvas.paste(char_img, (offset_x, offset_y))
                char_img = final_canvas
            
            # Деформация букв (перспективное искажение)
            if distortion > 0:
                # Применяем случайную перспективную деформацию
                # distortion в процентах (0-100) определяет максимальный сдвиг углов
                max_shift = (distortion / 100.0) * canvas_size * 0.15  # Максимум 15% от размера
                
                # Исходные углы квадрата
                width = canvas_size
                height = canvas_size
                
                # Целевые углы с небольшими случайными сдвигами
                coeffs = self._get_perspective_coefficients(
                    # Исходные 4 угла (верхний левый, верхний правый, нижний правый, нижний левый)
                    [(0, 0), (width, 0), (width, height), (0, height)],
                    # Целевые углы со случайными сдвигами
                    [
                        (random.uniform(-max_shift, max_shift), random.uniform(-max_shift, max_shift)),
                        (width + random.uniform(-max_shift, max_shift), random.uniform(-max_shift, max_shift)),
                        (width + random.uniform(-max_shift, max_shift), height + random.uniform(-max_shift, max_shift)),
                        (random.uniform(-max_shift, max_shift), height + random.uniform(-max_shift, max_shift))
                    ]
                )
                char_img = char_img.transform((canvas_size, canvas_size), Image.PERSPECTIVE, coeffs, resample=Image.BICUBIC)
            
            # Blur (теперь зависит только от слайдера Blur)
            if blur_val > 0:
                # Мягкий блюр
                radius = (blur_val / 3.0) + random.uniform(0, 0.1)
                char_img = char_img.filter(ImageFilter.GaussianBlur(radius=radius))

            # Slant
            shear_val = slant * 0.1 + random.uniform(-0.02, 0.02)
            if abs(shear_val) > 0.01:
                char_img = char_img.transform((canvas_size, canvas_size), Image.AFFINE, (1, -shear_val, 0, 0, 1, 0), resample=Image.BICUBIC)

            # Rotation
            ang = random.uniform(-shake * 1.2, shake * 1.2)
            char_img = char_img.rotate(ang, resample=Image.BICUBIC)
            
            # Resize до финального размера
            char_img = char_img.resize((orig_size, orig_size), resample=Image.LANCZOS)
            
            # Jitter
            y_off = random.uniform(-shake * 0.6, shake * 0.6)
            
            img.paste(char_img, (int(cursor_x - orig_size//4), int(y + y_off - orig_size//4)), char_img)
            
            # Kerning + Overlap
            char_w = font.getlength(char)
            overlap = char_w * 0.08
            cursor_x += (char_w - overlap) + random.randint(-int(max_kern/2), max_kern)

    def _fit_and_draw(self, img, text, font_pool, max_size, zone, phys, color):
        w_box = zone['width']
        h_box = zone['height']
        x_start = zone['x']
        y_start = zone['y']
        
        line_spacing_factor = 1.0 + (random.uniform(-0.02, 0.02))

        current_size = max_size
        min_size = 12
        final_lines = []
        text_pixel_height = 0
        
        # Для расчета влезания текста используем первый шрифт из пула
        while max_size >= min_size:
            font = self._get_cached_font(font_pool[0], max_size)
            if not font: break
            lines = wrap_text(text, font, w_box)
            if not lines: break
            
            ascent, descent = font.getmetrics()
            line_height = (ascent + descent) * line_spacing_factor
            total_h = len(lines) * line_height
            
            if total_h <= h_box:
                final_lines = lines
                text_pixel_height = total_h
                break
            max_size -= 2
        
        if not final_lines: return

        available_space = h_box - text_pixel_height
        y_offset = available_space / 2
        
        ascent, descent = self._get_cached_font(font_pool[0], max_size).getmetrics()
        line_height = (ascent + descent) * line_spacing_factor
        curr_y = y_start + y_offset
        
        for line in final_lines:
            self._draw_line(img, line, font_pool, max_size, x_start, curr_y, phys, color)
            curr_y += line_height


    def _set_seed(self, row, index, global_seed):
        # 1. Ищем ID в Excel
        id_val = None
        if isinstance(row, dict): # Защита
            for k in row.keys():
                if str(k).strip().lower() == 'id':
                    id_val = row[k]
                    break
        
        # 2. Формируем строку для хеша
        # Комбинируем: "ЗНАЧЕНИЕ_ID" + "_" + "КЛЮЧ_ПРОЕКТА"
        # Если изменим Ключ Проекта, хеш полностью изменится
        if id_val is not None and str(id_val).strip() != "":
            seed_str = f"{id_val}_{global_seed}"
        else:
            seed_str = f"row_{index}_{global_seed}"
            
        hash_obj = hashlib.md5(seed_str.encode('utf-8'))
        seed_int = int(hash_obj.hexdigest(), 16) % (2**32)
        random.seed(seed_int)


    # Обновили сигнатуру: добавили row_index=0
    def process(self, img_path, df_row, config_json, row_index=0):
        try: 
            base_img = Image.open(img_path).convert("RGBA")
            txt_layer = Image.new('RGBA', base_img.size, (255,255,255,0))
        except: return None

        cfg = json.loads(config_json)
        glo = cfg['globals']
        zones = cfg['zones']
        
        # Получаем ключ проекта (seed), если нет - 'default'
        project_seed = glo.get('seed', 'default')

        # === УСТАНАВЛИВАЕМ SEED С УЧЕТОМ КЛЮЧА ===
        self._set_seed(df_row, row_index, project_seed)
        # ==========================================
        
        avail = self.get_fonts()
        if not avail: return base_img

        fonts_cfg = glo.get('fonts_config', {})
        
        # Теперь все random.choice и random.uniform ниже будут давать 
        # ОДИНАКОВЫЙ результат для одного и того же seed_str

        doc_font_name = None 
        active_pool = [f for f, w in fonts_cfg.items() if w > 0]
        if not active_pool: active_pool = [avail[0]]

        if glo['font'] == 'random_per_doc':
            doc_font_name = self._pick_weighted_font(avail, fonts_cfg)
        elif glo['font'] != 'random' and glo['font'] in avail:
            doc_font_name = glo['font']

        # Параметры документа (теперь они жестко привязаны к ID)
        doc_base_size = int(self._get_val(glo.get('size', 20)))
        
        doc_phys = {
            'shakiness': self._get_val(glo.get('shakiness', 0)),
            'opacity':   self._get_val(glo.get('opacity', 8)),
            'kerning':   self._get_val(glo.get('kerning', 0)),
            'slant':     self._get_val(glo.get('slant', 0)),
            'blur':      self._get_val(glo.get('blur', 0)),
            'height_variation': self._get_val(glo.get('height_variation', 0)),
            'width_variation':  self._get_val(glo.get('width_variation', 0)),
            'distortion': self._get_val(glo.get('distortion', 0))
        }

        base_rgb = self._hex_to_rgb(glo['color'])
        c_var = int(self._get_val(glo.get('color_var', 0)))
        r, g, b = base_rgb
        r = max(0, min(255, r + random.randint(-c_var, c_var)))
        g = max(0, min(255, g + random.randint(-c_var, c_var)))
        b = max(0, min(255, b + random.randint(-c_var, c_var)))
        doc_color = (r, g, b)

        for z in zones:
            zone_font_pool = []
            if z.get('font') and z['font'] in avail:
                zone_font_pool = [z['font']]
            else:
                if glo['font'] == 'random':
                    zone_font_pool = active_pool 
                elif glo['font'] == 'random_per_doc':
                    zone_font_pool = [doc_font_name] if doc_font_name else [active_pool[0]]
                else:
                    main_f = glo['font'] if glo['font'] in avail else avail[0]
                    zone_font_pool = [main_f]
            
            size = z['size'] if z['size'] else doc_base_size
            
            source_type = z.get('sourceType', 'excel') # excel по умолчанию
            content_key = z.get('content', '')
            
            txt = ""
            if source_type == 'text':
                # Если режим текста - берем текст напрямую
                txt = str(content_key)
            else:
                # Если режим Excel - ищем в строке
                txt = str(df_row.get(content_key, ""))
            
            if not txt: continue
            
            self._fit_and_draw(txt_layer, txt, zone_font_pool, size, z, doc_phys, doc_color)

        out = Image.alpha_composite(base_img, txt_layer)
        return out

    def preview(self, img_path, config_json, df):
        if df is not None and not df.empty: 
            # Берем первую строку, индекс 0
            row = df.iloc[0].to_dict()
            idx = 0
        else:
            cfg = json.loads(config_json)
            row = {z['column']: z['column'] for z in cfg['zones']}
            # Добавим фейковый ID для превью, чтобы оно не скакало при каждом клике
            row['ID'] = 'PREVIEW'
            idx = 0
        return self.process(img_path, row, config_json, row_index=idx)

    def batch(self, bg_source, df, config_json, cb_prog, cb_done):
        if isinstance(bg_source, str): bg_list = [bg_source]
        else: bg_list = bg_source
        self.is_running = True
        total = len(df)
        if not os.path.exists(OUTPUT_FOLDER): os.makedirs(OUTPUT_FOLDER)
        bg_count = len(bg_list)
        
        # iterrows возвращает (index, Series)
        # i - это индекс dataframe (он может быть не 0,1,2, если фильтровали), 
        # поэтому лучше использовать enumerate для счетчика
        for counter, (idx, row) in enumerate(df.iterrows()):
            if not self.is_running: break
            try:
                current_bg_path = bg_list[counter % bg_count]
                
                # ПЕРЕДАЕМ ROW (это Series превращаем в dict для удобства)
                # И ПЕРЕДАЕМ COUNTER как индекс
                row_dict = row.to_dict()
                
                img = self.process(current_bg_path, row_dict, config_json, row_index=counter)
                
                if img: img.convert("RGB").save(os.path.join(OUTPUT_FOLDER, f"doc_{counter+1}.jpg"))
                if cb_prog: cb_prog(counter+1, total)
            except Exception as e: 
                print(f"Err row {counter}: {e}")
                
        self.font_cache.clear()
        self.is_running = False
        if cb_done: cb_done()

    def stop(self): self.is_running = False