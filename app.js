(() => {
  const $ = (id) => document.getElementById(id);
  const ANIMALS = [
    { id: 'cheetah', name: 'Cheetah', trait: 'Speed', tint: '#B45309' },
    { id: 'wolf', name: 'Wolf', trait: 'Endurance', tint: '#475569' },
    { id: 'eagle', name: 'Eagle', trait: 'Jumps & dives', tint: '#7C2D12' },
    { id: 'bear', name: 'Bear', trait: 'Power', tint: '#57534E' },
    { id: 'dolphin', name: 'Dolphin', trait: 'Swimming', tint: '#1D4ED8' },
    { id: 'kangaroo', name: 'Kangaroo', trait: 'Hops & kicks', tint: '#9A3412' },
  ];
  const MORPH = { early: 0.25, mid: 0.5, late: 0.75 };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  const S = {
    screen: 'upload', file: null, url: null, duration: 0,
    start: 0, len: 8, morph: 'mid', animal: 'cheetah', style: 'toon',
    jobId: null, paid: false, plan: 'pack',
    credits: Number(store.get('ws_credits') || 0),
    code: store.get('ws_code') || '', pollTimer: null,
  };

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const animalName = () => ANIMALS.find((a) => a.id === S.animal).name;
  const aAnimal = () => (/^[AEIOU]/.test(animalName()) ? 'an ' : 'a ') + animalName();
  const withCode = (u) => S.code ? u + (u.includes('?') ? '&' : '?') + 'code=' + encodeURIComponent(S.code) : u;
  const headers = () => S.code ? { 'x-access-code': S.code } : {};

  // ---------- navigation ----------
  const ORDER = ['upload', 'moment', 'animal', 'working', 'result'];
  function show(name) {
    S.screen = name;
    document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.dataset.screen !== name; });
    const idx = Math.min(ORDER.indexOf(name), 3);
    document.querySelectorAll('#dots i').forEach((d, i) => { d.className = (i <= idx ? 'on' : '') + (i === idx ? ' cur' : ''); });
    const canBack = name === 'moment' || name === 'animal';
    $('backBtn').hidden = !canBack; $('logo').hidden = canBack;
    if (name !== 'moment') { $('trimVideo').pause(); }
    window.scrollTo(0, 0);
  }
  $('backBtn').onclick = () => show(S.screen === 'animal' ? 'moment' : 'upload');

  // ---------- upload ----------
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    $('uploadErr').textContent = '';
    if (!f.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm)$/i.test(f.name)) { $('uploadErr').textContent = 'That doesn\'t look like a video file.'; return; }
    if (S.url) URL.revokeObjectURL(S.url);
    S.file = f; S.url = URL.createObjectURL(f);
    const v = $('trimVideo');
    v.onloadedmetadata = () => {
      const d = v.duration;
      if (isFinite(d) && d > 60.9) { $('uploadErr').textContent = `That clip is ${Math.round(d)} seconds. Please trim it to 60 seconds or less.`; return; }
      if (isFinite(d) && d < 3) { $('uploadErr').textContent = 'That clip is too short. It needs at least 3 seconds.'; return; }
      S.duration = isFinite(d) ? d : 60;
      setupTrim();
      show('moment');
    };
    v.onerror = () => {
      // Some browsers can't preview some formats (e.g. HEVC). Server can still process it.
      S.duration = 60; setupTrim(true); show('moment');
    };
    v.src = S.url;
  });

  // ---------- moment ----------
  function setupTrim(noPreview) {
    document.querySelectorAll('#lenPills button').forEach((b) => { b.disabled = Number(b.dataset.len) > S.duration + 0.05; });
    if (S.len > S.duration) S.len = Math.max(3, Math.floor(S.duration));
    const lens = [...document.querySelectorAll('#lenPills button')].filter((b) => !b.disabled).map((b) => Number(b.dataset.len));
    if (lens.length && !lens.includes(S.len)) S.len = lens[lens.length - 1];
    S.start = Math.min(S.start, Math.max(0, S.duration - S.len));
    $('durLabel').textContent = fmt(S.duration);
    $('trimPlay').hidden = !!noPreview;
    renderTrim();
  }
  function renderTrim() {
    const maxStart = Math.max(0, S.duration - S.len);
    const r = $('startRange'); r.max = maxStart.toFixed(1); r.value = S.start;
    $('startLabel').textContent = fmt(S.start);
    $('rangeLabel').textContent = fmt(S.start) + '–' + fmt(S.start + S.len);
    $('win').style.left = (S.start / S.duration * 100) + '%';
    $('win').style.width = (Math.min(S.len, S.duration) / S.duration * 100) + '%';
    $('morphMark').style.left = (MORPH[S.morph] * 100) + '%';
    document.querySelectorAll('#lenPills button').forEach((b) => b.classList.toggle('on', Number(b.dataset.len) === S.len));
    document.querySelectorAll('#morphPills button').forEach((b) => b.classList.toggle('on', b.dataset.morph === S.morph));
  }
  $('startRange').addEventListener('input', (e) => {
    S.start = Number(e.target.value); renderTrim();
    const v = $('trimVideo'); if (isFinite(v.duration)) v.currentTime = S.start;
  });
  $('lenPills').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    S.len = Number(b.dataset.len); S.start = Math.min(S.start, Math.max(0, S.duration - S.len)); renderTrim();
  });
  $('morphPills').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; S.morph = b.dataset.morph; renderTrim();
  });
  const tv = $('trimVideo');
  $('trimPlay').onclick = () => {
    if (tv.paused) { if (tv.currentTime < S.start || tv.currentTime > S.start + S.len) tv.currentTime = S.start; tv.play(); } else tv.pause();
  };
  tv.addEventListener('play', () => $('trimPlay').classList.add('playing'));
  tv.addEventListener('pause', () => $('trimPlay').classList.remove('playing'));
  tv.addEventListener('click', () => $('trimPlay').click());
  tv.addEventListener('timeupdate', () => { if (tv.currentTime > S.start + S.len || tv.currentTime < S.start - 0.3) tv.currentTime = S.start; });
  $('toAnimal').onclick = () => show('animal');

  // ---------- animal ----------
  function renderAnimals() {
    $('animals').innerHTML = '';
    ANIMALS.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'animal' + (a.id === S.animal ? ' on' : '');
      b.innerHTML = `<span class="ini" style="background:${a.tint}">${a.name[0]}</span><span><b>${a.name}</b><small>${a.trait}</small></span>`;
      b.onclick = () => { S.animal = a.id; renderAnimals(); };
      $('animals').appendChild(b);
    });
    $('generate').textContent = 'Transform me into ' + aAnimal();
  }
  $('stylePills').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; S.style = b.dataset.style;
    document.querySelectorAll('#stylePills button').forEach((x) => x.classList.toggle('on', x === b));
  });

  // ---------- generate ----------
  function setProgress(pct, stage) {
    $('pct').textContent = Math.round(pct) + '%';
    $('barFill').style.width = pct + '%';
    if (stage) $('stage').textContent = stage;
  }
  $('generate').onclick = () => {
    if (!S.file) return show('upload');
    $('genErr').textContent = '';
    const fd = new FormData();
    fd.append('start', S.start.toFixed(2)); fd.append('length', String(S.len));
    fd.append('morph', S.morph); fd.append('animal', S.animal); fd.append('style', S.style);
    fd.append('video', S.file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    if (S.code) xhr.setRequestHeader('x-access-code', S.code);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total * 100, 'Uploading your clip'); };
    xhr.onload = () => {
      let body = {}; try { body = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 401) { askCode(); show('animal'); return; }
      if (xhr.status !== 200) { $('genErr').textContent = body.error || 'Upload failed. Please try again.'; show('animal'); return; }
      S.jobId = body.id; S.paid = false; setProgress(2, 'Getting ready'); poll();
    };
    xhr.onerror = () => { $('genErr').textContent = 'Upload failed. Check your connection and try again.'; show('animal'); };
    setProgress(0, 'Uploading your clip');
    show('working');
    xhr.send(fd);
  };
  function poll() {
    clearTimeout(S.pollTimer);
    fetch('/api/jobs/' + S.jobId, { headers: headers() }).then((r) => r.json()).then((j) => {
      if (j.status === 'error') { $('genErr').textContent = j.error || 'Something went wrong.'; show('animal'); return; }
      if (j.status === 'done') { onDone(j); return; }
      setProgress(j.progress || 0, j.stage);
      S.pollTimer = setTimeout(poll, 2000);
    }).catch(() => { S.pollTimer = setTimeout(poll, 4000); });
  }
  async function onDone(j) {
    $('mockNote').hidden = !j.mock;
    if (S.credits > 0) { // pack owner: auto-unlock and use a credit
      const ok = await unlock();
      if (ok) { S.credits--; store.set('ws_credits', S.credits); }
    }
    renderResult();
    show('result');
  }

  // ---------- result ----------
  function renderResult() {
    $('resultTitle').textContent = `You're ${aAnimal()}.`;
    const v = $('resultVideo');
    v.src = withCode(`/api/jobs/${S.jobId}/${S.paid ? 'clean' : 'preview'}.mp4`);
    v.play().catch(() => {});
    $('freeActions').hidden = S.paid; $('paidActions').hidden = !S.paid;
    $('creditsNote').textContent = S.credits > 0 ? ` · ${S.credits} clips left` : '';
    $('savePaid').href = withCode(`/api/jobs/${S.jobId}/clean.mp4?download=1`);
  }
  async function unlock() {
    const r = await fetch(`/api/jobs/${S.jobId}/unlock`, { method: 'POST', headers: headers() });
    if (r.ok) S.paid = true;
    return r.ok;
  }
  async function shareFile(url, name) {
    try {
      const blob = await (await fetch(withCode(url))).blob();
      const file = new File([blob], name, { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'WildShift', text: `I turned into ${aAnimal()}!` });
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    } catch (e) { if (e && e.name !== 'AbortError') alertInline('Sharing didn\'t work on this device. Try Save instead.'); }
  }
  function alertInline(msg) { $('mockNote').hidden = false; $('mockNote').textContent = msg; }
  $('shareFree').onclick = () => shareFile(`/api/jobs/${S.jobId}/preview.mp4`, `wildshift-${S.animal}-preview.mp4`);
  $('sharePaid').onclick = () => shareFile(`/api/jobs/${S.jobId}/clean.mp4`, `wildshift-${S.animal}.mp4`);
  $('again').onclick = () => { renderAnimals(); show('animal'); };
  $('newClip').onclick = () => show('upload');

  // ---------- paywall (test mode) ----------
  $('openPay').onclick = () => { $('sheet').hidden = false; };
  $('closePay').onclick = () => { $('sheet').hidden = true; };
  document.querySelectorAll('.plan').forEach((p) => p.onclick = () => {
    S.plan = p.dataset.plan;
    document.querySelectorAll('.plan').forEach((x) => x.classList.toggle('on', x === p));
    $('buy').textContent = S.plan === 'pack' ? 'Buy 10 clips · $3.99' : 'Pay $1.00';
  });
  $('buy').onclick = async () => {
    $('buy').disabled = true;
    const ok = await unlock();
    $('buy').disabled = false;
    if (!ok) return;
    if (S.plan === 'pack') { S.credits += 9; store.set('ws_credits', S.credits); }
    $('sheet').hidden = true;
    renderResult();
  };

  // ---------- access code ----------
  function askCode() { $('codeSheet').hidden = false; $('codeInput').focus(); }
  $('codeForm').onsubmit = (e) => {
    e.preventDefault(); S.code = $('codeInput').value.trim(); store.set('ws_code', S.code); $('codeSheet').hidden = true;
  };
  fetch('/api/config').then((r) => r.json()).then((c) => { if (c.needsCode && !S.code) askCode(); }).catch(() => {});

  renderAnimals();
  show('upload');
})();
