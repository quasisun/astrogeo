/* ============================================================
   astro.js — Астрономический движок (сидерический зодиак, аянамша Лахири)
   Геоцентрические видимые долготы, RA/Dec для астрокартографии.
   Основано на кеплеровых элементах JPL (Standish) + усечённой
   лунной теории (Meeus) + средний лунный узел.
   Точность ~ доли градуса, достаточно для линий астрокартографии.
   ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180, RAD = 180 / Math.PI;
  function norm360(x){ x = x % 360; return x < 0 ? x + 360 : x; }
  function norm180(x){ x = norm360(x); return x > 180 ? x - 360 : x; }
  function sind(d){ return Math.sin(d*DEG); }
  function cosd(d){ return Math.cos(d*DEG); }
  function tand(d){ return Math.tan(d*DEG); }

  /* ---------- Юлианская дата из UTC ---------- */
  function julianDay(y, m, d, hour) {
    // hour = десятичные часы UTC
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    var jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
             + d + B - 1524.5 + hour / 24;
    return jd;
  }

  /* ---------- Среднее звёздное время по Гринвичу (град) ---------- */
  function gmst(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    return norm360(g);
  }

  /* ---------- Наклон эклиптики (град) ---------- */
  function obliquity(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  }

  /* ---------- Аянамша Лахири (Читрапакша), град ---------- */
  function lahiriAyanamsha(jd) {
    // Опорное: J2000.0 -> 23.853°, прецессия ~50.2879"/год.
    var years = (jd - 2451545.0) / 365.25;
    return 23.85250 + 0.013971 * years;
  }

  /* ---------- Кеплеровы элементы планет (J2000, Standish) ----------
     [a(AU), e, i(deg), L(deg), longPeri(deg), longNode(deg)]
     и их скорости в столетие. Земля используется для Солнца и геоцентрики. */
  var ELEM = {
    Mercury: [0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593,
              0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081],
    Venus:   [0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255,
              0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418],
    Earth:   [1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0,
              0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0],
    Mars:    [1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891,
              0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343],
    Jupiter: [5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909,
              -0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106],
    Saturn:  [9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448,
              -0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794],
    Uranus:  [19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503,
              -0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589],
    Neptune: [30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574,
              0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664],
    Pluto:   [39.48211675,0.24882730,17.14001206,238.92903833,224.06891629,110.30393684,
              -0.00031596,0.00005170,0.00004818,145.20780515,-0.04062942,-0.01183482]
  };

  function solveKepler(M, e) {
    M = M * DEG;
    var E = M + e * Math.sin(M);
    for (var i = 0; i < 8; i++) {
      var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    return E; // радианы
  }

  // Гелиоцентрические прямоугольные координаты в эклиптике J2000
  function heliocentric(name, T) {
    var el = ELEM[name];
    var a = el[0] + el[6]*T, e = el[1] + el[7]*T, I = el[2] + el[8]*T;
    var L = el[3] + el[9]*T, wbar = el[4] + el[10]*T, Om = el[5] + el[11]*T;
    var w = wbar - Om;           // аргумент перигелия
    var M = norm180(L - wbar);   // средняя аномалия
    var E = solveKepler(M, e);
    var xp = a * (Math.cos(E) - e);
    var yp = a * Math.sqrt(1 - e*e) * Math.sin(E);
    // в эклиптические координаты
    var cw = cosd(w), sw = sind(w), cO = cosd(Om), sO = sind(Om), cI = cosd(I), sI = sind(I);
    var x = (cw*cO - sw*sO*cI) * xp + (-sw*cO - cw*sO*cI) * yp;
    var y = (cw*sO + sw*cO*cI) * xp + (-sw*sO + cw*cO*cI) * yp;
    var z = (sw*sI) * xp + (cw*sI) * yp;
    return [x, y, z];
  }

  /* ---------- Луна: усечённая теория (Meeus, главные члены) ---------- */
  function moonEcliptic(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var Lp = norm360(218.3164477 + 481267.88123421*T - 0.0015786*T*T);
    var D  = norm360(297.8501921 + 445267.1114034*T - 0.0018819*T*T);
    var M  = norm360(357.5291092 + 35999.0502909*T);
    var Mp = norm360(134.9633964 + 477198.8675055*T + 0.0087414*T*T);
    var F  = norm360(93.2720950 + 483202.0175233*T - 0.0036539*T*T);
    var lon = Lp
      + 6.288774*sind(Mp) + 1.274027*sind(2*D-Mp) + 0.658314*sind(2*D)
      + 0.213618*sind(2*Mp) - 0.185116*sind(M) - 0.114332*sind(2*F)
      + 0.058793*sind(2*D-2*Mp) + 0.057066*sind(2*D-M-Mp)
      + 0.053322*sind(2*D+Mp) + 0.045758*sind(2*D-M)
      - 0.040923*sind(M-Mp) - 0.034720*sind(D) - 0.030383*sind(M+Mp)
      + 0.015327*sind(2*D-2*F) - 0.012528*sind(Mp+2*F) + 0.010980*sind(Mp-2*F);
    var lat =
      5.128122*sind(F) + 0.280602*sind(Mp+F) + 0.277693*sind(Mp-F)
      + 0.173237*sind(2*D-F) + 0.055413*sind(2*D-Mp+F) + 0.046271*sind(2*D-Mp-F)
      + 0.032573*sind(2*D+F) + 0.017198*sind(2*Mp+F);
    return { lon: norm360(lon), lat: lat };
  }

  /* ---------- Средний лунный узел (Раху), град ---------- */
  function meanNode(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var Om = 125.0445479 - 1934.1362891*T + 0.0020754*T*T
             + (T*T*T)/467441 - (T*T*T*T)/60616000;
    return norm360(Om);
  }

  /* ---------- эклиптические lon/lat -> RA/Dec (град) ---------- */
  function eclToEq(lon, lat, eps) {
    var sl = sind(lon), cl = cosd(lon), sb = sind(lat), cb = cosd(lat);
    var se = sind(eps), ce = cosd(eps);
    var ra = Math.atan2(sl*ce - (sb/cb)*se, cl) * RAD;
    var dec = Math.asin(sb*ce + cb*se*sl) * RAD;
    return { ra: norm360(ra), dec: dec };
  }

  // прямоугольные геоцентрические эклиптические (J2000) -> lon/lat
  function rectToEcl(v) {
    var lon = norm360(Math.atan2(v[1], v[0]) * RAD);
    var lat = Math.atan2(v[2], Math.sqrt(v[0]*v[0] + v[1]*v[1])) * RAD;
    return { lon: lon, lat: lat, r: Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) };
  }

  var PLANET_ORDER = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu','Uranus','Neptune','Pluto'];

  /* ---------- Главная функция: позиции всех тел на момент jd (UTC) ---------- */
  function computeBodies(jd, includeOuter) {
    var T = (jd - 2451545.0) / 36525.0;
    var eps = obliquity(jd);
    var ayan = lahiriAyanamsha(jd);
    var earth = heliocentric('Earth', T);
    var result = {};

    function add(name, ecl) {
      var eq = eclToEq(ecl.lon, ecl.lat || 0, eps);
      var sidLon = norm360(ecl.lon - ayan);
      result[name] = {
        name: name,
        tropLon: ecl.lon,
        sidLon: sidLon,
        lat: ecl.lat || 0,
        ra: eq.ra, dec: eq.dec
      };
    }

    // Солнце: геоцентрический вектор = -Земля
    add('Sun', rectToEcl([-earth[0], -earth[1], -earth[2]]));

    // Луна
    var moon = moonEcliptic(jd);
    add('Moon', moon);

    // Планеты (геоцентрика = гелио_планета - гелио_Земля)
    ['Mercury','Venus','Mars','Jupiter','Saturn'].forEach(function(p){
      var h = heliocentric(p, T);
      add(p, rectToEcl([h[0]-earth[0], h[1]-earth[1], h[2]-earth[2]]));
    });

    if (includeOuter) {
      ['Uranus','Neptune','Pluto'].forEach(function(p){
        var h = heliocentric(p, T);
        add(p, rectToEcl([h[0]-earth[0], h[1]-earth[1], h[2]-earth[2]]));
      });
    }

    // Узлы (на эклиптике, lat=0)
    var rahu = meanNode(jd);
    add('Rahu', { lon: rahu, lat: 0 });
    add('Ketu', { lon: norm360(rahu + 180), lat: 0 });

    result._meta = { jd: jd, eps: eps, ayanamsha: ayan, gmst: gmst(jd) };
    return result;
  }

  /* ---------- Асцендент для натальной карты (для справки) ---------- */
  function ascendant(jd, lonE, latN) {
    var eps = obliquity(jd);
    var lst = norm360(gmst(jd) + lonE); // град
    var ramc = lst;
    var asc = Math.atan2(cosd(ramc), -(sind(ramc)*cosd(eps) + tand(latN)*sind(eps))) * RAD;
    return norm360(asc);
  }

  /* ---------- Знаки и накшатры ---------- */
  var SIGNS = ['Овен','Телец','Близнецы','Рак','Лев','Дева','Весы','Скорпион','Стрелец','Козерог','Водолей','Рыбы'];
  var NAKSHATRAS = ['Ашвини','Бхарани','Криттика','Рохини','Мригашира','Ардра','Пунарвасу','Пушья','Ашлеша',
    'Магха','Пурва Пхалгуни','Уттара Пхалгуни','Хаста','Читра','Свати','Вишакха','Анурадха','Джьештха',
    'Мула','Пурва Ашадха','Уттара Ашадха','Шравана','Дхаништха','Шатабхиша','Пурва Бхадрапада','Уттара Бхадрапада','Ревати'];

  function signOf(sidLon){ return SIGNS[Math.floor(norm360(sidLon)/30)]; }
  function signIndex(sidLon){ return Math.floor(norm360(sidLon)/30); }
  function degInSign(sidLon){ return norm360(sidLon) % 30; }
  function nakshatraOf(sidLon){
    var idx = Math.floor(norm360(sidLon) / (360/27));
    var pada = Math.floor((norm360(sidLon) % (360/27)) / (360/108)) + 1;
    return { name: NAKSHATRAS[idx], index: idx, pada: pada };
  }

  global.Astro = {
    julianDay: julianDay,
    gmst: gmst,
    obliquity: obliquity,
    lahiriAyanamsha: lahiriAyanamsha,
    computeBodies: computeBodies,
    ascendant: ascendant,
    signOf: signOf, signIndex: signIndex, degInSign: degInSign,
    nakshatraOf: nakshatraOf,
    SIGNS: SIGNS, NAKSHATRAS: NAKSHATRAS,
    PLANET_ORDER: PLANET_ORDER,
    norm180: norm180, norm360: norm360
  };
})(typeof window !== 'undefined' ? window : globalThis);
