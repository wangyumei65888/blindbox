/* 微信扫码盲盒 - GitHub Pages 版（数据存 GitHub 仓库，全局库存唯一） */
(function () {
  'use strict';

  /* ============ 配置 ============ */
  var OWNER  = 'wangyumei65888';
  var REPO   = 'blindbox';
  var BRANCH = 'main';
  var STATE_FILE = 'state.json';
  var TOKEN_KEY  = 'bx_gh_token';

  var $ = function (s) { return document.querySelector(s); };
  var cfg = null, state = null, stateSha = null, busy = false;

  /* ============ token 管理 ============ */
  function getToken() {
    var t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = prompt('首次使用，请粘贴 GitHub Token（只需一次，存在本机）\n\n格式: ghp_xxxxx');
      if (t) { t = t.trim(); localStorage.setItem(TOKEN_KEY, t); }
    }
    return t;
  }

  /* ============ GitHub API ============ */
  function ghUrl(p) {
    return 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + p;
  }
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\s/g, ''))));
  }

  function ghGet(path, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', ghUrl(path) + '?ref=' + BRANCH + '&t=' + Date.now(), true);
    xhr.setRequestHeader('Authorization', 'token ' + getToken());
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          cb(null, JSON.parse(b64decode(d.content)), d.sha);
        } catch (e) { cb('数据解析失败: ' + e.message); }
      } else if (xhr.status === 404) {
        cb('404', null, null);
      } else if (xhr.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        cb('Token 无效，请重试');
      } else {
        cb('HTTP ' + xhr.status);
      }
    };
    xhr.onerror = function () { cb('网络错误'); };
    xhr.ontimeout = function () { cb('请求超时'); };
    xhr.send();
  }

  function ghPut(path, obj, sha, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', ghUrl(path), true);
    xhr.setRequestHeader('Authorization', 'token ' + getToken());
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 20000;
    var body = {
      message: 'draw ' + new Date().toISOString(),
      content: b64encode(JSON.stringify(obj)),
      branch: BRANCH
    };
    if (sha) body.sha = sha;
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 201) {
        try { cb(null, JSON.parse(xhr.responseText).content.sha); }
        catch (e) { cb(null, null); }
      } else if (xhr.status === 409) {
        cb('conflict');
      } else {
        cb('HTTP ' + xhr.status + ' ' + xhr.responseText.slice(0, 120));
      }
    };
    xhr.onerror = function () { cb('网络错误'); };
    xhr.ontimeout = function () { cb('请求超时'); };
    xhr.send(JSON.stringify(body));
  }

  /* ============ 抽奖逻辑 ============ */
  function pickPrize(st) {
    var pool = [], total = 0;
    st.prizes.forEach(function (p) {
      var left = p.stock - p.sent;
      if (left > 0) {
        var w = p.weight || 1;
        pool.push({ p: p, w: w });
        total += w;
      }
    });
    if (!total) return null;
    var roll = Math.random() * total, acc = 0;
    for (var i = 0; i < pool.length; i++) {
      acc += pool[i].w;
      if (roll < acc) return pool[i].p;
    }
    return pool[pool.length - 1].p;
  }

  function genCode(uid) {
    var A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', h = 0, out = '';
    for (var i = 0; i < uid.length; i++) { h = (h * 31 + uid.charCodeAt(i)) >>> 0; }
    for (var j = 0; j < 6; j++) { out += A[(h >>> (j * 4)) % A.length]; }
    return 'BX' + out;
  }

  function getUid() {
    var u = localStorage.getItem('bx_uid');
    if (!u) { u = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('bx_uid', u); }
    return u;
  }

  function doDraw() {
    if (busy) return;
    busy = true;
    $('#drawBtn').disabled = true;
    var finish = playDraw(function () { busy = false; $('#drawBtn').disabled = false; });

    ghGet(STATE_FILE, function (err, st, sha) {
      if (err) { finish({ __error: true, msg: err }); return; }
      state = st; stateSha = sha;
      var uid = getUid();

      // 已抽过
      var prev = (st.records || []).filter(function (r) { return r.uid === uid; })[0];
      if (prev) { finish(prev); return; }

      var prize = pickPrize(st);
      var code = genCode(uid + prize?.id + Date.now());
      var rec = prize ? {
        uid: uid, code: code, prizeId: prize.id, name: prize.name,
        icon: prize.icon, tier: prize.tier, color: prize.color,
        time: new Date().toLocaleString('zh-CN')
      } : { uid: uid, code: code, prizeId: 0, name: '谢谢参与', icon: '🎈', tier: '未中奖', color: '#94a3b8', time: new Date().toLocaleString('zh-CN') };

      if (prize) prize.sent = (prize.sent || 0) + 1;
      st.records = (st.records || []).concat([rec]);
      st.updated = new Date().toISOString();

      ghPut(STATE_FILE, st, sha, function (e2, newSha) {
        if (e2 === 'conflict') {
          // 有人同时抽，重试一次
          ghGet(STATE_FILE, function (e3, st2, sha2) {
            if (e3) { finish({ __error: true, msg: '重试失败' }); return; }
            var p2 = pickPrize(st2);
            var rec2 = p2 ? { uid: uid, code: code, prizeId: p2.id, name: p2.name, icon: p2.icon, tier: p2.tier, color: p2.color, time: new Date().toLocaleString('zh-CN') }
                          : { uid: uid, code: code, prizeId: 0, name: '谢谢参与', icon: '🎈', tier: '未中奖', color: '#94a3b8', time: new Date().toLocaleString('zh-CN') };
            if (p2) p2.sent = (p2.sent || 0) + 1;
            st2.records = (st2.records || []).concat([rec2]);
            struct = st2;
            ghPut(STATE_FILE, st2, sha2, function (e4) {
              if (e4) { finish({ __error: true, msg: e4 }); return; }
              applyResult(rec2); finish(rec2);
            });
          });
          return;
        }
        if (e2) { finish({ __error: true, msg: e2 }); return; }
        stateSha = newSha;
        applyResult(rec);
        finish(rec);
      });
    });
  }

  var struct = null;

  function applyResult(rec) {
    try { localStorage.setItem('bx_result', JSON.stringify(rec)); } catch (e) {}
    var t = document.querySelector('.tile[data-id="' + rec.prizeId + '"]');
    if (t) { t.classList.remove('gone'); t.classList.add('win'); }
    updateMeter();
  }

  /* ============ 动画（简化） ============ */
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
    note.textContent = '截图保存，找工作人员兑奖';

    var t0 = Date.now(), MIN = 1200, done = false;
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
          } else if (payload && payload.name && payload.prizeId !== 0) {
            $('#cardTier').textContent = payload.tier || '恭喜';
            $('#cardTier').style.color = payload.color || '#ffd75e';
            $('#cardIcon').textContent = payload.icon || '🎁';
            $('#cardName').textContent = payload.name;
            $('#cardCode').textContent = payload.code || '';
            note.textContent = '截图保存，找工作人员兑奖';
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
        }, 380);
      }, wait);
    };
  }

  /* ============ 渲染 ============ */
  function render(st) {
    state = st;
    $('#brand').textContent = '扫码开盲盒';
    $('#headline').textContent = '50 份好礼 · 随机掉落';
    $('#subline').textContent = '微信扫码 · 每人限抽 1 次';
    var wall = $('#wall');
    wall.innerHTML = '';
    st.prizes.forEach(function (p) {
      var left = p.stock - p.sent;
      var d = document.createElement('div');
      d.className = 'tile' + (left <= 0 ? ' gone' : '');
      d.setAttribute('data-id', p.id);
      d.innerHTML = '<i class="tk" style="background:' + (p.color || '#8b94c2') + '"></i>' +
        '<span class="ic">' + (p.icon || '🎁') + '</span>' +
        '<span class="nm">' + (p.name || '') + '</span>';
      wall.appendChild(d);
    });
    updateMeter();
  }

  function updateMeter() {
    if (!state) return;
    var total = state.prizes.length, remain = 0;
    state.prizes.forEach(function (p) { if (p.stock - p.sent > 0) remain++; });
    $('#remainCount').textContent = remain;
    $('#totalCount').textContent = total;
    $('#meterFill').style.width = Math.max(2, remain / total * 100) + '%';
  }

  /* ============ 彩带 ============ */
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

  /* ============ 启动 ============ */
  $('#drawBtn').addEventListener('click', doDraw);
  $('#cardBtn').addEventListener('click', function () {
    $('#overlay').classList.remove('show');
    $('#box').classList.remove('open');
    $('#card').classList.remove('show');
  });

  // 点标题 5 次可重置本机 token
  var cnt = 0, tmr = null;
  $('#brand').addEventListener('click', function () {
    cnt++;
    clearTimeout(tmr);
    tmr = setTimeout(function () { cnt = 0; }, 1500);
    if (cnt >= 5) { localStorage.removeItem(TOKEN_KEY); alert('Token 已清除，刷新页面重新输入'); cnt = 0; }
  });

  // 加载状态
  $('#tip').textContent = '正在读取奖池...';
  ghGet(STATE_FILE, function (err, st, sha) {
    if (err) {
      $('#tip').textContent = '读取失败: ' + err;
      return;
    }
    stateSha = sha;
    render(st);
    var uid = getUid();
    var mine = (st.records || []).filter(function (r) { return r.uid === uid; })[0];
    if (mine) {
      $('#drawBtn').querySelector('.lbl').textContent = '查看我的奖品';
      $('#tip').textContent = '你已抽过：' + mine.name;
    } else {
      var remain = st.prizes.filter(function (p) { return p.stock - p.sent > 0; }).length;
      $('#tip').textContent = '还剩 ' + remain + ' 份，点击开盒';
    }
  });
})();
