import os
import sys
import math
import random
import json
import hashlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from core.utils import wrap_text, vary_color, resource_path, get_external_path, detect_dpi

FONTS_FOLDER = get_external_path("fonts")
OUTPUT_FOLDER = "output"
A4_INCHES = (8.267, 11.692)
MAX_UPSCALE = 4.0   # выше 4× апскейл фона даёт только вес файла, не качество

if sys.platform == 'win32':
    SYSTEM_FONTS_FOLDER = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts')
else:
    SYSTEM_FONTS_FOLDER = '/usr/share/fonts/truetype'

class Generator:
    def __init__(self):
        self.font_cache = {}
        self.is_running = False
        self._font_type = 'handwriting'

    def get_fonts(self, font_type='handwriting'):
        folder = SYSTEM_FONTS_FOLDER if font_type == 'system' else FONTS_FOLDER
        if not os.path.exists(folder): return []
        return [f for f in os.listdir(folder) if f.lower().endswith(('.ttf', '.otf'))]

    def get_font_metrics(self, font_type='handwriting'):
        """Отношение высоты строки (ascent+descent) к кеглю для каждого шрифта.

        Нужно интерфейсу: генератор ужимает шрифт, пока строка не влезет в высоту
        зоны, поэтому по этому числу видно, какой кегль зона реально вытянет.
        Разброс большой (у BadScript ~1.98, у большинства ~1.13), одной константой
        не обойтись.
        """
        prev = self._font_type
        self._font_type = font_type
        out = {}
        try:
            for name in self.get_fonts(font_type):
                f = self._get_cached_font(name, 100)
                if not f: continue
                ascent, descent = f.getmetrics()
                out[name] = (ascent + descent) / 100.0
        finally:
            self._font_type = prev
        return out

    def _get_cached_font(self, font_name, size):
        key = f"{font_name}_{size}"
        if key in self.font_cache: return self.font_cache[key]
        try:
            if os.path.isabs(font_name):
                path = font_name
            elif self._font_type == 'system':
                path = os.path.join(SYSTEM_FONTS_FOLDER, font_name)
            else:
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

    def _pick_weighted_font(self, available_fonts, fonts_config):
        """Выбирает один шрифт на основе весов"""
        candidates = []
        weights = []
        for f in available_fonts:
            w = fonts_config.get(f, 5)
            if w > 0:
                candidates.append(f)
                weights.append(w)

        if not candidates:
            return random.choice(available_fonts) if available_fonts else None
        return random.choices(candidates, weights=weights, k=1)[0]

    def _draw_line(self, img, text, font_pool, size, x, y, phys, base_color):
        shake = phys['shakiness']
        opacity_val = phys['opacity']
        slant = phys['slant']
        max_kern = int(phys['kerning'])
        height_var = phys.get('height_variation', 0)
        width_var = phys.get('width_variation', 0)
        distortion = phys.get('distortion', 0)
        # Апскейл фона под печать: дрожь и дрейф заданы в пикселях, их надо тянуть
        # вместе с масштабом. Углы поворота/наклона безразмерны и не трогаются.
        px_scale = phys.get('scale', 1.0)

        cursor_x = x
        scale_factor = 2  # было 3 — экономим ~35% пикселей на символ

        # Наклон строки (line drift) — постепенный дрейф Y
        tilt_rate = random.uniform(-0.2, 0.2) * px_scale  # пикс/символ
        char_idx = 0

        for char in text:
            if char == ' ':
                temp_f = self._get_cached_font(font_pool[0], size)
                cursor_x += temp_f.getlength(' ') + random.randint(0, int(max_kern/2+1))
                char_idx += 1
                continue

            current_font_name = random.choice(font_pool)
            font = self._get_cached_font(current_font_name, size)

            # === ДАВЛЕНИЕ ПЕРА ===
            # Раньше нажим моделировался альфой (~210), из-за чего ВСЁ тело штриха
            # становилось светлым полутоном. Альфа схлопывается у нас же в
            # alpha_composite, до принтера доходит плоский RGB — и такой полутон
            # печатается растровой сеткой точек, которой у настоящей пасты нет.
            # Теперь ядро штриха непрозрачное (принтер кладёт сплошную заливку),
            # а нажим меняет насыщенность чернил. Полутона остаются только на
            # сглаженных краях глифа — там они тонкие и в глаза не бросаются.
            pressure = 0.55 + (opacity_val / 10.0) * 0.45
            pressure = max(0.35, min(1.0, pressure + random.uniform(-0.10, 0.06)))
            ink = vary_color(base_color, variance=15)
            current_color = tuple(int(round(255 - (255 - c) * pressure)) for c in ink)
            alpha = 255

            h_factor = 1.0 + random.uniform(-height_var/100, height_var/100)
            w_factor = 1.0 + random.uniform(-width_var/100, width_var/100)

            orig_size = int(size * 2.5)
            c_size = orig_size * scale_factor
            big_font = self._get_cached_font(current_font_name, size * scale_factor)
            if not big_font: big_font = font

            # Небольшой буфер для трансформаций (1.1× вместо прежних 1.2×)
            canvas_size = int(c_size * 1.1)
            char_img = Image.new('RGBA', (canvas_size, canvas_size), (255,255,255,0))
            draw = ImageDraw.Draw(char_img)
            draw.text((canvas_size//4, canvas_size//4), char, font=big_font,
                      fill=(*current_color, alpha), stroke_width=0)

            # Деформация — лёгкий AFFINE вместо numpy perspective (быстрее, без numpy.linalg)
            if distortion > 0:
                max_d = (distortion / 100.0) * 0.18
                sx = random.uniform(-max_d, max_d)           # сдвиг X
                sy = 1.0 + random.uniform(-max_d * 0.5, max_d * 0.5)  # масштаб Y
                cx = canvas_size / 2
                char_img = char_img.transform(
                    (canvas_size, canvas_size), Image.AFFINE,
                    (1, sx, -cx * sx, 0, sy, (1 - sy) * canvas_size / 4),
                    resample=Image.BICUBIC
                )

            # Slant + Rotation объединены в один AFFINE (было 2 трансформации → стало 1)
            shear = slant * 0.1 + random.uniform(-0.02, 0.02)
            ang = math.radians(random.uniform(-shake * 1.2, shake * 1.2))
            cos_a, sin_a = math.cos(ang), math.sin(ang)
            ma = cos_a + shear * sin_a
            mb = -sin_a + shear * cos_a
            md = sin_a
            me = cos_a
            cx = cy = canvas_size / 2
            char_img = char_img.transform(
                (canvas_size, canvas_size), Image.AFFINE,
                (ma, mb, cx*(1-ma) - cy*mb, md, me, cy*(1-me) - cx*md),
                resample=Image.BICUBIC
            )

            # Resize до финального размера с вариацией высоты/ширины — один раз вместо двух
            final_w = max(1, int(orig_size * w_factor))
            final_h = max(1, int(orig_size * h_factor))
            char_img = char_img.resize((final_w, final_h), resample=Image.LANCZOS)
            if final_w != orig_size or final_h != orig_size:
                tmp = Image.new('RGBA', (orig_size, orig_size), (255, 255, 255, 0))
                ox = (orig_size - final_w) // 2
                oy = (orig_size - final_h) // 2
                paste_x = max(0, ox)
                paste_y = max(0, oy)
                crop_x = max(0, -ox)
                crop_y = max(0, -oy)
                crop_w = min(final_w - crop_x, orig_size - paste_x)
                crop_h = min(final_h - crop_y, orig_size - paste_y)
                if crop_w > 0 and crop_h > 0:
                    region = char_img.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))
                    tmp.paste(region, (paste_x, paste_y), region)
                char_img = tmp

            # Jitter + наклон строки
            y_off = random.uniform(-shake * 0.6, shake * 0.6) * px_scale
            char_idx += 1
            y_tilt = tilt_rate * char_idx

            img.paste(char_img, (int(cursor_x - orig_size//4), int(y + y_off + y_tilt - orig_size//4)), char_img)

            # Kerning + Overlap (увеличен для лигатур/соединений букв)
            char_w = font.getlength(char)
            overlap = char_w * 0.14  # было 0.08
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


    def _fit_and_draw_clean(self, img, text, font_pool, max_size, zone, color):
        """Renders text cleanly without any handwriting simulation."""
        draw = ImageDraw.Draw(img)
        w_box, h_box = zone['width'], zone['height']
        x_start, y_start = zone['x'], zone['y']

        size = max_size
        final_lines = []

        while size >= 8:
            font = self._get_cached_font(font_pool[0], size)
            if not font: break
            lines = wrap_text(text, font, w_box)
            if not lines: break
            ascent, descent = font.getmetrics()
            line_h = ascent + descent
            if len(lines) * line_h <= h_box:
                final_lines = lines
                break
            size -= 2

        if not final_lines: return

        font = self._get_cached_font(font_pool[0], size)
        ascent, descent = font.getmetrics()
        line_h = ascent + descent
        total_h = len(final_lines) * line_h
        curr_y = y_start + (h_box - total_h) / 2

        for line in final_lines:
            draw.text((x_start, curr_y), line, font=font, fill=(*color, 255))
            curr_y += line_h

    def _set_seed(self, row, index, global_seed):
        id_val = None
        if isinstance(row, dict):
            for k in row.keys():
                if str(k).strip().lower() == 'id':
                    id_val = row[k]
                    break

        if id_val is not None and str(id_val).strip() != "":
            seed_str = f"{id_val}_{global_seed}"
        else:
            seed_str = f"row_{index}_{global_seed}"

        hash_obj = hashlib.md5(seed_str.encode('utf-8'))
        seed_int = int(hash_obj.hexdigest(), 16) % (2**32)
        random.seed(seed_int)


    def process(self, img_path, df_row, config_json, row_index=0, for_print=True):
        try:
            base_img = Image.open(img_path).convert("RGBA")
        except: return None

        cfg = json.loads(config_json)
        glo = cfg['globals']
        zones = cfg['zones']

        # === МАСШТАБ ПОД ПЕЧАТЬ ===
        # Фон не всегда удаётся достать в хорошем разрешении. Скан на 96 dpi даёт
        # штрих толщиной ~3 пикселя — на бумаге это каша, и никакой шрифт не спасёт.
        # Поэтому апскейлим фон до целевого DPI и рисуем текст сразу в нём: линии
        # бланка останутся мягкими (выглядит как ксерокопия — что нормально),
        # но сами чернила будут с настоящим печатным разрешением.
        # Превью считаем в исходном разрешении: апскейл до 300 dpi даёт 9× пикселей
        # и делает интерактивную настройку неюзабельной. На вид результат тот же.
        src_dpi = self._detect_dpi(img_path, base_img.size)
        target_dpi = float(glo.get('print_dpi', 300) or 300)
        scale = max(1.0, min(MAX_UPSCALE, target_dpi / src_dpi)) if for_print else 1.0
        out_dpi = src_dpi * scale

        if scale > 1.001:
            # BICUBIC, а не LANCZOS: на сканах ланцош даёт звон по краям линий
            base_img = base_img.resize(
                (max(1, int(round(base_img.width * scale))),
                 max(1, int(round(base_img.height * scale)))),
                resample=Image.BICUBIC
            )
            zones = [dict(z, x=z['x'] * scale, y=z['y'] * scale,
                          width=z['width'] * scale, height=z['height'] * scale,
                          size=(z['size'] * scale) if z.get('size') else z.get('size'))
                     for z in zones]

        txt_layer = Image.new('RGBA', base_img.size, (255,255,255,0))

        font_type = glo.get('fontType', 'handwriting')
        self._font_type = font_type

        # Apply paint patches to base image before text rendering
        patches = cfg.get('patches', [])
        if patches:
            patch_draw = ImageDraw.Draw(base_img)
            for p in patches:
                px, py = int(p['x'] * scale), int(p['y'] * scale)
                pw, ph = int(p['w'] * scale), int(p['h'] * scale)
                pc = self._hex_to_rgb(p.get('color', '#FFFFFF'))
                patch_draw.rectangle([px, py, px + pw, py + ph], fill=(*pc, 255))

        project_seed = glo.get('seed', 'default')
        self._set_seed(df_row, row_index, project_seed)

        avail = self.get_fonts(font_type)
        if not avail:
            return self._tag_dpi(Image.alpha_composite(base_img, txt_layer), out_dpi)

        fonts_cfg = glo.get('fonts_config', {})

        doc_font_name = None
        active_pool = [f for f, w in fonts_cfg.items() if w > 0]
        if not active_pool: active_pool = [avail[0]]

        if glo['font'] == 'random_per_doc':
            doc_font_name = self._pick_weighted_font(avail, fonts_cfg)
        elif glo['font'] != 'random' and glo['font'] in avail:
            doc_font_name = glo['font']

        doc_base_size = int(self._get_val(glo.get('size', 20)) * scale)

        # Всё, что задано в пикселях, тянется вместе с масштабом; безразмерные
        # параметры (наклон, дрожь, вариации в процентах) остаются как есть.
        doc_phys = {
            'shakiness': self._get_val(glo.get('shakiness', 0)),
            'scale':     scale,
            'opacity':   self._get_val(glo.get('opacity', 8)),
            'kerning':   self._get_val(glo.get('kerning', 0)) * scale,
            'slant':     self._get_val(glo.get('slant', 0)),
            'blur':      self._get_val(glo.get('blur', 0)) * scale,
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

            source_type = z.get('sourceType', 'excel')
            content_key = z.get('content', '')

            txt = ""
            if source_type == 'text':
                txt = str(content_key)
            else:
                txt = str(df_row.get(content_key, ""))

            if not txt: continue

            if font_type == 'system':
                self._fit_and_draw_clean(txt_layer, txt, zone_font_pool, size, z, doc_color)
            else:
                self._fit_and_draw(txt_layer, txt, zone_font_pool, size, z, doc_phys, doc_color)

        # Blur применяется ко всему RGBA слою — мягкие края + чернильный след
        # Радиус откалиброван под layer-уровень (делим на 6, а не на 3)
        if doc_phys['blur'] > 0:
            txt_layer = txt_layer.filter(ImageFilter.GaussianBlur(radius=doc_phys['blur'] / 6.0))

        out = Image.alpha_composite(base_img, txt_layer)
        return self._tag_dpi(out, out_dpi)

    def _tag_dpi(self, img, dpi):
        """Прикрепляет DPI к изображению — batch() по нему считает физический размер."""
        img.info['dpi'] = (dpi, dpi)
        return img

    def preview(self, img_path, config_json, df):
        if df is not None and not df.empty:
            row = df.iloc[0].to_dict()
            idx = 0
        else:
            cfg = json.loads(config_json)
            # Без таблицы подставляем в поле имя самой колонки, чтобы было что показать.
            # Раньше здесь читался z['column'] — такого ключа у зон нет (есть 'content'),
            # и превью без загруженного Excel падало с KeyError.
            row = {z.get('content', ''): z.get('content', '') for z in cfg['zones']}
            row['ID'] = 'PREVIEW'
            idx = 0
        return self.process(img_path, row, config_json, row_index=idx, for_print=False)

    def _detect_dpi(self, img_path, size):
        return detect_dpi(img_path)

    def batch(self, bg_source, df, config_json, cb_prog, cb_done):
        if isinstance(bg_source, str): bg_list = [bg_source]
        else: bg_list = bg_source
        self.is_running = True
        total = len(df)
        if not os.path.exists(OUTPUT_FOLDER): os.makedirs(OUTPUT_FOLDER)
        bg_count = len(bg_list)

        try:
            glo = json.loads(config_json).get('globals', {})
        except Exception:
            glo = {}
        # Печать: PNG без потерь по умолчанию. JPEG q75/4:2:0 (прежний дефолт Pillow)
        # давал ringing вокруг штрихов и расплывание цвета — на бумаге это читается как печать.
        fmt = str(glo.get('output_format', 'png')).lower()
        make_pdf = glo.get('output_pdf', True)

        pages = []
        for counter, (idx, row) in enumerate(df.iterrows()):
            if not self.is_running: break
            try:
                current_bg_path = bg_list[counter % bg_count]
                row_dict = row.to_dict()
                img = self.process(current_bg_path, row_dict, config_json, row_index=counter)
                if img:
                    # process() уже проставил итоговый DPI (с учётом апскейла под печать)
                    dpi = img.info.get('dpi', (300, 300))[0]
                    flat = img.convert("RGB")
                    if fmt in ('jpg', 'jpeg'):
                        path = os.path.join(OUTPUT_FOLDER, f"doc_{counter+1}.jpg")
                        # subsampling=0 обязателен: 4:2:0 убивает тонкие цветные штрихи
                        flat.save(path, quality=97, subsampling=0, dpi=(dpi, dpi))
                    else:
                        path = os.path.join(OUTPUT_FOLDER, f"doc_{counter+1}.png")
                        flat.save(path, dpi=(dpi, dpi))
                    pages.append((path, img.size, dpi))
                if cb_prog: cb_prog(counter+1, total)
            except Exception as e:
                print(f"Err row {counter}: {e}")

        if make_pdf and pages:
            try:
                self._build_pdf(pages)
            except Exception as e:
                print(f"PDF build failed: {e}")

        self.font_cache.clear()
        self.is_running = False
        if cb_done: cb_done()

    def _build_pdf(self, pages):
        """Собирает print_ready.pdf: каждая страница в точном физическом размере.

        PDF несёт физические размеры, поэтому принтер печатает 1:1 и не делает
        повторной передискретизации «вписать в страницу» поверх готового растра.
        """
        import fitz
        a4_w, a4_h = A4_INCHES[0] * 72.0, A4_INCHES[1] * 72.0
        doc = fitz.open()
        for path, size, dpi in pages:
            w_pt = size[0] / dpi * 72.0
            h_pt = size[1] / dpi * 72.0

            # Скан редко попадает в A4 идеально. Если размер близок — делаем страницу
            # ровно A4 и вписываем растр с сохранением пропорций по центру. Иначе это
            # сделает драйвер принтера («вписать в лист») и передискретизирует всё ещё раз.
            if abs(w_pt - a4_w) / a4_w < 0.05 and abs(h_pt - a4_h) / a4_h < 0.05:
                page = doc.new_page(width=a4_w, height=a4_h)
                k = min(a4_w / w_pt, a4_h / h_pt)
                fw, fh = w_pt * k, h_pt * k
                rect = fitz.Rect((a4_w - fw) / 2, (a4_h - fh) / 2,
                                 (a4_w + fw) / 2, (a4_h + fh) / 2)
            else:
                page = doc.new_page(width=w_pt, height=h_pt)
                rect = fitz.Rect(0, 0, w_pt, h_pt)

            page.insert_image(rect, filename=path)
        out = os.path.join(OUTPUT_FOLDER, "print_ready.pdf")
        doc.save(out, deflate=True)
        doc.close()
        print(f"PDF готов: {out}")

    def stop(self): self.is_running = False
