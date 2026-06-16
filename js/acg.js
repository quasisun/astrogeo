/* ============================================================
   acg.js — Астрокартография: расчёт планетных линий на Земле
   MC/IC — меридианы кульминации; ASC/DSC — кривые восхода/захода.
   Использует RA/Dec тел и GMST момента рождения.
   ============================================================ */
(function (global) {
  'use strict';
  var DEG = Math.PI/180, RAD = 180/Math.PI;
  var norm180 = global.Astro.norm180, norm360 = global.Astro.norm360;
  function tand(d){return Math.tan(d*DEG);}

  // Линии для угловых тел; узлы и Солнце тоже строятся.
  // type: MC, IC, ASC, DSC
  function lineLongitudeMC(ra, gmst){ return norm180(ra - gmst); }

  // ASC/DSC кривая: для каждой широты считаем долготу пересечения горизонта
  function risingSettingCurve(ra, dec, gmst, type) {
    var pts = [];
    for (var lat = -84; lat <= 84; lat += 1.0) {
      var c = -tand(lat) * tand(dec);
      if (c < -1 || c > 1) { pts.push(null); continue; } // циркумполярно — нет события
      var H = Math.acos(c) * RAD; // 0..180
      var lon;
      if (type === 'ASC') lon = norm180(ra - H - gmst); // восход (восточный горизонт)
      else                lon = norm180(ra + H - gmst); // заход
      pts.push([lon, lat]);
    }
    return pts;
  }

  // Разрывает кривую по антимеридиану (скачок долготы > 180) на сегменты
  function splitSegments(pts) {
    var segs = [], cur = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p === null) { if (cur.length) { segs.push(cur); cur = []; } continue; }
      if (cur.length) {
        var prev = cur[cur.length-1];
        if (Math.abs(p[0] - prev[0]) > 180) { segs.push(cur); cur = []; }
      }
      cur.push(p);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  // Цвета планет (единые по всему приложению)
  var COLORS = {
    Sun:'#C00000', Moon:'#5BB8E8', Mars:'#FF2A2A', Mercury:'#1FA84F',
    Jupiter:'#E5A300', Venus:'#FF6FB5', Saturn:'#1F3A93', Rahu:'#5C5C7A',
    Ketu:'#8A5A2B', Uranus:'#7B49C9', Neptune:'#1FB6B6', Pluto:'#1A1A1A'
  };
  var GLYPH = {
    Sun:'☉', Moon:'☽', Mars:'♂', Mercury:'☿', Jupiter:'♃', Venus:'♀',
    Saturn:'♄', Rahu:'☊', Ketu:'☋', Uranus:'♅', Neptune:'♆', Pluto:'♇'
  };
  var NAME_RU = {
    Sun:'Солнце', Moon:'Луна', Mars:'Марс', Mercury:'Меркурий', Jupiter:'Юпитер',
    Venus:'Венера', Saturn:'Сатурн', Rahu:'Раху', Ketu:'Кету',
    Uranus:'Уран', Neptune:'Нептун', Pluto:'Плутон'
  };
  // родительный падеж («влияние Юпитера»)
  var NAME_GEN = {
    Sun:'Солнца', Moon:'Луны', Mars:'Марса', Mercury:'Меркурия', Jupiter:'Юпитера',
    Venus:'Венеры', Saturn:'Сатурна', Rahu:'Раху', Ketu:'Кету',
    Uranus:'Урана', Neptune:'Нептуна', Pluto:'Плутона'
  };
  var LINE_RU = { MC:'MC (Середина неба)', IC:'IC (Глубина неба)', ASC:'ASC (Восходящий)', DSC:'DSC (Заходящий)' };

  function buildLines(bodies, order) {
    var gmst = bodies._meta.gmst;
    var lines = [];
    (order || global.Astro.PLANET_ORDER).forEach(function(name){
      var b = bodies[name];
      if (!b) return;
      var lonMC = lineLongitudeMC(b.ra, gmst);
      var lonIC = norm180(lonMC + 180);
      // MC и IC — вертикальные меридианы
      lines.push({ planet:name, type:'MC', meridian:lonMC,
        segments:[[[lonMC,-85],[lonMC,85]]], color:COLORS[name], ra:b.ra, dec:b.dec });
      lines.push({ planet:name, type:'IC', meridian:lonIC,
        segments:[[[lonIC,-85],[lonIC,85]]], color:COLORS[name], ra:b.ra, dec:b.dec });
      // ASC / DSC — кривые
      lines.push({ planet:name, type:'ASC',
        segments: splitSegments(risingSettingCurve(b.ra, b.dec, gmst, 'ASC')),
        color:COLORS[name], ra:b.ra, dec:b.dec });
      lines.push({ planet:name, type:'DSC',
        segments: splitSegments(risingSettingCurve(b.ra, b.dec, gmst, 'DSC')),
        color:COLORS[name], ra:b.ra, dec:b.dec });
    });
    return lines;
  }

  /* ---------- Расстояние от точки (lat,lon) до линии в км ---------- */
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2-lat1)*DEG, dLon = (lon2-lon1)*DEG;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*DEG)*Math.cos(lat2*DEG)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function distToMeridian(lat, lon, meridian) {
    var dLon = Math.abs(norm180(lon - meridian));
    // расстояние до меридиана ~ по параллели
    return dLon * DEG * 6371 * Math.cos(lat*DEG);
  }

  function distToLine(lat, lon, line) {
    if (line.type === 'MC' || line.type === 'IC') {
      return distToMeridian(lat, lon, line.meridian);
    }
    var best = Infinity;
    for (var s = 0; s < line.segments.length; s++) {
      var seg = line.segments[s];
      for (var i = 0; i < seg.length; i++) {
        var d = haversine(lat, lon, seg[i][1], seg[i][0]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // Сила влияния линии в точке: 1 в центре, плавный спад с длинным «хвостом».
  // Сильная зона до ~orbKm, слабый шлейф до 2*orbKm — чтобы локации различались.
  function influence(distKm, orbKm) {
    orbKm = orbKm || 1400;
    if (distKm >= orbKm * 2) return 0;
    if (distKm <= orbKm) {
      var x = distKm / orbKm;          // сильная зона
      return 0.35 + 0.65 * Math.pow(1 - x, 1.3);
    }
    var y = (distKm - orbKm) / orbKm;  // слабый шлейф 0.35 -> 0
    return 0.35 * (1 - y);
  }

  global.ACG = {
    buildLines: buildLines,
    distToLine: distToLine,
    influence: influence,
    haversine: haversine,
    COLORS: COLORS, GLYPH: GLYPH, NAME_RU: NAME_RU, NAME_GEN: NAME_GEN, LINE_RU: LINE_RU
  };
})(typeof window !== 'undefined' ? window : globalThis);
