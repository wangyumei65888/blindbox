/* 微信扫码盲盒 - 免 Token 版（kvdb.io 存状态） */
(function () {
  'use strict';

  var KV_BUCKET = 'WYG27VqQxFx6VAMVShxuTv';
  var KV_BASE = 'https://kvdb.io/' + KV_BUCKET;
  var STATE_KEY = 'bbstate';

  var $ = function (s) { return document.querySelector(s); };
  var state = null, busy = false;

  /* ---------- 测试模式开关 ---------- */
  var FREE = /[?&]free=1/.test(location.search);   // 无限次抽（仅测试用）

  /* ---------- 云端读写 ---------- */
  function kvRead(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', KV_BASE + '/' + STATE_KEY + '?t=' + Date.now(), true);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status === 404) { cb('EMPTY'); return; }
      if (xhr.status !== 200) { cb('HTTP ' + xhr.status); return; }
      try {
        var t = xhr.responseText.trim();
        // kvdb 返回的是 JSON5-ish，直接解析
        cb(null, JSON.parse(t));
      } catch (e) {
        // 尝试宽松修复（key 无引号）
        try {
          var fixed = xhr.responseText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
          cb(null, JSON.parse(fixed));
        } catch (e2) { cb('解析失败'); }
      }
    };
    xhr.onerror = function () { cb('网络错误'); };
    xhr.ontimeout = function () { cb('超时'); };
    xhr.send();
  }

  // kvdb 的 POST 不覆盖旧值，必须先 DELETE 再 POST
  function kvWrite(obj, cb) {
    var url = KV_BASE + '/' + STATE_KEY;
    var del = new XMLHttpRequest();
    del.open('DELETE', url, true);
    del.timeout = 20000;
    del.onload = function () { doPost(); };
    del.onerror = function () { doPost(); };   // 删失败也继续尝试写
    del.ontimeout = function () { doPost(); };
    del.send();

    function doPost() {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.timeout = 25000;
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 201) { cb(null); }
        else { cb('HTTP ' + xhr.status); }
      };
      xhr.onerror = function () { cb('网络错误'); };
      xhr.ontimeout = function () { cb('超时'); };
      xhr.send(JSON.stringify(obj));
    }
  }

  /* ---------- 抽奖 ---------- */
  function pickPrize(st) {
    var pool = [];
    var list = st.prizes || st.p || [];
    list.forEach(function (p) {
      var left = (p.stock != null ? p.stock : p.s) - (p.sent || 0);
      if (left > 0) { pool.push(p); }
    });
    if (!pool.length) return null;
    // 纯随机：每个人机会均等，与顺序无关
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function norm(st) {
    // 兼容 kvdb 返回的简写字段
    var list = st.prizes || st.p || [];
    return list.map(function (p, i) {
      return {
        id: p.id != null ? p.id : (p.i != null ? p.i : i + 1),
        name: p.name || p.n || '',
        icon: p.icon || p.ic || '🎁',
        tier: p.tier || p.t || '',
        color: p.color || p.c || '#8b94c2',
        stock: p.stock != null ? p.stock : (p.s != null ? p.s : 1),
        sent: p.sent || 0
      };
    });
  }

  function genCode(uid) {
    var A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', h = 5381;
    for (var i = 0; i < uid.length; i++) h = ((h << 5) + h + uid.charCodeAt(i)) >>> 0;
    var out = '';
    for (var j = 0; j < 6; j++) { out += A[h % A.length]; h = Math.floor(h / A.length) + 7; }
    return 'BX' + out;
  }

  function getUid() {
    var u = localStorage.getItem('bx_uid');
    if (!u) { u = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); localStorage.setItem('bx_uid', u); }
    return u;
  }

  function doDraw() {
    if (busy) return;
    busy = true;
    $('#drawBtn').disabled = true;
    var finish = playDraw(function () { busy = false; $('#drawBtn').disabled = false; });
    var uid = getUid();

    // 本机已抽过（测试模式跳过）
    if (!FREE) {
      try {
        var prev = JSON.parse(localStorage.getItem('bx_result') || 'null');
        if (prev && prev.uid === uid) { finish(prev); return; }
      } catch (e) {}
    }

    kvRead(function (err, st) {
      if (err) { finish({ __error: true, msg: err }); return; }
      var prizes = norm(st);

      // 云端已抽过（测试模式跳过）
      var recs = st.records || st.r || [];
      if (!FREE) {
        for (var i = 0; i < recs.length; i++) {
          if (recs[i].uid === uid) {
            try { localStorage.setItem('bx_result', JSON.stringify(recs[i])); } catch (e) {}
            finish(recs[i]); return;
          }
        }
      }

      var p = pickPrize({ prizes: prizes });
      var rec = {
        uid: uid,
        code: genCode(uid),
        prizeId: p ? p.id : 0,
        name: p ? p.name : '谢谢参与',
        icon: p ? p.icon : '🎈',
        tier: p ? p.tier : '未中奖',
        color: p ? p.color : '#94a3b8',
        time: new Date().toLocaleString('zh-CN')
      };

      if (p) {
        for (var k = 0; k < prizes.length; k++) {
          if (prizes[k].id === p.id) { prizes[k].sent = (prizes[k].sent || 0) + 1; }
        }
      }
      var newState = {
        prizes: prizes,
        records: recs.concat([rec]),
        updated: new Date().toISOString()
      };

      kvWrite(newState, function (e2) {
        if (e2) { finish({ __error: true, msg: e2 }); return; }
        try { localStorage.setItem('bx_result', JSON.stringify(rec)); } catch (e) {}
        state = newState;
        render({ prizes: prizes, records: newState.records });
        // 高亮刚抽走的那一格（该奖品里第一个还没抽的格子）
        var tiles = document.querySelectorAll('.tile[data-id="' + rec.prizeId + '"]');
        for (var q = 0; q < tiles.length; q++) {
          if (!tiles[q].classList.contains('gone')) { tiles[q].classList.add('win'); break; }
        }
        finish(rec);
      });
    });
  }

  /* ---------- 动画 ---------- */
  function playDraw(cb) {
    var overlay = $('#overlay'), box = $('#box'), card = $('#card'),
        loading = $('#loading'), flash = $('#flash'), note = $('#cardNote');
    card.classList.remove('show');
    overlay.classList.add('show');
    box.classList.remove('open');
    box.classList.add('shake');
    loading.classList.add('show');
    flash.classList.remove('go');
    $('#cardCode').textContent = '';

    var t0 = Date.now(), MIN = 1000, done = false;
    return function (payload) {
      if (done) return; done = true;
      var wait = Math.max(0, MIN - (Date.now() - t0));
      setTimeout(function () {
        loading.classList.remove('show');
        box.classList.remove('shake');
        box.classList.add('open');
        flash.classList.add('go');
        if (!payload || !payload.__error) confetti();
        setTimeout(function () {
          if (payload && payload.__error) {
            $('#cardTier').textContent = '开盒失败';
            $('#cardTier').style.color = '#ff9db8';
            $('#cardIcon').textContent = '⚠️';
            $('#cardName').textContent = '网络开小差了';
            $('#cardCode').textContent = '';
            note.textContent = payload.msg || '请稍后重试';
          } else if (payload && payload.prizeId) {
            // 正常中奖（含"谢谢参与"，也算抽到了东西）
            // 只有设置了等级才显示等级标签，其余只显示商品名
            var tierEl = $('#cardTier');
            if (payload.tier) {
              tierEl.textContent = payload.tier;
              tierEl.style.display = '';
              tierEl.style.color = payload.color || '#ffd75e';
              tierEl.style.background = (payload.color || '#ffd75e') + '22';
              tierEl.style.borderColor = (payload.color || '#ffd75e') + '66';
            } else {
              tierEl.textContent = '';
              tierEl.style.display = 'none';
            }
            $('#cardIcon').textContent = payload.icon || '🎁';
            $('#cardName').textContent = payload.name;
            $('#cardCode').textContent = payload.code || '';
            note.textContent = payload.name === '谢谢参与'
              ? '别灰心，下次好运～'
              : '截图保存，找工作人员兑奖';
          } else {
            $('#cardTier').textContent = '未中奖';
            $('#cardTier').style.color = '#94a3b8';
            $('#cardIcon').textContent = '🎈';
            $('#cardName').textContent = '奖品已被抽完啦';
            $('#cardCode').textContent = '';
            note.textContent = '下次活动早点来～';
          }
          card.classList.add('show');
          cb(payload);
        }, 360);
      }, wait);
    };
  }

  /* ---------- 渲染 ---------- */
  function render(st) {
    var prizes = st.prizes || [];
    var wall = $('#wall');
    wall.innerHTML = '';

    var totalQty = 0, remainQty = 0;

    prizes.forEach(function (p) {
      var stock = p.stock || 0;
      var sent  = p.sent || 0;
      totalQty  += stock;
      remainQty += Math.max(0, stock - sent);

      // 按份数展开：一份 = 一个格子，抽走的那几份标记为"已抽"
      for (var i = 0; i < stock; i++) {
        var isGone = (i < sent);
        var d = document.createElement('div');
        d.className = 'tile' + (isGone ? ' gone' : '');
        d.setAttribute('data-id', p.id);
        d.setAttribute('data-unit', i);
        d.innerHTML =
          '<i class="tk" style="background:' + (p.color || '#8b94c2') + '"></i>' +
          '<span class="ic">' + (p.icon || '🎁') + '</span>' +
          '<span class="nm">' + (p.name || '') + '</span>';
        wall.appendChild(d);
      }
    });

    $('#remainCount').textContent = remainQty;
    $('#totalCount').textContent = totalQty;
    $('#meterFill').style.width = (totalQty ? Math.max(2, remainQty / totalQty * 100) : 2) + '%';
  }

  /* ---------- 彩带 ---------- */
  var cvs = $('#fx'), cx = cvs.getContext('2d'), parts = [], raf = null;
  function sizeCanvas() {
    var dpr = Math.min(devicePixelRatio || 1, 2);
    cvs.width = innerWidth * dpr; cvs.height = innerHeight * dpr;
    cvs.style.width = innerWidth + 'px'; cvs.style.height = innerHeight + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas(); addEventListener('resize', sizeCanvas);

  function confetti() {
    var C = ['#ffd75e', '#ff6fa5', '#7c5cff', '#5ce0c9', '#ff9f68', '#fff'];
    for (var i = 0; i < 80; i++) {
      parts.push({
        x: innerWidth / 2 + (Math.random() - .5) * 90, y: innerHeight / 2 + (Math.random() - .5) * 40,
        vx: (Math.random() - .5) * 13, vy: -Math.random() * 13 - 3, g: .28 + Math.random() * .16,
        s: 3 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - .5) * .3,
        c: C[(Math.random() * C.length) | 0], life: 1
      });
    }
    if (!raf) loop();
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    cx.clearRect(0, 0, innerWidth, innerHeight);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= .995; p.r += p.vr; p.life -= .0075;
      if (p.life <= 0 || p.y > innerHeight + 40) { parts.splice(i, 1); continue; }
      cx.save(); cx.globalAlpha = Math.max(0, p.life);
      cx.translate(p.x, p.y); cx.rotate(p.r);
      cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .62);
      cx.restore();
    }
    if (!parts.length) { cancelAnimationFrame(raf); raf = null; cx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  /* ---------- 启动 ---------- */
  $('#drawBtn').addEventListener('click', doDraw);
  $('#cardBtn').addEventListener('click', function () {
    $('#overlay').classList.remove('show');
    $('#box').classList.remove('open');
    $('#card').classList.remove('show');
  });

  $('#tip').textContent = '正在读取奖池...';
  kvRead(function (err, st) {
    if (err) {
      $('#tip').textContent = '读取失败: ' + err;
      return;
    }
    render({ prizes: norm(st) });
    var uid = getUid();

    if (FREE) {
      // 测试模式：每次都当新用户
      $('#drawBtn').querySelector('.lbl').textContent = '测试：随便抽';
      var remain0 = norm(st).filter(function (p) { return p.stock - p.sent > 0; }).length;
      $('#tip').textContent = '【测试模式】还剩 ' + remain0 + ' 份，可无限次抽';
      return;
    }

    var recs = st.records || st.r || [];
    var mine = null;
    for (var i = 0; i < recs.length; i++) { if (recs[i].uid === uid) { mine = recs[i]; break; } }
    if (mine) {
      $('#drawBtn').querySelector('.lbl').textContent = '查看我的奖品';
      $('#tip').textContent = '你已抽过：' + mine.name;
    } else {
      try { localStorage.removeItem('bx_result'); } catch (e) {}
      var remain = norm(st).filter(function (p) { return p.stock - p.sent > 0; }).length;
      $('#tip').textContent = '还剩 ' + remain + ' 份，点击开盒';
    }
  });
})();
