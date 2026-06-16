#!/usr/bin/env python3
# ============================================================
#  server.py — статика + точный Swiss Ephemeris (Moshier, без файлов)
#  Эндпоинт /api/chart отдаёт сидерические позиции (аянамша Лахири),
#  RA/Dec, аянамшу и звёздное время для астрокартографии.
#  Если pyswisseph недоступен — эндпоинт вернёт 503, и фронтенд
#  автоматически перейдёт на встроенный JS-движок.
# ============================================================
import os, json, ssl, urllib.request, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

GEO_UA = 'JyotishACG/1.0 (personal astrology tool; contact kreuzersvetlana@gmail.com)'

# SSL-контекст с корневыми сертификатами (macOS Python.org не ставит их системно)
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:                       # noqa
    SSL_CTX = ssl._create_unverified_context()

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 7899

try:
    import swisseph as swe
    SWE_OK = True
    swe.set_sid_mode(swe.SIDM_LAHIRI, 0, 0)
    FLG = swe.FLG_MOSEPH | swe.FLG_SPEED      # Moshier — без файлов эфемерид
except Exception as e:                         # noqa
    SWE_OK = False
    SWE_ERR = str(e)

# имя -> id планеты Swiss Ephemeris
BODIES = [
    ('Sun', 0), ('Moon', 1), ('Mars', 4), ('Mercury', 2),
    ('Jupiter', 5), ('Venus', 3), ('Saturn', 6),
]
OUTER = [('Uranus', 7), ('Neptune', 8), ('Pluto', 9)]


def norm360(x):
    x = x % 360.0
    return x + 360 if x < 0 else x


def compute_chart(y, mo, d, ut, outer=False):
    """ut — десятичные часы UTC. Возвращает структуру для фронтенда."""
    jd = swe.julday(y, mo, d, ut, swe.GREG_CAL)
    ayan = swe.get_ayanamsa_ut(jd)
    # истинный наклон эклиптики
    eps = swe.calc_ut(jd, swe.ECL_NUT, swe.FLG_MOSEPH)[0][0]
    # гринвичское звёздное время (часы -> градусы)
    gmst = norm360(swe.sidtime(jd) * 15.0)

    result = {}

    def add(name, lon_trop, lat, ra, dec):
        result[name] = {
            'name': name,
            'tropLon': norm360(lon_trop),
            'sidLon': norm360(lon_trop - ayan),
            'lat': lat, 'ra': norm360(ra), 'dec': dec,
        }

    seq = BODIES + (OUTER if outer else [])
    for name, pid in seq:
        trop, _ = swe.calc_ut(jd, pid, FLG)              # тропическая эклиптика
        eq, _ = swe.calc_ut(jd, pid, FLG | swe.FLG_EQUATORIAL)  # RA/Dec
        add(name, trop[0], trop[1], eq[0], eq[1])

    # Узлы: средний узел (Раху), Кету = +180
    node, _ = swe.calc_ut(jd, swe.MEAN_NODE, FLG)
    node_eq, _ = swe.calc_ut(jd, swe.MEAN_NODE, FLG | swe.FLG_EQUATORIAL)
    add('Rahu', node[0], 0.0, node_eq[0], node_eq[1])
    # Кету — противоположная точка; RA/Dec пересчитываем через эклиптику
    ket_lon = norm360(node[0] + 180)
    # точка на эклиптике (lat=0) -> RA/Dec
    import math
    rad = math.pi / 180
    sl, cl = math.sin(ket_lon * rad), math.cos(ket_lon * rad)
    se, ce = math.sin(eps * rad), math.cos(eps * rad)
    ket_ra = math.atan2(sl * ce, cl) / rad
    ket_dec = math.asin(se * sl) / rad
    add('Ketu', ket_lon, 0.0, ket_ra, ket_dec)

    return {
        'engine': 'Swiss Ephemeris (Moshier)',
        'meta': {'jd': jd, 'eps': eps, 'ayanamsha': ayan, 'gmst': gmst},
        'bodies': result,
    }


def geocode(query, lang='ru'):
    """Поиск любого населённого пункта через OpenStreetMap / Nominatim."""
    params = urllib.parse.urlencode({
        'q': query, 'format': 'jsonv2', 'limit': '8',
        'addressdetails': '1', 'accept-language': lang,
    })
    url = 'https://nominatim.openstreetmap.org/search?' + params
    req = urllib.request.Request(url, headers={'User-Agent': GEO_UA})
    with urllib.request.urlopen(req, timeout=12, context=SSL_CTX) as r:
        data = json.loads(r.read().decode('utf-8'))
    import re
    prefixes = ('городской округ ', 'муниципальное образование ', 'сельское поселение ',
                'городское поселение ', 'посёлок городского типа ', 'полярная станция ',
                'деревня ', 'село ', 'посёлок ', 'город ')
    def clean(s):
        s = (s or '').strip()
        low = s.lower()
        for p in prefixes:
            if low.startswith(p):
                return s[len(p):]
        return s
    out = []
    for it in data:
        adr = it.get('address', {})
        name = (it.get('name') or adr.get('city') or adr.get('town') or adr.get('village')
                or adr.get('hamlet') or adr.get('municipality')
                or it.get('display_name', '').split(',')[0])
        name = clean(name)
        region = adr.get('state') or adr.get('region') or adr.get('county') or ''
        country = adr.get('country') or ''
        try:
            lat = float(it['lat']); lon = float(it['lon'])
        except (KeyError, ValueError):
            continue
        out.append({
            'name': name, 'region': region, 'country': country,
            'lat': lat, 'lon': lon, 'type': it.get('type', ''),
        })
    # убрать дубликаты по координатам
    seen, uniq = set(), []
    for o in out:
        key = (round(o['lat'], 3), round(o['lon'], 3))
        if key in seen:
            continue
        seen.add(key); uniq.append(o)
    return uniq


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass  # тише

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/chart':
            return self.handle_chart(parse_qs(parsed.query))
        if parsed.path == '/api/geocode':
            return self.handle_geocode(parse_qs(parsed.query))
        if parsed.path == '/api/health':
            return self.send_json({'swe': SWE_OK})
        return super().do_GET()

    def handle_geocode(self, q):
        query = (q.get('q', [''])[0] or '').strip()
        if len(query) < 2:
            return self.send_json([])
        try:
            return self.send_json(geocode(query))
        except Exception as e:  # noqa
            return self.send_json({'error': str(e)}, 502)

    def handle_chart(self, q):
        if not SWE_OK:
            return self.send_json({'error': 'pyswisseph недоступен', 'detail': SWE_ERR}, 503)
        try:
            y = int(q['y'][0]); mo = int(q['m'][0]); d = int(q['d'][0])
            ut = float(q['ut'][0])
            outer = q.get('outer', ['0'])[0] in ('1', 'yes', 'true')
            data = compute_chart(y, mo, d, ut, outer)
            return self.send_json(data)
        except Exception as e:  # noqa
            return self.send_json({'error': str(e)}, 400)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print(f'Jyotish ACG server → http://localhost:{PORT}  (Swiss Ephemeris: {SWE_OK})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
