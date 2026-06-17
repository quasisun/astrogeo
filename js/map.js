/* ============================================================
   map.js — Интерактивная карта астрокартографии (canvas, равнопромежуточная проекция)
   Панорама/зум, мировые контуры, планетные линии, тепловая карта, хит-тест.
   ============================================================ */
(function (global) {
  'use strict';

  function MapView(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;          // geojson
    this.lines = [];            // линии астрокартографии
    this.cities = [];           // маркеры
    this.birth = null;          // {lat,lon}
    this.selected = null;       // {lat,lon}
    this.heat = null;           // {step, grid}
    this.showHeat = false;
    this.cityScores = [];       // [{name,lat,lon,score}] — города с оценкой
    this.showCities = false;
    this.visPlanet = {};        // planet -> bool
    this.visType = {MC:true,IC:true,ASC:true,DSC:true};
    this.z = 1; this.panX = 0; this.panY = 0;
    this.onClickPoint = opts && opts.onClickPoint;
    this.onHoverLine = opts && opts.onHoverLine;
    this.onClickLine = opts && opts.onClickLine;
    this._init();
  }

  MapView.prototype._init = function(){
    var self = this;
    this.resize();
    window.addEventListener('resize', function(){ self.resize(); self.draw(); });
    var dragging=false, lastX, lastY, moved=0;
    this.cv.addEventListener('mousedown', function(e){ dragging=true; moved=0; lastX=e.clientX; lastY=e.clientY; });
    window.addEventListener('mouseup', function(e){
      if (dragging && moved < 5) self._handleClick(e);
      dragging=false;
    });
    this.cv.addEventListener('mousemove', function(e){
      if (dragging){
        var dx=e.clientX-lastX, dy=e.clientY-lastY; moved+=Math.abs(dx)+Math.abs(dy);
        self.panX+=dx; self.panY+=dy; lastX=e.clientX; lastY=e.clientY; self.clampPan(); self.draw();
      } else {
        self._handleHover(e);
      }
    });
    this.cv.addEventListener('wheel', function(e){
      e.preventDefault();
      var r=self.cv.getBoundingClientRect();
      self.zoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY<0?1.15:1/1.15);
    }, {passive:false});
    // touch
    var pinch=0;
    this.cv.addEventListener('touchstart',function(e){
      if(e.touches.length===1){dragging=true;moved=0;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;}
      else if(e.touches.length===2){pinch=dist2(e.touches);}
    });
    this.cv.addEventListener('touchmove',function(e){
      e.preventDefault();
      if(e.touches.length===1&&dragging){
        var dx=e.touches[0].clientX-lastX,dy=e.touches[0].clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);
        self.panX+=dx;self.panY+=dy;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;self.clampPan();self.draw();
      } else if(e.touches.length===2){
        var d=dist2(e.touches);if(pinch){var r=self.cv.getBoundingClientRect();var c=midpt(e.touches);self.zoomAt(c.x-r.left,c.y-r.top,d/pinch);}pinch=d;
      }
    },{passive:false});
    this.cv.addEventListener('touchend',function(e){if(e.touches.length===0){dragging=false;pinch=0;}});
    function dist2(t){var dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.sqrt(dx*dx+dy*dy);}
    function midpt(t){return {x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2};}
  };

  MapView.prototype.resize = function(){
    var r=this.cv.parentNode.getBoundingClientRect();
    var dpr=window.devicePixelRatio||1;
    this.W=r.width; this.H=r.height;
    this.cv.width=r.width*dpr; this.cv.height=r.height*dpr;
    this.cv.style.width=r.width+'px'; this.cv.style.height=r.height+'px';
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.baseScale = this.W/360;
    this.clampPan();
  };

  MapView.prototype.worldHeight=function(){return this.baseScale*this.z*180;};
  MapView.prototype.clampPan=function(){
    // не давать уезжать карте далеко по вертикали
    var wh=this.worldHeight();
    if(wh<=this.H){ this.panY=(this.H-wh)/2; }
    else { this.panY=Math.min(0,Math.max(this.H-wh,this.panY)); }
  };

  MapView.prototype.zoomAt=function(px,py,factor){
    var g=this.toGeo(px,py);
    this.z=Math.max(1,Math.min(12,this.z*factor));
    // удержать точку под курсором
    var s=this.baseScale*this.z;
    this.panX=px-(g.lon+180)*s;
    this.panY=py-(90-g.lat)*s;
    this.wrapPanX();
    this.clampPan();
    this.draw();
  };
  MapView.prototype.wrapPanX=function(){
    var s=this.baseScale*this.z, ww=s*360;
    // горизонтальная цикличность
    this.panX = ((this.panX % ww) + ww) % ww;
    if (this.panX>0) this.panX-=ww;
  };

  MapView.prototype.toScreen=function(lon,lat){
    var s=this.baseScale*this.z;
    return { x:(lon+180)*s+this.panX, y:(90-lat)*s+this.panY };
  };
  MapView.prototype.toGeo=function(px,py){
    var s=this.baseScale*this.z;
    var lon=(px-this.panX)/s-180;
    var lat=90-(py-this.panY)/s;
    lon=((lon+180)%360+360)%360-180;
    return { lon:lon, lat:Math.max(-90,Math.min(90,lat)) };
  };

  /* ---------- Рисование ---------- */
  MapView.prototype.draw=function(){
    var c=this.ctx, W=this.W, H=this.H;
    c.clearRect(0,0,W,H);
    // океан
    c.fillStyle='#f3f9ff'; c.fillRect(0,0,W,H);
    var s=this.baseScale*this.z, ww=s*360;
    // рисуем мир и слои с горизонтальным повтором (для бесшовной прокрутки)
    for(var rep=-1;rep<=1;rep++){
      c.save(); c.translate(rep*ww,0);
      this._drawWorld(c,s);
      c.restore();
    }
    if(this.showHeat&&this.heat) this._drawHeat(c,s,ww);
    this._drawGraticule(c,s);
    for(var rp=-1;rp<=1;rp++){
      c.save(); c.translate(rp*ww,0);
      this._drawLines(c);
      c.restore();
    }
    if(this.showCities) this._drawCityScores(c);
    this._drawMarkers(c);
  };

  // цветные точки городов: зелёный — благоприятно, жёлтый — нейтрально, красный — осторожно
  MapView.prototype._drawCityScores=function(c){
    var self=this;
    this.cityScores.forEach(function(ct){
      var p=self.toScreen(ct.lon,ct.lat);
      if(p.x<-6||p.x>self.W+6||p.y<-6||p.y>self.H+6) return;
      var col=ct.score>=66?'#1FA84F':ct.score>=45?'#E5A300':'#df2227';
      c.beginPath(); c.arc(p.x,p.y,4.5,0,7); c.fillStyle=col; c.fill();
      c.strokeStyle='#fff'; c.lineWidth=1.6; c.stroke();
      if(self.z>=3){
        c.fillStyle='#2a2326'; c.font='10px Arial';
        c.fillText(ct.name+' ('+ct.score+')', p.x+7, p.y+3);
      }
    });
  };

  MapView.prototype._drawWorld=function(c,s){
    if(!this.world) return;
    c.fillStyle='#eef0ec'; c.strokeStyle='#d9ddd6'; c.lineWidth=0.6;
    var feats=this.world.features, self=this;
    function ring(coords){
      c.beginPath();
      for(var i=0;i<coords.length;i++){
        var p=self.toScreen(coords[i][0],coords[i][1]);
        if(i===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);
      }
      c.closePath(); c.fill(); c.stroke();
    }
    for(var f=0;f<feats.length;f++){
      var g=feats[f].geometry; if(!g)continue;
      if(g.type==='Polygon'){ for(var r=0;r<g.coordinates.length;r++) ring(g.coordinates[r]); }
      else if(g.type==='MultiPolygon'){ for(var pp=0;pp<g.coordinates.length;pp++) for(var rr=0;rr<g.coordinates[pp].length;rr++) ring(g.coordinates[pp][rr]); }
    }
  };

  MapView.prototype._drawGraticule=function(c,s){
    c.strokeStyle='rgba(120,120,140,.12)'; c.lineWidth=1; c.fillStyle='rgba(90,90,110,.45)';
    c.font='10px Arial';
    for(var lon=-180;lon<=180;lon+=30){
      var a=this.toScreen(lon,85), b=this.toScreen(lon,-85);
      c.beginPath();c.moveTo(a.x,0);c.lineTo(a.x,this.H);c.stroke();
    }
    for(var lat=-60;lat<=60;lat+=30){
      var p=this.toScreen(-180,lat), q=this.toScreen(180,lat);
      c.beginPath();c.moveTo(0,p.y);c.lineTo(this.W,p.y);c.stroke();
      c.fillText((lat>0?lat+'°N':lat<0?(-lat)+'°S':'Экватор'),6,p.y-3);
    }
    // экватор ярче
    var eq=this.toScreen(0,0); c.strokeStyle='rgba(120,120,140,.22)';c.beginPath();c.moveTo(0,eq.y);c.lineTo(this.W,eq.y);c.stroke();
  };

  MapView.prototype._lineVisible=function(line){
    if(this.visPlanet[line.planet]===false) return false;
    if(this.visType[line.type]===false) return false;
    return true;
  };

  MapView.prototype._drawLines=function(c){
    for(var i=0;i<this.lines.length;i++){
      var L=this.lines[i]; if(!this._lineVisible(L))continue;
      var dashed=(L.type==='IC'||L.type==='DSC');
      c.strokeStyle=L.color; c.lineWidth=(L.type==='MC'||L.type==='ASC')?2.4:1.8;
      c.globalAlpha=0.92;
      c.setLineDash(dashed?[7,5]:[]);
      for(var sgi=0;sgi<L.segments.length;sgi++){
        var seg=L.segments[sgi]; if(seg.length<2)continue;
        c.beginPath();
        for(var k=0;k<seg.length;k++){
          var p=this.toScreen(seg[k][0],seg[k][1]);
          if(k===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);
        }
        c.stroke();
      }
      c.setLineDash([]); c.globalAlpha=1;
      this._labelLine(c,L);
    }
  };

  MapView.prototype._labelLine=function(c,L){
    // подпись у верхнего пересечения с видимой областью
    var ACG=global.ACG;
    var anchorLon, anchorLat=70;
    if(L.type==='MC'||L.type==='IC') anchorLon=L.meridian;
    else { // взять точку сегмента около верхней трети
      var seg=L.segments[Math.floor(L.segments.length/2)]||L.segments[0]; if(!seg)return;
      var pt=seg[Math.floor(seg.length*0.3)]||seg[0]; anchorLon=pt[0]; anchorLat=pt[1];
    }
    var p=this.toScreen(anchorLon,anchorLat);
    if(p.x<-20||p.x>this.W+20) return;
    var y=Math.max(16,Math.min(this.H-6,p.y));
    var label=ACG.GLYPH[L.planet]+' '+L.type;
    c.font='bold 12px Arial';
    var w=c.measureText(label).width+12;
    c.fillStyle='rgba(255,255,255,.86)';
    roundRect(c,p.x-w/2,y-9,w,18,9); c.fill();
    c.fillStyle=L.color; c.textAlign='center'; c.textBaseline='middle';
    c.fillText(label,p.x,y);
    c.textAlign='left';c.textBaseline='alphabetic';
  };

  MapView.prototype._drawHeat=function(c,s,ww){
    var H=this.heat, step=H.step;
    c.globalAlpha=0.42;
    for(var i=0;i<H.grid.length;i++){
      var cell=H.grid[i];
      var col=heatColor(cell.v);
      for(var rep=-1;rep<=1;rep++){
        var a=this.toScreen(cell.lon-step/2,cell.lat+step/2);
        a.x+=rep*ww;
        var px=s*step+1;
        if(a.x+px<0||a.x>this.W)continue;
        c.fillStyle=col; c.fillRect(a.x,a.y,px,s*step+1);
      }
    }
    c.globalAlpha=1;
  };

  MapView.prototype._drawMarkers=function(c){
    var self=this;
    function dot(loc,color,r,ring){
      var p=self.toScreen(loc.lon,loc.lat);
      if(ring){c.beginPath();c.arc(p.x,p.y,r+5,0,7);c.strokeStyle=color;c.lineWidth=2;c.globalAlpha=.4;c.stroke();c.globalAlpha=1;}
      c.beginPath();c.arc(p.x,p.y,r,0,7);c.fillStyle=color;c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();
      return p;
    }
    this.cities.forEach(function(ct){
      var p=dot(ct,'#ef5024',4);
      c.fillStyle='#2a2326';c.font='11px Arial';c.fillText(ct.name,p.x+7,p.y+3);
    });
    if(this.birth){ var p=dot(this.birth,'#df2227',6,true);
      c.fillStyle='#df2227';c.font='bold 11px Arial';c.fillText('★ '+(this.birth.label||'Место рождения'),p.x+9,p.y+3);}
    if(this.selected){ dot(this.selected,'#1F3A93',6,true); }
  };

  /* ---------- Хит-тест линий ---------- */
  MapView.prototype._nearestLine=function(px,py){
    var best=null,bestD=14; // px
    for(var i=0;i<this.lines.length;i++){
      var L=this.lines[i]; if(!this._lineVisible(L))continue;
      var s=this.baseScale*this.z, ww=s*360;
      for(var rep=-1;rep<=1;rep++){
        for(var sgi=0;sgi<L.segments.length;sgi++){
          var seg=L.segments[sgi];
          for(var k=0;k<seg.length-1;k++){
            var a=this.toScreen(seg[k][0],seg[k][1]); a.x+=rep*ww;
            var b=this.toScreen(seg[k+1][0],seg[k+1][1]); b.x+=rep*ww;
            var d=ptSeg(px,py,a.x,a.y,b.x,b.y);
            if(d<bestD){bestD=d;best=L;}
          }
        }
      }
    }
    return best;
  };

  MapView.prototype._handleHover=function(e){
    var r=this.cv.getBoundingClientRect();
    var px=e.clientX-r.left, py=e.clientY-r.top;
    var L=this._nearestLine(px,py);
    this.cv.style.cursor=L?'pointer':'grab';
    if(this.onHoverLine) this.onHoverLine(L, e, this.toGeo(px,py));
  };
  MapView.prototype._handleClick=function(e){
    var r=this.cv.getBoundingClientRect();
    var px=e.clientX-r.left, py=e.clientY-r.top;
    var L=this._nearestLine(px,py);
    var geo=this.toGeo(px,py);
    if(L && this.onClickLine) this.onClickLine(L, geo);
    else if(this.onClickPoint) this.onClickPoint(geo);
  };

  // утилиты
  function ptSeg(px,py,x1,y1,x2,y2){
    var dx=x2-x1,dy=y2-y1; if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
    var t=((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy); t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function heatColor(v){
    // v 0..100 : красно-кирпичный (низко) -> жёлтый -> зелёный (высоко)
    if(v>=50){ var t=(v-50)/50; return 'rgb('+Math.round(230-150*t)+','+Math.round(170+18*t)+','+Math.round(60+20*t)+')'; }
    var u=v/50; return 'rgb('+Math.round(214)+','+Math.round(60+110*u)+','+Math.round(50+10*u)+')';
  }

  global.MapView = MapView;
  global._heatColor = heatColor;
})(typeof window !== 'undefined' ? window : globalThis);
