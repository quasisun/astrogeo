/* ============================================================
   app.js — Управляющая логика приложения
   ============================================================ */
(function () {
  'use strict';
  var Astro = window.Astro, ACG = window.ACG, Interp = window.Interp;
  var $ = function(id){return document.getElementById(id);};
  var ORB = 1400; // км — орб влияния линий

  var state = {
    bodies:null, lines:null, map:null, world:null,
    place:null,                 // {label,lat,lon}
    analysisCities:[],          // выбранные пользователем города
    chart:null
  };

  /* ---------- Часовые пояса ---------- */
  var TZ = [];
  for(var t=-12;t<=14;t++) TZ.push(t);
  function fillTZ(){
    var s=$('in-tz'); s.innerHTML='';
    var auto=document.createElement('option'); auto.value='auto'; auto.textContent='Авто (по месту и дате)';
    s.appendChild(auto);
    TZ.forEach(function(o){
      var op=document.createElement('option'); op.value=o;
      op.textContent='UTC'+(o>=0?'+':'')+o; s.appendChild(op);
    });
    s.value='auto';
  }
  function estimateTZ(lon){ return Math.round(lon/15); }

  /* ---------- Часовой пояс с учётом летнего/зимнего времени и истории ---------- */
  // смещение зоны IANA (мин, восток +) в указанный момент (Date)
  function tzOffsetMinutes(tzid, date){
    try{
      var dtf=new Intl.DateTimeFormat('en-US',{timeZone:tzid,hour12:false,
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      var m={}; dtf.formatToParts(date).forEach(function(p){m[p.type]=p.value;});
      var hh=(m.hour==='24')?0:+m.hour;
      var asUTC=Date.UTC(+m.year, m.month-1, +m.day, hh, +m.minute, +m.second);
      return Math.round((asUTC-date.getTime())/60000);
    }catch(e){ return null; }
  }
  // местное «настенное» время -> UTC (учитывает переход DST на дату рождения)
  function localToUTC(tzid, y,mo,d,h,mi){
    var guess=Date.UTC(y,mo-1,d,h,mi,0);
    var off=tzOffsetMinutes(tzid, new Date(guess));
    if(off===null) return null;
    var utc=guess-off*60000;
    off=tzOffsetMinutes(tzid, new Date(utc));      // уточнение у границы перехода
    utc=guess-off*60000;
    return {utcMs:utc, offsetMin:off};
  }
  function fmtOffset(min){
    var sign=min<0?'-':'+', a=Math.abs(min), h=Math.floor(a/60), m=a%60;
    return 'UTC'+sign+h+(m?(':'+(m<10?'0':'')+m):'');
  }
  // обновить подсказку «определённая зона/смещение» по текущему месту и дате
  function updateTzInfo(){
    var info=$('tz-info');
    if($('in-tz').value!=='auto'){ info.textContent='Выбран вручную: '+fmtOffset(parseFloat($('in-tz').value)*60); return; }
    if(!state.tzid || !state.place){ info.textContent='Определяется автоматически по месту и дате'; return; }
    var dp=($('in-date').value||'1990-01-01').split('-'), tp=($('in-time').value||'12:00').split(':');
    var r=localToUTC(state.tzid, +dp[0],+dp[1],+dp[2], +tp[0],+tp[1]);
    if(!r){ info.textContent='Зона: '+state.tzid; return; }
    info.textContent='Зона: '+state.tzid+' · '+fmtOffset(r.offsetMin);
  }

  /* ---------- Геокодер: бэкенд (server.py) или напрямую OpenStreetMap ----------
     На GitHub Pages / в Tilda бэкенда нет — тогда обращаемся к Nominatim из браузера. */
  var GEO_PREFIXES = ['городской округ ','муниципальное образование ','сельское поселение ',
    'городское поселение ','посёлок городского типа ','полярная станция ',
    'деревня ','село ','посёлок ','город '];
  function cleanName(s){
    s=(s||'').trim(); var low=s.toLowerCase();
    for(var i=0;i<GEO_PREFIXES.length;i++){ if(low.indexOf(GEO_PREFIXES[i])===0) return s.slice(GEO_PREFIXES[i].length); }
    return s;
  }
  function parseNominatim(data){
    if(!Array.isArray(data)) return [];
    var out=[], seen={};
    data.forEach(function(it){
      var a=it.address||{};
      var name=cleanName(a.city||a.town||a.village||a.hamlet||it.name||a.municipality||(it.display_name||'').split(',')[0]);
      var lat=parseFloat(it.lat), lon=parseFloat(it.lon);
      if(isNaN(lat)||isNaN(lon)) return;
      var key=Math.round(lat*1000)/1000+','+Math.round(lon*1000)/1000;
      if(seen[key]) return; seen[key]=1;
      out.push({name:name, region:a.state||a.region||a.county||'', country:a.country||'',
                lat:lat, lon:lon, remote:true, continent:''});
    });
    return out;
  }
  function geocodeNominatim(q){
    var url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&accept-language=ru&q='+encodeURIComponent(q);
    return fetch(url).then(function(r){return r.ok?r.json():[];}).then(parseNominatim).catch(function(){return [];});
  }
  // Сначала пробуем локальный бэкенд; если его нет — напрямую в OpenStreetMap.
  function geocodeQuery(q){
    return fetch('/api/geocode?q='+encodeURIComponent(q))
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(arr){ if(Array.isArray(arr)) { arr.forEach(function(x){x.remote=true;}); return arr; } throw 0; })
      .catch(function(){ return geocodeNominatim(q); });
  }

  /* ---------- Автодополнение городов (локальная база + геокодер мира) ---------- */
  function setupAutocomplete(inputId, listId, onPick){
    var input=$(inputId), list=$(listId), sel=-1, items=[], reqId=0, timer=null, loading=false;
    function localMatches(q){
      return window.CITIES.filter(function(c){
        return c.name.toLowerCase().indexOf(q)>=0 || c.country.toLowerCase().indexOf(q)>=0;
      }).slice(0,6);
    }
    function render(){
      list.innerHTML=''; sel=-1;
      if(!items.length && !loading){ list.classList.remove('open'); return; }
      items.forEach(function(c,i){
        var d=document.createElement('div'); d.className='ac-item';
        var right=c.remote ? ((c.region?c.region+', ':'')+(c.country||'')) : c.country;
        d.innerHTML='<span>'+c.name+'</span><span class="c">'+right+'</span>';
        d.onmousedown=function(e){e.preventDefault();pick(i);};
        list.appendChild(d);
      });
      if(loading){
        var l=document.createElement('div'); l.className='ac-item'; l.style.opacity='.6'; l.style.cursor='default';
        l.innerHTML='<span>Ищу города по всему миру…</span>';
        list.appendChild(l);
      }
      list.classList.add('open');
    }
    function pick(i){
      var c=items[i]; if(!c)return;
      input.value=c.name; list.classList.remove('open');
      onPick(c);
    }
    function search(raw){
      var q=raw.trim();
      if(!q){ items=[]; loading=false; render(); return; }
      items=localMatches(q.toLowerCase());
      loading=q.length>=2;
      render();
      clearTimeout(timer);
      if(q.length<2) return;
      var myReq=++reqId;
      timer=setTimeout(function(){
        geocodeQuery(q)
          .then(function(arr){
            if(myReq!==reqId) return;            // ответ устарел
            loading=false;
            if(Array.isArray(arr)){
              var have={}; items.forEach(function(x){have[(x.name||'').toLowerCase()+'|'+(x.country||'')]=1;});
              arr.forEach(function(g){
                g.remote=true; g.continent=g.continent||'';
                var k=(g.name||'').toLowerCase()+'|'+(g.country||'');
                if(!have[k]){ have[k]=1; items.push(g); }
              });
            }
            render();
          })
          .catch(function(){ loading=false; render(); });
      },350);
    }
    input.addEventListener('input',function(){search(input.value);});
    input.addEventListener('focus',function(){if(input.value)search(input.value);});
    input.addEventListener('keydown',function(e){
      var rows=list.querySelectorAll('.ac-item');
      if(e.key==='ArrowDown'){sel=Math.min(items.length-1,sel+1);}
      else if(e.key==='ArrowUp'){sel=Math.max(0,sel-1);}
      else if(e.key==='Enter'){ if(sel>=0)pick(sel); else if(items.length)pick(0); return;}
      else if(e.key==='Escape'){list.classList.remove('open');return;}
      else return;
      rows.forEach(function(r,i){r.classList.toggle('sel',i===sel);});
      e.preventDefault();
    });
    document.addEventListener('click',function(e){ if(!input.contains(e.target)&&!list.contains(e.target))list.classList.remove('open'); });
  }

  /* ---------- Фильтры ---------- */
  function fillFilters(){
    var clim={}, cont={};
    window.CITIES.forEach(function(c){clim[c.climate]=1;cont[c.continent]=1;});
    Object.keys(clim).sort().forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=k;$('in-climate').appendChild(o);});
    Object.keys(cont).sort().forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=k;$('in-continent').appendChild(o);});
  }

  /* ---------- Чипы городов ---------- */
  function renderChips(){
    var box=$('city-chips'); box.innerHTML='';
    state.analysisCities.forEach(function(c,i){
      var sp=document.createElement('span'); sp.className='chip';
      sp.innerHTML=c.name+' <b title="убрать">✕</b>';
      sp.querySelector('b').onclick=function(){state.analysisCities.splice(i,1);renderChips();if(state.lines)refreshAfterCities();};
      box.appendChild(sp);
    });
  }

  /* ---------- Загрузка карты мира ---------- */
  function loadWorld(){
    return fetch('data/world.geojson').then(function(r){return r.json();}).then(function(j){state.world=j;return j;});
  }

  /* ---------- Расчёт ---------- */
  function compute(){
    if(!state.place){ alert('Укажите место рождения (выберите город из списка).'); return; }
    var date=$('in-date').value, time=$('in-time').value||'12:00';
    if(!date){alert('Укажите дату рождения.');return;}
    var name=($('in-name').value||'').trim();
    var tzSel=$('in-tz').value;
    var outer=$('in-outer').value==='yes';
    var dp=date.split('-'), tp=time.split(':');
    var y=+dp[0],mo=+dp[1],d=+dp[2],hh=+tp[0],mm=+tp[1];
    var hourLocal=hh+mm/60;
    var tzOffH, jd, hourUTC, y2=y,mo2=mo,d2=d;
    if(tzSel==='auto' && state.tzid){
      var r=localToUTC(state.tzid, y,mo,d,hh,mm);   // учитывает DST/историю
      if(r){
        var du=new Date(r.utcMs);
        y2=du.getUTCFullYear(); mo2=du.getUTCMonth()+1; d2=du.getUTCDate();
        hourUTC=du.getUTCHours()+du.getUTCMinutes()/60+du.getUTCSeconds()/3600;
        tzOffH=r.offsetMin/60;
        jd=Astro.julianDay(y2,mo2,d2,hourUTC);
      }
    }
    if(jd===undefined){                              // ручной выбор или нет зоны
      tzOffH=(tzSel==='auto')?estimateTZ(state.place.lon):parseFloat(tzSel);
      hourUTC=hourLocal-tzOffH;
      jd=Astro.julianDay(y,mo,d,hourUTC);
    }

    $('hero').querySelector('.big').style.display='none';
    $('hero').querySelector('.lead').style.display='none';
    $('hero').querySelector('.mark-big').style.display='none';
    $('loader').classList.add('on');

    fetchChart(y2,mo2,d2,hourUTC,outer).then(function(res){
      var bodies, engine;
      if(res){ bodies=apiToBodies(res); engine=res.engine; }
      else { bodies=Astro.computeBodies(jd,outer); engine='Встроенный движок (приближённый)'; }
      var order=Astro.PLANET_ORDER.filter(function(p){
        return outer || ['Uranus','Neptune','Pluto'].indexOf(p)<0;
      });
      var lines=ACG.buildLines(bodies,order);
      state.bodies=bodies; state.lines=lines; state.order=order; state.engine=engine;
      state.chart={jd:jd,date:date,time:time,name:name,tz:tzOffH,tzLabel:fmtOffset(Math.round(tzOffH*60)),tzid:state.tzid,outer:outer};

      buildHeat();
      initMap();
      renderNatal();
      buildLegend();
      renderResults();

      $('hero').style.display='none';
      $('map-tools').style.display='flex';
      $('legend').style.display='block';
      $('results').style.display='block';
      $('card-natal').style.display='block';
      $('loader').classList.remove('on');
    });
  }

  // Запрос точных позиций у бэкенда (Swiss Ephemeris); null -> резервный JS-движок
  function fetchChart(y,mo,d,ut,outer){
    return fetch('/api/chart?y='+y+'&m='+mo+'&d='+d+'&ut='+ut+'&outer='+(outer?1:0))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ return (j && j.bodies) ? j : null; })
      .catch(function(){ return null; });
  }
  function apiToBodies(res){
    var b = res.bodies; b._meta = res.meta; return b;
  }

  /* ---------- Тепловая карта ---------- */
  function buildHeat(){
    var step=3, grid=[];
    for(var lat=84;lat>=-84;lat-=step){
      for(var lon=-180;lon<180;lon+=step){
        var sc=Interp.scoreLocation(state.bodies,state.lines,lat,lon,ORB);
        grid.push({lat:lat,lon:lon,v:sc.overall});
      }
    }
    state.heat={step:step,grid:grid};
  }

  /* ---------- Карта ---------- */
  function initMap(){
    if(!state.map){
      state.map=new MapView($('map-canvas'),{
        onClickPoint:onClickPoint, onClickLine:onClickLine, onHoverLine:onHoverLine
      });
      state.order && state.order.forEach(function(p){state.map.visPlanet[p]=true;});
      bindMapButtons();
    }
    state.order.forEach(function(p){ if(state.map.visPlanet[p]===undefined)state.map.visPlanet[p]=true; });
    state.map.world=state.world;
    state.map.lines=state.lines;
    state.map.heat=state.heat;
    state.map.birth={lat:state.place.lat,lon:state.place.lon,label:state.place.label};
    state.map.cities=state.analysisCities.slice();
    state.map.resize();
    // центрировать на месте рождения
    state.map.z=2; var s=state.map.baseScale*state.map.z;
    state.map.panX=state.map.W/2-(state.place.lon+180)*s;
    state.map.panY=state.map.H/2-(90-state.place.lat)*s;
    state.map.wrapPanX(); state.map.clampPan();
    state.map.draw();
  }

  function bindMapButtons(){
    $('zin').onclick=function(){state.map.zoomAt(state.map.W/2,state.map.H/2,1.4);};
    $('zout').onclick=function(){state.map.zoomAt(state.map.W/2,state.map.H/2,1/1.4);};
    $('zreset').onclick=function(){state.map.z=1;state.map.panX=0;state.map.clampPan();state.map.draw();};
    $('btn-heat').onclick=function(){
      state.map.showHeat=!state.map.showHeat;
      this.classList.toggle('btn-primary',state.map.showHeat);
      this.classList.toggle('btn-ghost',!state.map.showHeat);
      state.map.draw();
    };
    $('btn-cities').onclick=function(){
      state.map.showCities=!state.map.showCities;
      this.classList.toggle('btn-primary',state.map.showCities);
      this.classList.toggle('btn-ghost',!state.map.showCities);
      state.map.draw();
    };
  }

  function refreshAfterCities(){
    state.map.cities=state.analysisCities.slice();
    state.map.draw();
    renderResults();
  }

  /* ---------- Легенда ---------- */
  function buildLegend(){
    var types=$('lg-types'); types.innerHTML='';
    [['MC','MC'],['IC','IC'],['ASC','ASC'],['DSC','DSC']].forEach(function(t){
      var b=document.createElement('div'); b.className='tg on'; b.textContent=t[1];
      b.onclick=function(){
        state.map.visType[t[0]]=!state.map.visType[t[0]];
        b.classList.toggle('on',state.map.visType[t[0]]); state.map.draw();
      };
      types.appendChild(b);
    });
    var rows=$('lg-rows'); rows.innerHTML='';
    state.order.forEach(function(p){
      var b=state.bodies[p];
      var row=document.createElement('div'); row.className='lg-row';
      row.innerHTML='<span class="sw" style="background:'+ACG.COLORS[p]+'"></span>'+
        '<span class="gl" style="color:'+ACG.COLORS[p]+'">'+ACG.GLYPH[p]+'</span>'+
        '<span class="nm">'+ACG.NAME_RU[p]+'<div class="sg">'+Astro.signOf(b.sidLon)+'</div></span>';
      row.onclick=function(){
        state.map.visPlanet[p]=!state.map.visPlanet[p];
        row.classList.toggle('off',!state.map.visPlanet[p]); state.map.draw();
      };
      rows.appendChild(row);
    });
  }

  /* ---------- Натальная сводка ---------- */
  function renderNatal(){
    var b=state.bodies, m=b._meta;
    var html='<table class="rep"><tr><th>Планета</th><th>Знак</th><th>Градус</th><th>Накшатра</th></tr>';
    state.order.forEach(function(p){
      var x=b[p], nk=Astro.nakshatraOf(x.sidLon);
      html+='<tr><td><span style="color:'+ACG.COLORS[p]+'">'+ACG.GLYPH[p]+'</span> '+ACG.NAME_RU[p]+'</td>'+
        '<td>'+Astro.signOf(x.sidLon)+'</td><td>'+Astro.degInSign(x.sidLon).toFixed(1)+'°</td>'+
        '<td>'+nk.name+' ('+nk.pada+')</td></tr>';
    });
    html+='</table><div class="hint" style="margin-top:8px;">Аянамша Лахири: '+m.ayanamsha.toFixed(3)+'° · сидерический зодиак<br>Движок: '+(state.engine||'—')+'</div>';
    $('natal-body').innerHTML=html;
  }

  /* ---------- Взаимодействие с картой ---------- */
  var hoverRAF;
  function onHoverLine(line,e,geo){
    var tip=$('cursor-tip');
    if(!line){tip.style.display='none';return;}
    var r=state.map.cv.getBoundingClientRect();
    var px=e.clientX-r.left, py=e.clientY-r.top;
    var dist=ACG.distToLine(geo.lat,geo.lon,line);
    tip.innerHTML='<span class="g" style="color:'+line.color+'">'+ACG.GLYPH[line.planet]+'</span> <b>'+
      ACG.NAME_RU[line.planet]+' '+line.type+'</b><br><span style="color:#6b6166">~'+Math.round(dist)+' км · нажмите для подробностей</span>';
    tip.style.left=(px+14)+'px'; tip.style.top=(py+14)+'px'; tip.style.display='block';
  }

  function onClickLine(line,geo){
    var info=Interp.lineInterpretation(line,state.bodies);
    var dist=ACG.distToLine(geo.lat,geo.lon,line);
    showLinePanel(info,dist);
    state.map.selected=geo; state.map.draw();
  }

  function onClickPoint(geo){
    state.map.selected=geo; state.map.draw();
    var sc=Interp.scoreLocation(state.bodies,state.lines,geo.lat,geo.lon,ORB);
    showPointPanel(geo,sc);
  }

  /* ---------- Инфопанели ---------- */
  function ringSVG(score){
    var c=2*Math.PI*26, off=c*(1-score/100);
    var col=score>=66?'#1FA84F':score>=45?'#E5A300':'#df2227';
    return '<svg class="score-ring" viewBox="0 0 62 62"><circle cx="31" cy="31" r="26" fill="none" stroke="#f0e6e4" stroke-width="7"/>'+
      '<circle cx="31" cy="31" r="26" fill="none" stroke="'+col+'" stroke-width="7" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+off+'" transform="rotate(-90 31 31)"/>'+
      '<text x="31" y="36" text-anchor="middle" font-family="Arial" font-size="17" font-weight="bold" fill="'+col+'">'+score+'</text></svg>';
  }
  function barsHTML(scores){
    var keys=['career','finance','love','marriage','family','health','spirituality','creativity'];
    var h='<div class="bars">';
    keys.forEach(function(k){
      var v=scores[k];
      h+='<div class="bar"><span class="nm">'+Interp.AREA_RU[k]+'</span><div class="track"><div class="fill" style="width:'+v+'%"></div></div><span class="vv">'+v+'</span></div>';
    });
    return h+'</div>';
  }

  function showLinePanel(info,dist){
    var head=$('ip-head'); head.style.background='linear-gradient(135deg,'+info.color+','+shade(info.color)+')';
    head.innerHTML='<span class="g">'+info.glyph+'</span><div class="t"><div class="p">'+info.planetRu+'</div><div class="l">'+info.typeRu+'</div></div><span class="close" id="ip-close">✕</span>';
    var b=$('ip-body');
    b.innerHTML=
      '<div class="ip-score">'+ringSVG(info.overall)+
        '<div class="meta"><b>Общая благоприятность</b><br>Знак: '+info.sign+'<br>Накшатра: '+info.nakshatra.name+' (пада '+info.nakshatra.pada+')'+
        (dist!=null?'<br>Расстояние от точки: ~'+Math.round(dist)+' км':'')+'</div></div>'+
      '<div class="pillrow"><span class="pill">ПМЖ: <b>'+info.relocation+'</b></span><span class="pill">Поездки: <b>'+info.travel+'</b></span><span class="pill">Отдых: <b>'+info.retirement+'</b></span></div>'+
      barsHTML(info.scores)+
      '<div style="font-size:12.5px;margin:6px 0;"><span class="ip-text" style="display:block"><span class="lbl">Основные темы:</span> '+info.themes+'</span></div>'+
      '<div class="ip-text"><span class="lbl">Преимущества:</span> '+info.advantages+'.<br><span class="lbl">Риски:</span> '+info.risks+'.</div>'+
      '<div class="ip-text" style="margin-top:8px;"><span class="lbl">Джйотиш-трактовка:</span> '+info.jyotish+'</div>';
    openPanel();
  }

  function showPointPanel(geo,sc){
    var head=$('ip-head'); head.style.background='var(--grad)';
    var place='Точка '+geo.lat.toFixed(1)+'°, '+geo.lon.toFixed(1)+'°';
    head.innerHTML='<span class="g">⌖</span><div class="t"><div class="p">'+place+'</div><div class="l">Анализ локации</div></div><span class="close" id="ip-close">✕</span>';
    var doms=sc.dominant.map(function(d){return '<span class="pill"><span style="color:'+ACG.COLORS[d.planet]+'">'+ACG.GLYPH[d.planet]+'</span> '+ACG.NAME_RU[d.planet]+' '+d.type+'</span>';}).join('');
    $('ip-body').innerHTML=
      '<div class="ip-score">'+ringSVG(sc.overall)+'<div class="meta"><b>Общая благоприятность места</b><br>Доминирующие влияния:</div></div>'+
      '<div class="pillrow" style="flex-wrap:wrap">'+(doms||'<span class="pill">Нет сильных линий поблизости</span>')+'</div>'+
      barsHTMLfull(sc.areas)+
      '<div class="ip-text" style="margin-top:8px;">'+pointNarrative(sc)+'</div>';
    openPanel();
  }
  function barsHTMLfull(scores){
    var h='<div class="bars">';
    Interp.AREA_KEYS.forEach(function(k){
      var v=scores[k];
      h+='<div class="bar"><span class="nm">'+Interp.AREA_RU[k]+'</span><div class="track"><div class="fill" style="width:'+v+'%"></div></div><span class="vv">'+v+'</span></div>';
    });
    return h+'</div>';
  }
  function pointNarrative(sc){
    if(!sc.dominant.length) return 'Вдали от основных планетных линий — место с нейтральным, спокойным фоном без выраженных акцентов.';
    var d=sc.dominant[0];
    var aff=Interp.AFF[d.planet];
    var strong=[],weak=[];
    Interp.AREA_KEYS.forEach(function(k){ if(sc.areas[k]>=66)strong.push(Interp.AREA_RU[k].toLowerCase()); if(sc.areas[k]<=38)weak.push(Interp.AREA_RU[k].toLowerCase()); });
    var txt='Ближайшее сильное влияние — линия '+ACG.NAME_RU[d.planet]+' '+d.type+' (как '+Interp.NATURE[d.planet]+'). ';
    if(strong.length) txt+='Место особенно поддерживает: '+strong.slice(0,4).join(', ')+'. ';
    if(weak.length) txt+='Осторожнее со сферами: '+weak.slice(0,3).join(', ')+'. ';
    txt+='Общий энергетический профиль оценивается в '+sc.overall+' из 100.';
    return txt;
  }

  function openPanel(){
    $('infopanel').classList.add('open');
    $('ip-close').onclick=function(){$('infopanel').classList.remove('open');};
  }
  function shade(hex){ // затемнить цвет для градиента
    var n=parseInt(hex.slice(1),16);
    var r=Math.max(0,(n>>16)-30),g=Math.max(0,((n>>8)&255)-30),b=Math.max(0,(n&255)-30);
    return 'rgb('+r+','+g+','+b+')';
  }

  /* ============================================================
     РЕЗУЛЬТАТЫ: рекомендации, города, сравнение, отчёт
     ============================================================ */
  function scoreCity(c){
    var sc=Interp.scoreLocation(state.bodies,state.lines,c.lat,c.lon,ORB);
    return Object.assign({},c,{score:sc.overall,areas:sc.areas,dominant:sc.dominant});
  }

  function allScored(){
    var pool=window.CITIES.slice();
    // добавить пользовательские, если их нет в базе
    state.analysisCities.forEach(function(c){
      if(!pool.some(function(p){return p.name===c.name;})) pool.push(c);
    });
    // фильтры
    var clim=$('in-climate').value, cont=$('in-continent').value;
    if(clim) pool=pool.filter(function(c){return c.climate===clim;});
    if(cont) pool=pool.filter(function(c){return c.continent===cont;});
    return pool.map(scoreCity);
  }

  var REC_CATS=[
    {key:'overall',title:'Лучшие места для ПМЖ',sub:'Гармоничный общий фон для постоянного проживания',areas:['residence','health','family','finance']},
    {key:'career',title:'Лучшие места для карьеры',sub:'Рост статуса, признание, профессиональный успех',areas:['career']},
    {key:'business',title:'Лучшие места для бизнеса',sub:'Предпринимательство, сделки, партнёрства',areas:['business','finance']},
    {key:'love',title:'Лучшие места для отношений',sub:'Любовь, брак, гармония в паре',areas:['love','marriage']},
    {key:'spirituality',title:'Лучшие места для духовной практики',sub:'Медитация, паломничество, внутренний рост',areas:['spirituality']},
    {key:'retirement',title:'Лучшие места для отдыха и пенсии',sub:'Покой, комфорт, восстановление',areas:['retirement','health']},
    {key:'travel',title:'Лучшие места для путешествий',sub:'Яркие впечатления и лёгкость поездок',areas:['travel','creativity']},
    {key:'remote',title:'Лучшие места для цифровых кочевников',sub:'Удалённая работа и продуктивность',areas:['remote','business']}
  ];
  var AVOID_CATS=[
    {key:'residence',title:'Избегать для ПМЖ',areas:['residence','health','family']},
    {key:'business',title:'Избегать для бизнеса',areas:['business','finance']},
    {key:'travel',title:'Осторожно в поездках',areas:['travel','health']},
    {key:'conflict',title:'Зоны напряжения и конфликтов',areas:['health','marriage','family'],conflict:true}
  ];

  function catScore(city,areas){
    var s=0; areas.forEach(function(a){s+=city.areas[a];}); return Math.round(s/areas.length);
  }

  function domGlyphs(city){
    return city.dominant.slice(0,3).map(function(d){return '<span style="color:'+ACG.COLORS[d.planet]+'" title="'+ACG.NAME_RU[d.planet]+' '+d.type+'">'+ACG.GLYPH[d.planet]+'</span>';}).join(' ');
  }
  function explainCity(city,areas,bad){
    var d=city.dominant[0];
    if(!d) return 'Спокойный нейтральный фон без сильных планетных акцентов — ровное, ненавязчивое влияние.';
    var genit=ACG.NAME_GEN[d.planet];
    var sign=Astro.signOf(state.bodies[d.planet].sidLon);
    var typeRu={MC:'у зенита (MC)',IC:'у основания (IC)',ASC:'на восходе (ASC)',DSC:'на закате (DSC)'}[d.type];
    var info=Interp.lineInterpretation({planet:d.planet,type:d.type},state.bodies);
    // конкретная сфера: самая выраженная среди категории для этого города
    var area=areas[0], extreme=areas[0];
    areas.forEach(function(a){ if(bad){ if(city.areas[a]<city.areas[extreme])extreme=a; } else { if(city.areas[a]>city.areas[extreme])extreme=a; } });
    var areaTxt=Interp.AREA_RU[extreme].toLowerCase();
    var second=city.dominant[1];
    var secTxt=second?(' Дополнительно ощущается влияние '+ACG.NAME_GEN[second.planet]+' ('+second.type+').'):'';
    if(bad){
      return 'Линия '+genit+' ('+sign+') '+typeRu+' создаёт напряжение в сфере «'+areaTxt+'»: '+lower(info.risks)+'.'+secTxt;
    }
    return 'Линия '+genit+' ('+sign+') '+typeRu+' поддерживает сферу «'+areaTxt+'»: '+lower(info.advantages)+'.'+secTxt;
  }
  function lower(s){return s.charAt(0).toLowerCase()+s.slice(1);}

  function renderResults(){
    var scored=allScored();
    // точки городов на карте (зелёный/жёлтый/красный по общему баллу)
    if(state.map){
      state.map.cityScores=scored.map(function(c){return {name:c.name,lat:c.lat,lon:c.lon,score:c.score};});
      state.map.draw();
    }
    renderRecs(scored);
    renderCities(scored);
    renderCompare(scored);
    renderReport(scored);
  }

  function recCardHTML(rank,city,score,areas,bad){
    return '<div class="rec-card" data-lat="'+city.lat+'" data-lon="'+city.lon+'">'+
      '<span class="sc" style="color:'+(score>=66?'#1FA84F':score>=45?'#E5A300':'#df2227')+'">'+score+'</span>'+
      '<div class="rk">#'+rank+'</div><div class="ct">'+city.name+'</div><div class="co">'+city.country+' · '+city.continent+'</div>'+
      '<div class="doms">'+domGlyphs(city)+'</div>'+
      '<div class="ex">'+explainCity(city,areas,bad)+'</div></div>';
  }

  function renderRecs(scored){
    var html='<h2 class="section-title">Рекомендации по миру</h2><p class="section-sub">Рассчитано по '+scored.length+' городам на основе вашей сидерической карты. Нажмите на карточку, чтобы найти город на карте.</p>';
    REC_CATS.forEach(function(cat){
      var ranked=scored.map(function(c){return {c:c,s:catScore(c,cat.areas)};}).sort(function(a,b){return b.s-a.s;}).slice(0,6);
      html+='<h3 style="margin:22px 0 4px;">'+cat.title+'</h3><p class="section-sub">'+cat.sub+'</p><div class="grid-cards">';
      ranked.forEach(function(r,i){ html+=recCardHTML(i+1,r.c,r.s,cat.areas); });
      html+='</div>';
    });
    // избегать
    html+='<h2 class="section-title" style="margin-top:34px;color:var(--brand-1);">Места, требующие осторожности</h2><p class="section-sub">Здесь карта указывает на повышенное напряжение в соответствующих сферах.</p>';
    AVOID_CATS.forEach(function(cat){
      var ranked=scored.map(function(c){return {c:c,s:catScore(c,cat.areas)};}).sort(function(a,b){return a.s-b.s;}).slice(0,4);
      html+='<h3 style="margin:22px 0 4px;">'+cat.title+'</h3><div class="grid-cards">';
      ranked.forEach(function(r,i){ html+=recCardHTML(i+1,r.c,r.s,cat.areas,true); });
      html+='</div>';
    });
    $('pane-recs').innerHTML=html;
    bindRecCards($('pane-recs'));
  }

  function bindRecCards(root){
    root.querySelectorAll('.rec-card').forEach(function(el){
      el.onclick=function(){
        var lat=+el.dataset.lat, lon=+el.dataset.lon;
        var s=state.map.baseScale*(state.map.z=3);
        state.map.panX=state.map.W/2-(lon+180)*s; state.map.panY=state.map.H/2-(90-lat)*s;
        state.map.wrapPanX();state.map.clampPan();state.map.selected={lat:lat,lon:lon};state.map.draw();
        onClickPoint({lat:lat,lon:lon});
        document.querySelector('.main').scrollIntoView({behavior:'smooth'});
      };
    });
  }

  function renderCities(scored){
    var chosen=state.analysisCities.length
      ? scored.filter(function(c){return state.analysisCities.some(function(a){return a.name===c.name;});})
      : scored.slice().sort(function(a,b){return b.score-a.score;}).slice(0,12);
    var html='<h2 class="section-title">Анализ городов</h2><p class="section-sub">'+
      (state.analysisCities.length?'Выбранные вами города.':'Города не заданы — показаны 12 наиболее благоприятных для вас.')+'</p>';
    html+='<table class="rep"><tr><th>Город</th><th>Страна</th><th>Общий</th><th>Карьера</th><th>Финансы</th><th>Любовь</th><th>Здоровье</th><th>Духовность</th><th>Доминанты</th></tr>';
    chosen.sort(function(a,b){return b.score-a.score;}).forEach(function(c){
      html+='<tr><td><b>'+c.name+'</b></td><td>'+c.country+'</td>'+
        td(c.score)+td(c.areas.career)+td(c.areas.finance)+td(c.areas.love)+td(c.areas.health)+td(c.areas.spirituality)+
        '<td>'+domGlyphs(c)+'</td></tr>';
    });
    html+='</table>';
    $('pane-cities').innerHTML=html;
  }
  function td(v){var cl=v>=66?'good':v>=45?'mid':'bad';return '<td><span class="badge '+cl+'">'+v+'</span></td>';}

  function renderCompare(scored){
    var chosen=state.analysisCities.length
      ? scored.filter(function(c){return state.analysisCities.some(function(a){return a.name===c.name;});})
      : scored.slice().sort(function(a,b){return b.score-a.score;}).slice(0,3);
    if(chosen.length<1){$('pane-compare').innerHTML='<p class="section-sub">Добавьте города слева для сравнения.</p>';return;}
    var html='<h2 class="section-title">Сравнение городов</h2><p class="section-sub">Сравнение по всем сферам жизни.</p><table class="rep"><tr><th>Сфера</th>';
    chosen.forEach(function(c){html+='<th>'+c.name+'</th>';});
    html+='</tr>';
    [['overall','Общий балл']].concat(Interp.AREAS).forEach(function(a){
      var key=a[0]==='overall'?'overall':a[0];
      html+='<tr><td>'+a[1]+'</td>';
      chosen.forEach(function(c){ var v=key==='overall'?c.score:c.areas[key]; html+=td(v);});
      html+='</tr>';
    });
    html+='</table>';
    $('pane-compare').innerHTML=html;
  }

  /* ---------- Отчёт ---------- */
  function renderReport(scored){
    var b=state.bodies, ch=state.chart;
    var best=scored.slice().sort(function(a,b){return b.score-a.score;});
    var top=best.slice(0,5), worst=best.slice(-3).reverse();
    var html='<h2 class="section-title">Персональный отчёт астрокартографии'+(ch.name?' — '+ch.name:'')+'</h2>';
    html+='<p class="section-sub">'+(ch.name?'Расчёт для: <b>'+ch.name+'</b> · ':'')+'Дата рождения: '+ch.date+' '+ch.time+' ('+(ch.tzLabel||'')+') · '+state.place.label+' · аянамша Лахири '+b._meta.ayanamsha.toFixed(2)+'°</p>';

    html+='<div class="card"><h3>Сводка натальной карты</h3><div class="ex" style="font-size:13.5px;color:var(--ink)">';
    html+='Ключевые планетные позиции в сидерическом зодиаке: ';
    html+=state.order.slice(0,7).map(function(p){return ACG.NAME_RU[p]+' — '+Astro.signOf(b[p].sidLon);}).join('; ')+'. ';
    html+='Эти положения определяют, как планетные линии будут окрашивать различные регионы Земли.</div></div>';

    html+='<div class="card"><h3>Лучшие регионы для жизни</h3><ol style="margin:0;padding-left:18px;">';
    top.forEach(function(c){
      html+='<li style="margin-bottom:8px;"><b>'+c.name+'</b> ('+c.country+') — '+c.score+'/100. '+explainCity(c,['residence','career'])+'</li>';
    });
    html+='</ol></div>';

    html+='<div class="card"><h3>Лучшие направления для поездок</h3><ol style="margin:0;padding-left:18px;">';
    scored.map(function(c){return {c:c,s:catScore(c,['travel','creativity','love'])};}).sort(function(a,b){return b.s-a.s;}).slice(0,4).forEach(function(r){
      html+='<li style="margin-bottom:6px;"><b>'+r.c.name+'</b> — '+r.s+'/100. '+explainCity(r.c,['travel'])+'</li>';
    });
    html+='</ol></div>';

    html+='<div class="card"><h3>Места, которых стоит избегать для ПМЖ</h3><ol style="margin:0;padding-left:18px;">';
    worst.forEach(function(c){ html+='<li style="margin-bottom:8px;"><b>'+c.name+'</b> ('+c.country+') — '+c.score+'/100. '+explainCity(c,['residence','health'],true)+'</li>'; });
    html+='</ol></div>';

    html+='<div class="card"><h3>Планета за планетой</h3>';
    state.order.forEach(function(p){
      var info=Interp.lineInterpretation({planet:p,type:'MC'},b);
      html+='<p style="margin:6px 0;font-size:13px;"><b style="color:'+ACG.COLORS[p]+'">'+ACG.GLYPH[p]+' '+ACG.NAME_RU[p]+'</b> ('+Astro.signOf(b[p].sidLon)+'): '+info.themes+'. Преимущества линий: '+lower(info.advantages)+'; риски: '+lower(info.risks)+'.</p>';
    });
    html+='</div>';

    html+='<div class="card"><h3>Практические рекомендации</h3><ul style="font-size:13.5px;line-height:1.7;">'+
      '<li>Для долгосрочного переезда выбирайте города у линий Юпитера и Венеры (MC/IC) — они дают устойчивый рост и гармонию.</li>'+
      '<li>Линии Сатурна подходят для дисциплины, карьеры через труд и спокойной зрелости, но не для лёгкости и удовольствий.</li>'+
      '<li>Линии Марса и Раху хороши для коротких энергичных рывков (бизнес-поездки, старт проектов), но утомительны для ПМЖ.</li>'+
      '<li>Для духовной практики и ретритов ищите линии Кету, Юпитера и Луны.</li>'+
      '<li>Чем ближе вы к линии (в пределах ~'+Math.round(ORB/3)+'–'+ORB+' км), тем сильнее её влияние.</li></ul></div>';

    html+='<div class="disclaimer">Астрокартография (астрогеография) не является прямой рекомендацией к смене места жительства или поездке — это информационный астрологический расчёт на основе традиционной индийской астрологии (Джйотиш), носящий ознакомительный характер. Решения вы принимаете самостоятельно.<br><br>© 2026 Индийская астрология со Светланой Кройцер · goroskop1008.ru</div>';
    $('pane-report').innerHTML=html;
  }

  /* ---------- Вкладки ---------- */
  function setupTabs(){
    $('tabs').addEventListener('click',function(e){
      var t=e.target.closest('.tab'); if(!t)return;
      document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on');});
      document.querySelectorAll('.tabpane').forEach(function(x){x.classList.remove('on');});
      t.classList.add('on'); $('pane-'+t.dataset.pane).classList.add('on');
    });
  }

  /* ---------- Скачивание PDF-отчёта через печать (надёжно, без CDN) ----------
     Собираем чистый документ отчёта в скрытом iframe и вызываем печать —
     пользователь выбирает «Сохранить как PDF». Работает офлайн и в Tilda. */

  // снимок карты «весь мир», обрезанный по широте (без пустых полярных полей)
  function worldSnapshot(withHeat){
    var mv=state.map; if(!mv) return '';
    var save={z:mv.z,panX:mv.panX,panY:mv.panY,heat:mv.showHeat,cities:mv.showCities};
    mv.showHeat=!!withHeat; mv.showCities=!!mv.showCities && false; // на снимке без точек городов
    mv.z=1; mv.panX=0; mv.clampPan(); mv.draw();
    var url='';
    try{
      var dpr=window.devicePixelRatio||1;
      var yTop=Math.max(0, mv.toScreen(0,84).y);
      var yBot=Math.min(mv.H, mv.toScreen(0,-58).y);
      var sw=Math.round(mv.W*dpr), sh=Math.round((yBot-yTop)*dpr);
      var tmp=document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
      tmp.getContext('2d').drawImage(mv.cv, 0, Math.round(yTop*dpr), sw, sh, 0, 0, sw, sh);
      url=tmp.toDataURL('image/jpeg',0.9);
    }catch(e){ try{ url=mv.cv.toDataURL('image/jpeg',0.9); }catch(e2){ url=''; } }
    mv.z=save.z; mv.panX=save.panX; mv.panY=save.panY; mv.showHeat=save.heat; mv.showCities=save.cities; mv.clampPan(); mv.draw();
    return url;
  }

  // цветная легенда планет с положениями в знаках
  function legendHTML(){
    var rows=state.order.map(function(p){
      var b=state.bodies[p];
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;break-inside:avoid;">'+
        '<span style="width:24px;height:5px;border-radius:3px;background:'+ACG.COLORS[p]+';display:inline-block;flex:0 0 auto;"></span>'+
        '<span style="color:'+ACG.COLORS[p]+';font-size:16px;width:18px;text-align:center;">'+ACG.GLYPH[p]+'</span>'+
        '<span style="font-size:13px;">'+ACG.NAME_RU[p]+' — '+Astro.signOf(b.sidLon)+
        ', '+Astro.nakshatraOf(b.sidLon).name+'</span></div>';
    }).join('');
    return '<div style="columns:2;column-gap:30px;">'+rows+'</div>';
  }

  function buildReportHTML(){
    var b=state.bodies, ch=state.chart;
    var base=location.href.replace(/[?#].*$/,'').replace(/[^/]*$/,''); // каталог приложения
    var lineMap=worldSnapshot(false);
    var heatMap=worldSnapshot(true);

    var head='<div class="rep-head"><div class="rep-title">Джйотиш Астрокартография</div>'+
      '<div class="rep-sub">Персональный отчёт · сидерический зодиак · аянамша Лахири '+b._meta.ayanamsha.toFixed(2)+'°</div>'+
      (ch.name?'<div class="rep-name">Расчёт для: <b>'+ch.name+'</b></div>':'')+
      '<div class="rep-birth"><b>'+state.place.label+'</b> · '+ch.date+' '+ch.time+' ('+(ch.tzLabel||'')+')</div></div>';

    // карта + легенда держим вместе на одной странице
    var s1='<div class="pdf-sec keep">'+
      '<h2 class="section-title">Карта астрокартографии</h2>'+
      '<p class="section-sub">Планетные линии MC / IC / ASC / DSC по всему миру.</p>'+
      (lineMap?'<img class="rep-map" src="'+lineMap+'">':'')+
      '<h3 style="margin:12px 0 6px;">Легенда планет</h3>'+legendHTML()+'</div>';

    var s2=heatMap?'<div class="pdf-sec pb keep">'+
      '<h2 class="section-title">Тепловая карта благоприятности</h2>'+
      '<p class="section-sub">Зелёные зоны — более благоприятные, красные — требующие осторожности.</p>'+
      '<img class="rep-map" src="'+heatMap+'"></div>':'';

    var s3='<div class="pdf-sec pb"><h2 class="section-title">Натальная карта</h2>'+$('natal-body').innerHTML+'</div>';
    var s4='<div class="pdf-sec pb">'+$('pane-recs').innerHTML+'</div>';
    var s5='<div class="pdf-sec pb">'+$('pane-cities').innerHTML+'</div>';
    var s6='<div class="pdf-sec pb">'+$('pane-compare').innerHTML+'</div>';
    // отчёт без дублирующего дисклеймера (он есть в подвале s8)
    var repTmp=document.createElement('div'); repTmp.innerHTML=$('pane-report').innerHTML;
    var dz=repTmp.querySelector('.disclaimer'); if(dz) dz.remove();
    var s7='<div class="pdf-sec pb">'+repTmp.innerHTML+'</div>';
    var s8='<div class="pdf-sec rep-foot">'+
      '<p class="foot-disc"><b>Дисклеймер.</b> Астрокартография (астрогеография) не является прямой рекомендацией '+
      'к смене места жительства, переезду или поездке. Это информационный астрологический расчёт на основе традиционной '+
      'индийской астрологии (Джйотиш) для образовательных и личных целей. Результаты носят ознакомительный характер, '+
      'не гарантируют наступления каких-либо событий и не заменяют юридических, финансовых, медицинских или иных '+
      'профессиональных консультаций. Все решения вы принимаете самостоятельно.</p>'+
      '<p class="foot-cta-pdf"><b>Нужен персональный разбор?</b> Запишитесь на полную консультацию '+
      'к астрологу Светлане Кройцер: goroskop1008.ru/uslugi</p>'+
      '<p class="foot-cr">© 2026 Индийская астрология со Светланой Кройцер · goroskop1008.ru</p></div>';

    var css=''+
      '@page{size:A4;margin:11mm;}'+
      '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'+
      'body{margin:0;font-family:Arial,sans-serif;color:#2a2326;}'+
      '.pdfwrap{max-width:780px;margin:0 auto;padding:4px;}'+
      '.rep-head{border-bottom:3px solid #df2227;padding-bottom:12px;margin-bottom:16px;}'+
      '.rep-title{font-family:Jaipur,Georgia,serif;font-size:26px;color:#df2227;font-weight:bold;}'+
      '.rep-sub{font-size:12.5px;color:#6b6166;margin-top:2px;}'+
      '.rep-name{font-size:15px;margin-top:6px;color:#df2227;}'+
      '.rep-birth{font-size:13.5px;margin-top:4px;}'+
      '.rep-map{width:100%;max-height:120mm;object-fit:contain;border:1px solid #eee;border-radius:8px;display:block;}'+
      '.pdf-sec{margin-bottom:6px;}'+
      '.pdf-sec.pb{page-break-before:always;}'+
      '.pdf-sec.keep{break-inside:avoid;page-break-inside:avoid;}'+
      '.card{box-shadow:none!important;break-inside:avoid;page-break-inside:avoid;border:1px solid #eee;margin-bottom:10px;}'+
      '.grid-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;}'+
      '.rec-card{break-inside:avoid;page-break-inside:avoid;box-shadow:none!important;border:1px solid #eee;}'+
      'table.rep{break-inside:auto;} table.rep tr{break-inside:avoid;} table.rep th{break-inside:avoid;}'+
      'p,li,.bar,.suit,.pillrow{break-inside:avoid;page-break-inside:avoid;}'+
      'ol,ul{break-inside:auto;}'+
      'h2.section-title{break-after:avoid;page-break-after:avoid;font-size:20px;}'+
      'h3,h4{break-after:avoid;page-break-after:avoid;}'+
      'img{break-inside:avoid;}'+
      '.rep-foot{border-top:2px solid #df2227;margin-top:14px;padding-top:12px;}'+
      '.foot-disc{font-size:11px;color:#6b6166;line-height:1.55;margin:0 0 8px;}'+
      '.foot-disc b{color:#2a2326;}'+
      '.foot-cta-pdf{font-size:12.5px;color:#fff;background:linear-gradient(135deg,#df2227,#ef5024);padding:12px 16px;border-radius:10px;margin:0 0 10px;}'+
      '.foot-cta-pdf b{color:#fff;}'+
      '.foot-osm{font-size:10.5px;color:#9a9094;margin:0 0 8px;}'+
      '.foot-cr{font-size:12.5px;color:#df2227;font-weight:bold;margin:0;}';
    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'+
      '<title>Джйотиш Астрокартография — отчёт</title>'+
      '<link rel="stylesheet" href="'+base+'css/styles.css">'+
      '<style>'+css+'</style></head><body><div class="pdfwrap">'+
      head+s1+s2+s3+s4+s5+s6+s7+s8+
      '</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print();},600);};<\/script></body></html>';
  }

  function generatePDF(){
    if(!state.bodies){ alert('Сначала рассчитайте карту мира.'); return; }
    var html=buildReportHTML();
    // скрытый iframe — печатаем его содержимое (без всплывающих окон, работает в Tilda)
    var old=document.getElementById('__pdfframe'); if(old) old.remove();
    var ifr=document.createElement('iframe');
    ifr.id='__pdfframe';
    ifr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(ifr);
    var doc=ifr.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    // подчистим iframe спустя время (после закрытия диалога печати)
    setTimeout(function(){ try{ifr.remove();}catch(e){} }, 120000);
  }

  /* ---------- Кнопки шапки ---------- */
  function setupHeader(){
    $('btn-pdf').onclick=generatePDF;
    $('btn-report').onclick=function(){
      if(!state.bodies){alert('Сначала рассчитайте карту.');return;}
      document.querySelector('[data-pane="report"]').click();
      $('results').scrollIntoView({behavior:'smooth'});
    };
    $('btn-share').onclick=function(){
      var p={d:$('in-date').value,t:$('in-time').value,tz:$('in-tz').value,o:$('in-outer').value,nm:($('in-name').value||'')};
      if(state.place)p.pl=state.place.label+'|'+state.place.lat+'|'+state.place.lon;
      var url=location.origin+location.pathname+'#'+encodeURIComponent(JSON.stringify(p));
      navigator.clipboard&&navigator.clipboard.writeText(url);
      alert('Ссылка скопирована в буфер обмена:\n'+url);
    };
  }
  function loadFromHash(){
    if(!location.hash)return;
    try{
      var p=JSON.parse(decodeURIComponent(location.hash.slice(1)));
      if(p.d)$('in-date').value=p.d; if(p.t)$('in-time').value=p.t;
      if(p.tz)$('in-tz').value=p.tz; if(p.o)$('in-outer').value=p.o;
      if(p.nm)$('in-name').value=p.nm;
      if(p.pl){var a=p.pl.split('|');state.place={label:a[0],lat:+a[1],lon:+a[2]};$('in-place').value=a[0];$('place-coords').textContent='Координаты: '+(+a[1]).toFixed(2)+', '+(+a[2]).toFixed(2);
        state.tzid=(window.tzlookup)?(function(){try{return window.tzlookup(+a[1],+a[2]);}catch(e){return null;}})():null; updateTzInfo();}
    }catch(e){}
  }

  /* ---------- Инициализация ---------- */
  function init(){
    fillTZ(); fillFilters(); renderChips();
    setupAutocomplete('in-place','ac-place',function(c){
      state.place={label:c.name,lat:c.lat,lon:c.lon};
      var loc=[c.region,c.country].filter(Boolean).join(', ');
      $('place-coords').textContent='Координаты: '+c.lat.toFixed(2)+', '+c.lon.toFixed(2)+(loc?' · '+loc:'');
      state.tzid=(window.tzlookup)?(function(){try{return window.tzlookup(c.lat,c.lon);}catch(e){return null;}})():null;
      $('in-tz').value='auto';
      updateTzInfo();
    });
    $('in-tz').onchange=updateTzInfo;
    $('in-date').addEventListener('change',updateTzInfo);
    $('in-time').addEventListener('change',updateTzInfo);
    setupAutocomplete('in-city','ac-city',function(c){
      if(!state.analysisCities.some(function(x){return x.name===c.name;})) state.analysisCities.push(c);
      $('in-city').value=''; renderChips();
      if(state.lines)refreshAfterCities();
    });
    $('btn-calc').onclick=compute;
    setupTabs(); setupHeader();
    loadWorld().then(function(){ loadFromHash(); });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
