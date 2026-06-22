#!/usr/bin/env python3
# Пересборка data/cities-ref.js — плотного справочника городов для карты (LOD-слой «Города»).
#
# Источник: GeoNames (CC-BY). Нужны два дампа в текущей папке:
#   1) cities15000.txt          — https://download.geonames.org/export/dump/cities15000.zip  (~3 МБ)
#   2) alternateNamesV2.txt     — https://download.geonames.org/export/dump/alternateNamesV2.zip (~200 МБ)
# Распаковать оба, затем:  python3 build-cities-ref.py
# Результат cities-ref.js скопировать в ../data/cities-ref.js и поднять ?v=N в index.html.
#
# Имя города — русское (isolanguage=ru, предпочтительное; без исторических/разговорных),
# иначе латиница из поля name. Формат строки: [name, lat, lon, pop_k] (население в тысячах),
# сортировка по населению по убыванию (нужно для LOD: крупные рассматриваются первыми).
import json, io

# 1) города
cities = []          # (gid, name_latin, lat, lon, pop)
ids = set()
with io.open('cities15000.txt', encoding='utf-8') as f:
    for line in f:
        c = line.rstrip('\n').split('\t')
        if len(c) < 15:
            continue
        try:
            gid = c[0]
            lat = round(float(c[4]), 2); lon = round(float(c[5]), 2)
            pop = int(c[14] or 0)
        except ValueError:
            continue
        name = c[1].strip()
        if not name or pop <= 0:
            continue
        cities.append((gid, name, lat, lon, pop))
        ids.add(gid)

# 2) русские имена по geonameid
ru = {}
ru_pref = set()
with io.open('alternateNamesV2.txt', encoding='utf-8') as f:
    for line in f:
        c = line.split('\t')
        if len(c) < 4 or c[2] != 'ru':
            continue
        gid = c[1]
        if gid not in ids:
            continue
        is_pref = (len(c) > 4 and c[4] == '1')
        is_collo = (len(c) > 6 and c[6] == '1')
        is_hist = (len(c) > 7 and c[7] == '1')
        if is_collo or is_hist:
            continue
        nm = c[3].strip()
        if not nm or gid in ru_pref:
            continue
        if is_pref:
            ru[gid] = nm; ru_pref.add(gid)
        elif gid not in ru:
            ru[gid] = nm

# 3) сборка
rows = [[ru.get(gid, name), lat, lon, max(1, round(pop / 1000))]
        for gid, name, lat, lon, pop in cities]
rows.sort(key=lambda r: r[3], reverse=True)

payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
out = ("/* Справочник городов для карты (GeoNames cities15000 + русские имена alternateNamesV2, CC-BY).\n"
       "   Формат: [name, lat, lon, pop_k] (население в тысячах); сортировка по населению по убыванию.\n"
       "   Только для отображения на карте (LOD при зуме), не для рекомендаций. Сборка: tools/build-cities-ref.py */\n"
       "(function(g){g.ACG_CITIES_REF=" + payload + ";})(typeof window!=='undefined'?window:this);\n")
with io.open('cities-ref.js', 'w', encoding='utf-8') as f:
    f.write(out)
print('городов:', len(rows), '| с рус. именем:', len(ru))
