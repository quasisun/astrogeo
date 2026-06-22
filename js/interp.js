/* ============================================================
   interp.js — Джйотиш-интерпретации и движок оценки локаций
   Сидерические значения планет, аффинности к сферам жизни,
   генерация персонального текста на русском языке.
   ============================================================ */
(function (global) {
  'use strict';

  // Сферы жизни (ключ -> русское название)
  var AREAS = [
    ['career','Карьера'], ['business','Бизнес'], ['finance','Финансы'],
    ['love','Любовь'], ['marriage','Брак'], ['family','Семья'],
    ['health','Здоровье'], ['education','Образование'], ['creativity','Творчество'],
    ['spirituality','Духовность'], ['travel','Путешествия'], ['residence','ПМЖ'],
    ['remote','Удалёнка'], ['retirement','Отдых/пенсия']
  ];
  var AREA_KEYS = AREAS.map(function(a){return a[0];});
  var AREA_RU = {}; AREAS.forEach(function(a){AREA_RU[a[0]]=a[1];});

  /* Аффинность планеты к сфере: -1 (неблагоприятно) .. +1 (благоприятно).
     Закодированы традиционные тенденции Джйотиш. */
  var AFF = {
    Sun:     {career:.9,business:.3,finance:.3,love:-.3,marriage:-.4,family:.1,health:.5,education:.5,creativity:.2,spirituality:.3,travel:.1,residence:.2,remote:-.1,retirement:.0},
    Moon:    {career:.4,business:.2,finance:.2,love:.5,marriage:.4,family:.8,health:.3,education:.3,creativity:.7,spirituality:.5,travel:.4,residence:.7,remote:.2,retirement:.6},
    Mars:    {career:.6,business:.6,finance:.3,love:-.2,marriage:-.5,family:-.2,health:-.4,education:.2,creativity:.3,spirituality:.0,travel:.3,residence:-.2,remote:.1,retirement:-.3},
    Mercury: {career:.6,business:.9,finance:.7,love:.3,marriage:.2,family:.3,health:.2,education:.9,creativity:.6,spirituality:.3,travel:.5,residence:.3,remote:.9,retirement:.2},
    Jupiter: {career:.8,business:.7,finance:.9,love:.6,marriage:.9,family:.8,health:.6,education:.9,creativity:.6,spirituality:.9,travel:.6,residence:.7,remote:.4,retirement:.7},
    Venus:   {career:.5,business:.5,finance:.7,love:.95,marriage:.9,family:.6,health:.4,education:.5,creativity:.9,spirituality:.4,travel:.7,residence:.6,remote:.4,retirement:.8},
    Saturn:  {career:.3,business:.1,finance:.0,love:-.5,marriage:-.3,family:-.2,health:-.4,education:.3,creativity:-.2,spirituality:.6,travel:-.2,residence:.5,remote:.3,retirement:.7},
    Rahu:    {career:.5,business:.6,finance:.3,love:-.2,marriage:-.4,family:-.3,health:-.5,education:.3,creativity:.4,spirituality:-.1,travel:.7,residence:.2,remote:.7,retirement:-.2},
    Ketu:    {career:-.3,business:-.4,finance:-.4,love:-.5,marriage:-.5,family:-.3,health:-.3,education:.3,creativity:.3,spirituality:.95,travel:.2,residence:-.2,remote:.3,retirement:.3},
    Uranus:  {career:.2,business:.3,finance:.1,love:-.2,marriage:-.3,family:-.1,health:-.1,education:.4,creativity:.7,spirituality:.4,travel:.5,residence:-.1,remote:.8,retirement:.1},
    Neptune: {career:.0,business:-.2,finance:-.3,love:.4,marriage:.1,family:.2,health:-.2,education:.3,creativity:.8,spirituality:.8,travel:.4,residence:.2,remote:.4,retirement:.5},
    Pluto:   {career:.5,business:.5,finance:.2,love:-.1,marriage:-.2,family:-.2,health:-.3,education:.3,creativity:.4,spirituality:.5,travel:.2,residence:-.1,remote:.3,retirement:-.1}
  };

  // Эмфаза типа линии на сферу (какие линии «активируют» какие темы)
  var EMPH = {
    MC:  {career:1,business:.9,finance:.8,creativity:.5,education:.5,travel:.3,spirituality:.4,health:.3,family:.2,love:.2,marriage:.2,residence:.4,remote:.5,retirement:.3},
    IC:  {family:1,residence:1,retirement:.9,spirituality:.7,health:.6,finance:.5,marriage:.4,love:.4,career:.2,business:.2,education:.3,creativity:.4,travel:.3,remote:.4},
    ASC: {health:1,creativity:.7,career:.6,education:.6,spirituality:.6,business:.5,finance:.4,travel:.6,residence:.6,remote:.6,family:.4,love:.4,marriage:.3,retirement:.5},
    DSC: {marriage:1,love:1,business:.7,family:.6,travel:.5,career:.3,finance:.4,health:.3,creativity:.4,education:.3,spirituality:.3,residence:.4,remote:.3,retirement:.4}
  };

  // Природа планеты для текста
  var NATURE = {
    Sun:'светило власти и воли', Moon:'светило ума и чувств', Mars:'малефик силы и борьбы',
    Mercury:'бенефик разума и торговли', Jupiter:'великий бенефик мудрости и удачи',
    Venus:'бенефик любви и гармонии', Saturn:'малефик дисциплины и времени',
    Rahu:'теневой узел амбиций и иллюзий', Ketu:'теневой узел отрешения и духовности',
    Uranus:'планета перемен и свободы', Neptune:'планета вдохновения и иллюзий',
    Pluto:'планета трансформации и силы'
  };

  // Ключевые темы планеты (для блока «основные темы»)
  var THEMES = {
    Sun:'авторитет, статус, лидерство, признание, жизненная сила, связь с государством и отцовскими фигурами',
    Moon:'эмоции, дом, материнская забота, популярность у публики, душевный покой, интуиция',
    Mars:'энергия, смелость, амбиции, спорт, недвижимость, инициатива, но и конфликтность',
    Mercury:'интеллект, коммуникации, торговля, обучение, аналитика, технологии, гибкость ума',
    Jupiter:'мудрость, расширение, удача, преподавание, дети, духовный закон (дхарма), процветание',
    Venus:'любовь, красота, искусство, роскошь, партнёрство, удовольствия, дипломатия',
    Saturn:'дисциплина, структура, долголетие, упорный труд, аскеза, ответственность, отсроченные плоды',
    Rahu:'амбиции, иностранное, нестандартные пути, технологии, внезапные взлёты, одержимость',
    Ketu:'духовность, отрешённость, мокша, интуиция, прошлые заслуги, изоляция, исследования',
    Uranus:'новаторство, свобода, внезапные перемены, технологии, оригинальность',
    Neptune:'вдохновение, мистика, искусство, сострадание, но и туман иллюзий',
    Pluto:'глубинная трансформация, власть, кризис и возрождение, интенсивность'
  };

  var LINE_DESC = {
    MC:'линия Середины неба (MC) — зенит планеты; усиливает её влияние на карьеру, репутацию и публичный образ',
    IC:'линия Глубины неба (IC) — надир планеты; действует на дом, корни, семью и внутренний фундамент',
    ASC:'линия Восходящего (ASC) — планета на восточном горизонте; окрашивает личность, тело и жизненный тонус',
    DSC:'линия Заходящего (DSC) — планета на западном горизонте; влияет на партнёрство, брак и значимые встречи'
  };

  // Положительные/осторожные формулировки по планетам
  var POS = {
    Sun:'укрепляет уверенность, лидерские качества и общественное признание',
    Moon:'дарит душевный покой, популярность и тёплые связи с окружением',
    Mars:'повышает энергию, решительность и пробивную силу',
    Mercury:'обостряет ум, улучшает коммуникацию, торговлю и обучение',
    Jupiter:'приносит удачу, рост, покровительство и расширение возможностей',
    Venus:'привлекает любовь, красоту, комфорт и творческое вдохновение',
    Saturn:'учит дисциплине, даёт стабильность и долгосрочную опору через труд',
    Rahu:'открывает нестандартные, иностранные и технологичные возможности',
    Ketu:'углубляет духовный поиск, интуицию и внутреннюю свободу',
    Uranus:'приносит свежие идеи, свободу и неожиданные прорывы',
    Neptune:'усиливает воображение, чувствительность и творческий поток',
    Pluto:'запускает мощную внутреннюю трансформацию'
  };
  var NEG = {
    Sun:'возможны гордыня, перегрузка и трения с авторитетами',
    Moon:'возможна эмоциональная чувствительность и переменчивость настроения',
    Mars:'возрастает риск конфликтов, импульсивности и физического переутомления',
    Mercury:'возможны суетливость, информационная перегрузка и поверхностность',
    Jupiter:'возможны излишняя самоуверенность и склонность к чрезмерности',
    Venus:'возможны потакание удовольствиям и расточительность',
    Saturn:'возможны задержки, одиночество, тяжесть и хроническая усталость',
    Rahu:'возможны иллюзии, тревожность, одержимость и нестабильность',
    Ketu:'возможны отрешённость от материального, потери и чувство изоляции',
    Uranus:'возможны непостоянство и резкие развороты обстоятельств',
    Neptune:'возможны иллюзии, неясность и уход от реальности',
    Pluto:'возможны кризисы, борьба за контроль и интенсивные потрясения'
  };

  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

  /* ---------- Оценка локации ---------- */
  function scoreLocation(bodies, lines, lat, lon, orbKm) {
    var ACG = global.ACG;
    var contrib = {}, weight = {}, strength = {}, active = [];
    AREA_KEYS.forEach(function(k){contrib[k]=0;weight[k]=0;strength[k]=0;});

    lines.forEach(function(line){
      var d = ACG.distToLine(lat, lon, line);
      var inf = ACG.influence(d, orbKm);
      if (inf <= 0.001) return;
      active.push({planet:line.planet, type:line.type, dist:d, influence:inf});
      var aff = AFF[line.planet]; var emph = EMPH[line.type];
      AREA_KEYS.forEach(function(k){
        var e = emph[k]||0;
        if (e<=0) return;
        contrib[k] += (aff[k]||0) * e * inf;
        weight[k]  += e * inf;
        if (inf > strength[k]) strength[k] = inf;   // сила воздействия по сфере = ближайшая/сильнейшая линия
      });
    });

    var areas = {};
    AREA_KEYS.forEach(function(k){
      var raw = weight[k] > 0 ? contrib[k]/weight[k] : 0;   // направление: благоприятно(+)/неблагоприятно(−)
      // отклонение от нейтрали (50) ослабевает с удалением: на линии strength≈1, далеко → 0
      areas[k] = Math.round(clamp(50 + 50*raw*strength[k], 2, 99));
    });
    // Общий балл — среднее с лёгким весом на ключевые сферы
    var sum=0,n=0;
    AREA_KEYS.forEach(function(k){sum+=areas[k];n++;});
    var overall = Math.round(sum/n);

    active.sort(function(a,b){return b.influence-a.influence;});
    var dominant = active.slice(0,5);
    return { areas:areas, overall:overall, active:active, dominant:dominant };
  }

  /* ---------- Подробная интерпретация одной линии (для панели) ---------- */
  function lineInterpretation(line, bodies) {
    var Astro = global.Astro, ACG = global.ACG;
    var p = line.planet, type = line.type;
    var b = bodies[p];
    var sign = Astro.signOf(b.sidLon);
    var nak = Astro.nakshatraOf(b.sidLon);
    var aff = AFF[p], emph = EMPH[type];

    function areaScore(k){
      var raw = (aff[k]||0) * (emph[k]||0.4);
      // нормируем по эмфазе чтобы шкала была 0..100
      var base = 50 + 45*(aff[k]||0);
      var mod = (emph[k]||0.3);
      return Math.round(clamp(50 + (base-50)*(0.5+mod*0.7), 2, 99));
    }

    var f = {};
    AREA_KEYS.forEach(function(k){ f[k]=areaScore(k); });

    var overall = Math.round(clamp(
      50 + 45*( (aff.career+aff.finance+aff.love+aff.marriage+aff.health+aff.spirituality)/6 )
         * (0.6 + (emph.career+emph.marriage+emph.health)/3*0.4), 5, 98));

    function suit(scoreKeys){
      var s=0; scoreKeys.forEach(function(k){s+=aff[k]||0;}); s/=scoreKeys.length;
      if (s>.45) return 'высокая'; if (s>.15) return 'хорошая';
      if (s>-.1) return 'умеренная'; if (s>-.35) return 'низкая'; return 'нежелательно';
    }

    var nat = NATURE[p];
    var jyotish =
      'Линия ' + ACG.NAME_RU[p] + ' (' + ACG.GLYPH[p] + ') — ' + LINE_DESC[type] + '. ' +
      'В натальной карте ' + ACG.NAME_RU[p] + ' находится в знаке ' + sign +
      ' (накшатра ' + nak.name + ', пада ' + nak.pada + '), что задаёт характер влияния. ' +
      'Как ' + nat + ', вблизи этой линии планета ' + POS[p] + '. ' +
      'Однако при длительном проживании ' + NEG[p] + '.';

    return {
      planet:p, planetRu:ACG.NAME_RU[p], glyph:ACG.GLYPH[p], color:ACG.COLORS[p],
      type:type, typeRu:ACG.LINE_RU[type], sign:sign, nakshatra:nak,
      themes:THEMES[p],
      scores:f, overall:overall,
      relocation:suit(['residence','career','finance','health','family']),
      travel:suit(['travel','creativity','love','education']),
      retirement:suit(['retirement','residence','health','spirituality']),
      advantages: cap(POS[p]),
      risks: cap(NEG[p]),
      jyotish:jyotish
    };
  }
  function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}

  global.Interp = {
    AREAS:AREAS, AREA_KEYS:AREA_KEYS, AREA_RU:AREA_RU,
    AFF:AFF, EMPH:EMPH, THEMES:THEMES, NATURE:NATURE,
    scoreLocation:scoreLocation,
    lineInterpretation:lineInterpretation
  };
})(typeof window !== 'undefined' ? window : globalThis);
