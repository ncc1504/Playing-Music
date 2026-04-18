(function () {
  "use strict";

  /* ── Elements ── */
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const visCanvas = $("visCanvas");
  const vCtx = visCanvas.getContext("2d");
  const playBtn = $("playBtn");
  const playIcon = $("playIcon");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const shuffleBtn = $("shuffleBtn");
  const repeatBtn = $("repeatBtn");
  const progressFill = $("progress-fill");
  const progressThumb = $("progress-thumb");
  const progressWrap = $("progress-bar-wrap");
  const curTimeEl = $("cur-time");
  const durTimeEl = $("dur-time");
  const volSlider = $("vol-slider");
  const volIcon = $("vol-icon");
  const volVal = $("vol-val");
  const trackNameEl = $("track-name");
  const vinylDisc = $("vinyl-disc");
  const artworkVinyl = $("artwork-vinyl");
  const artworkInner = $("artwork-inner");
  const statusText = $("status-text");
  const playlistBody = $("playlist-body");
  const emptyState = $("empty-state");
  const trackCount = $("track-count");
  const beatFlash = $("beat-flash");
  const autoColorBtn = $("auto-color-btn");
  const statEnergy = $("stat-energy");
  const statTreble = $("stat-treble");
  const statBass = $("stat-bass");

  /* ── State ── */
  let audio = new Audio();
  audio.volume = 0.8;
  let audioCtx, analyser, source, gainNode;
  let dataFreq, dataTime;
  let tracks = [];
  let currentIdx = -1;
  let isPlaying = false;
  let isShuffle = false;
  let isRepeat = false;
  let autoColor = false;
  let beatColor = false;
  let beatColorIdx = 0;
  let currentHue = 270;
  let visMode = "bars";
  let animId;
  let particles = [];
  let lastBeat = 0;
  let beatThreshold = 200;
  let lastBassColorChange = 0;
  const beatHues = [270, 0, 40, 200, 160, 325];

  /* ── Audio Context Setup ── */
  function setupAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = audio.volume;
    source = audioCtx.createMediaElementSource(audio);
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    dataFreq = new Uint8Array(analyser.frequencyBinCount);
    dataTime = new Uint8Array(analyser.frequencyBinCount);
  }

  /* ── Color System ── */
  function setHue(h, animated = true) {
    currentHue = h;
    root.style.setProperty("--h", h);
    updateVolSliderBg();
  }

  function updateVolSliderBg() {
    const pct = volSlider.value * 100;
    volSlider.style.setProperty("--vol-pct", pct + "%");
    volSlider.style.background =
      `linear-gradient(90deg, hsl(${currentHue},70%,65%) ${pct}%, var(--bg3) ${pct}%)`;
  }

  function computeAutoColor(freqData) {
    if (!freqData) return;
    const len = freqData.length;
    const bass = avg(freqData, 0, Math.floor(len * 0.05));
    const mid = avg(freqData, Math.floor(len * 0.05), Math.floor(len * 0.3));
    const treble = avg(freqData, Math.floor(len * 0.3), Math.floor(len * 0.7));
    const total = (bass + mid + treble) / 3 / 255;
    if (total < 0.02) return;

    const bassInfluence = (bass / 255) * 120;
    const trebleInfluence = (treble / 255) * 120;
    const randomOffset = (Math.sin(Date.now() * 0.001) + 1) * 30;
    let targetHue = 270 - bassInfluence + trebleInfluence + randomOffset;
    targetHue = ((targetHue % 360) + 360) % 360;
    currentHue += (targetHue - currentHue) * 0.08;
    setHue(Math.round(currentHue), false);
  }

  function avg(arr, start, end) {
    let s = 0;
    for (let i = start; i < end; i++) s += arr[i];
    return s / (end - start) || 0;
  }

  /* ── Beat Detection ── */
  function detectBeat(freqData) {
    if (!freqData) return false;
    const bassEnergy = avg(freqData, 0, 8);
    const now = performance.now();
    if (bassEnergy > beatThreshold && now - lastBeat > 300) {
      lastBeat = now;
      triggerBeat();
      return true;
    }
    return false;
  }

  function triggerBeat() {
    beatFlash.style.opacity = "0.04";
    setTimeout(() => { beatFlash.style.opacity = "0"; }, 80);
    playBtn.classList.add("beat");
    setTimeout(() => playBtn.classList.remove("beat"), 150);
  }

  /* ── Visualizer ── */
  function resizeCanvas() {
    const rect = visCanvas.parentElement.getBoundingClientRect();
    visCanvas.width = rect.width;
    visCanvas.height = rect.height || 200;
  }

  function drawBars(W, H, data) {
    const bars = Math.floor(data.length * 0.6);
    const barW = W / bars - 1;
    vCtx.clearRect(0, 0, W, H);
    for (let i = 0; i < bars; i++) {
      const v = data[i] / 255;
      const bH = v * H * 0.92;
      const hue = currentHue + (i / bars) * 60 - 30;
      const alpha = 0.4 + v * 0.6;
      const grad = vCtx.createLinearGradient(0, H - bH, 0, H);
      grad.addColorStop(0, `hsla(${hue + 20}, 80%, 75%, ${alpha})`);
      grad.addColorStop(1, `hsla(${hue}, 65%, 45%, ${alpha * 0.4})`);
      vCtx.fillStyle = grad;
      vCtx.beginPath();
      vCtx.roundRect(i * (barW + 1), H - bH, barW, bH, 2);
      vCtx.fill();
      vCtx.fillStyle = `hsla(${hue}, 70%, 60%, ${alpha * 0.1})`;
      vCtx.fillRect(i * (barW + 1), 0, barW, bH * 0.3);
    }
  }

  function drawWave(W, H, timeData) {
    vCtx.clearRect(0, 0, W, H);
    vCtx.lineWidth = 2;
    vCtx.strokeStyle = `hsl(${currentHue}, 70%, 65%)`;
    vCtx.shadowColor = `hsl(${currentHue}, 70%, 65%)`;
    vCtx.shadowBlur = 8;
    vCtx.beginPath();
    const sliceW = W / timeData.length;
    let x = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i] / 128 - 1;
      const y = (v * H) / 2 + H / 2;
      i === 0 ? vCtx.moveTo(x, y) : vCtx.lineTo(x, y);
      x += sliceW;
    }
    vCtx.stroke();
    vCtx.shadowBlur = 0;
  }

  function drawCircle(W, H, data) {
    vCtx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const bars = 128;
    const baseR = Math.min(W, H) * 0.22;
    for (let i = 0; i < bars; i++) {
      const v = data[i] / 255;
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const r1 = baseR;
      const r2 = baseR + v * baseR * 1.4;
      const hue = currentHue + (i / bars) * 80;
      vCtx.strokeStyle = `hsla(${hue}, 80%, 70%, ${0.3 + v * 0.7})`;
      vCtx.lineWidth = 2;
      vCtx.shadowColor = `hsla(${hue}, 80%, 70%, 0.5)`;
      vCtx.shadowBlur = v > 0.5 ? 6 : 0;
      vCtx.beginPath();
      vCtx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      vCtx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
      vCtx.stroke();
    }
    vCtx.shadowBlur = 0;
    vCtx.beginPath();
    vCtx.arc(cx, cy, baseR * 0.6, 0, Math.PI * 2);
    vCtx.strokeStyle = `hsla(${currentHue}, 60%, 60%, 0.3)`;
    vCtx.lineWidth = 1;
    vCtx.stroke();
  }

  function drawParticles(W, H, data) {
    vCtx.fillStyle = "rgba(0,0,0,0.15)";
    vCtx.fillRect(0, 0, W, H);
    const energy = avg(data, 0, data.length) / 255;
    if (energy > 0.4 && Math.random() < energy * 0.4) {
      for (let k = 0; k < 3; k++) {
        particles.push({
          x: Math.random() * W,
          y: H,
          vx: (Math.random() - 0.5) * 4,
          vy: -(2 + Math.random() * 4 + energy * 6),
          r: 2 + Math.random() * 4,
          life: 1,
          hue: currentHue + (Math.random() - 0.5) * 60,
        });
      }
    }
    particles = particles.filter((p) => p.life > 0);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= 0.015;
      vCtx.beginPath();
      vCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      vCtx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.life})`;
      vCtx.fill();
    });
  }

  function drawIdleState(W, H) {
    const t = Date.now() / 1000;
    vCtx.clearRect(0, 0, W, H);
    const bars = 60;
    const bW = W / bars - 1;
    for (let i = 0; i < bars; i++) {
      const v =
        (Math.sin(i * 0.35 + t * 1.5) + Math.sin(i * 0.15 + t)) * 0.25 + 0.08;
      const bH = Math.max(2, v * H);
      vCtx.fillStyle = `hsla(${currentHue + (i / bars) * 40 - 20}, 50%, 55%, 0.25)`;
      vCtx.beginPath();
      vCtx.roundRect(i * (bW + 1), H / 2 - bH / 2, bW, bH, 2);
      vCtx.fill();
    }
  }

  /* ── Main Animation Loop ── */
  function animate() {
    animId = requestAnimationFrame(animate);
    const W = visCanvas.width, H = visCanvas.height;
    if (!analyser || !isPlaying) {
      drawIdleState(W, H);
      return;
    }
    analyser.getByteFrequencyData(dataFreq);
    analyser.getByteTimeDomainData(dataTime);

    const bassVal = avg(dataFreq, 0, 8);
    const trebleVal = avg(dataFreq, Math.floor(dataFreq.length * 0.4), Math.floor(dataFreq.length * 0.8));
    const energyVal = avg(dataFreq, 0, dataFreq.length);

    statEnergy.textContent = Math.round((energyVal / 255) * 100) + "%";
    statBass.textContent = Math.round((bassVal / 255) * 100) + "%";
    statTreble.textContent = Math.round((trebleVal / 255) * 100) + "%";

    beatThreshold = 160 + energyVal * 0.3;
    detectBeat(dataFreq);

    if (beatColor) {
      const bassPercent = (bassVal / 255) * 100;
      const now = performance.now();
      if (bassPercent > 80 && now - lastBassColorChange > 400) {
        lastBassColorChange = now;
        beatColorIdx = (beatColorIdx + 1) % beatHues.length;
        setHue(beatHues[beatColorIdx], true);
      }
    }

    if (autoColor) computeAutoColor(dataFreq);

    switch (visMode) {
      case "bars":     drawBars(W, H, dataFreq); break;
      case "wave":     drawWave(W, H, dataTime); break;
      case "circle":   drawCircle(W, H, dataFreq); break;
      case "particles":drawParticles(W, H, dataFreq); break;
    }
  }

  /* ── Playback ── */
  function loadAndPlay(idx) {
    if (idx < 0 || idx >= tracks.length) return;
    currentIdx = idx;
    const t = tracks[idx];
    audio.src = t.url;
    trackNameEl.textContent = t.name;
    statusText.textContent = t.name;
    artworkVinyl.classList.add("visible");
    artworkInner.style.opacity = "0";
    renderPlaylist();

    audio.addEventListener("canplay", function once() {
      audio.removeEventListener("canplay", once);
      setupAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();
      audio.play().then(() => {
        isPlaying = true;
        setPause();
        vinylDisc.classList.add("spinning");
        trackNameEl.textContent = t.name + " — " + fmt(audio.duration);
      }).catch(console.warn);
    }, { once: true });
  }

  function setPause() {
    playIcon.innerHTML =
      '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  }
  function setPlay() {
    playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  }

  playBtn.addEventListener("click", () => {
    if (!tracks.length) return;
    if (currentIdx < 0) { loadAndPlay(0); return; }
    setupAudio();
    if (isPlaying) {
      audio.pause();
      isPlaying = false;
      setPlay();
      vinylDisc.classList.remove("spinning");
    } else {
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      audio.play();
      isPlaying = true;
      setPause();
      vinylDisc.classList.add("spinning");
    }
  });

  prevBtn.addEventListener("click", () => {
    if (!tracks.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const idx = isShuffle ? randIdx() : (currentIdx - 1 + tracks.length) % tracks.length;
    loadAndPlay(idx);
  });

  nextBtn.addEventListener("click", () => {
    if (!tracks.length) return;
    const idx = isShuffle ? randIdx() : (currentIdx + 1) % tracks.length;
    loadAndPlay(idx);
  });

  shuffleBtn.addEventListener("click", () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle("active", isShuffle);
  });

  repeatBtn.addEventListener("click", () => {
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle("active", isRepeat);
  });

  audio.addEventListener("ended", () => {
    if (isRepeat) { audio.currentTime = 0; audio.play(); return; }
    const next = isShuffle ? randIdx() : currentIdx + 1;
    if (next < tracks.length) {
      loadAndPlay(next);
    } else {
      isPlaying = false;
      setPlay();
      vinylDisc.classList.remove("spinning");
      statusText.textContent = "Kết thúc";
    }
  });

  function randIdx() {
    return Math.floor(Math.random() * tracks.length);
  }

  /* ── Progress ── */
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = pct + "%";
    progressThumb.style.left = pct + "%";
    curTimeEl.textContent = fmt(audio.currentTime);
    durTimeEl.textContent = fmt(audio.duration);
  });

  audio.addEventListener("loadedmetadata", () => {
    durTimeEl.textContent = fmt(audio.duration);
    if (tracks[currentIdx]) {
      trackNameEl.textContent = tracks[currentIdx].name + " — " + fmt(audio.duration);
    }
  });

  let isDragging = false;
  progressWrap.addEventListener("mousedown", (e) => { isDragging = true; seekTo(e); });
  document.addEventListener("mousemove", (e) => { if (isDragging) seekTo(e); });
  document.addEventListener("mouseup", () => { isDragging = false; });
  progressWrap.addEventListener("touchstart", (e) => { isDragging = true; seekTo(e.touches[0]); }, { passive: true });
  document.addEventListener("touchmove", (e) => { if (isDragging) seekTo(e.touches[0]); }, { passive: true });
  document.addEventListener("touchend", () => { isDragging = false; });

  function seekTo(e) {
    const rect = progressWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = pct * audio.duration;
  }

  /* ── Volume ── */
  volSlider.addEventListener("input", () => {
    audio.volume = volSlider.value;
    if (gainNode) gainNode.gain.value = volSlider.value;
    volVal.textContent = Math.round(volSlider.value * 100) + "%";
    volIcon.textContent = volSlider.value == 0 ? "🔇" : volSlider.value < 0.4 ? "🔈" : "🔉";
    updateVolSliderBg();
  });

  /* ── IndexedDB ── */
  let db;
  const dbName = "AudioPlayerDB";
  const dbVersion = 1;
  const storeName = "tracks";

  function initIndexedDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, dbVersion);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
        }
      };
    });
  }

  /* ── File Upload ── */
  function addAudioFile(f) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const arrayBuffer = e.target.result;
      const blob = new Blob([arrayBuffer], { type: f.type });
      const trackObj = {
        name: f.name.replace(/\.[^.]+$/, ""),
        blob: blob,
        size: f.size,
        timestamp: Date.now(),
      };
      const objectUrl = URL.createObjectURL(blob);
      tracks.push({ name: trackObj.name, url: objectUrl, blob: blob, id: null });
      saveTrackToIndexedDB(trackObj, tracks.length - 1);
      renderPlaylist();
    };
    reader.readAsArrayBuffer(f);
  }

  function saveTrackToIndexedDB(trackObj, trackIdx) {
    if (!db) return;
    const transaction = db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);
    const req = store.add(trackObj);
    req.onsuccess = () => { tracks[trackIdx].id = req.result; };
    transaction.onerror = () => { console.error("Error saving track:", transaction.error); };
  }

  function loadTracksFromIndexedDB() {
    if (!db) return;
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => {
      const tracksData = req.result;
      tracks = tracksData.map((t) => {
        const blob = new Blob([t.blob], { type: "audio/*" });
        return { name: t.name, url: URL.createObjectURL(blob), blob: blob, id: t.id };
      });
      renderPlaylist();
    };
  }

  function deleteTrackFromIndexedDB(idx) {
    if (!db || !tracks[idx] || !tracks[idx].id) return;
    const transaction = db.transaction([storeName], "readwrite");
    const store = transaction.objectStore(storeName);
    store.delete(tracks[idx].id);
  }

  $("upload-btn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    const wasEmpty = !tracks.length;
    files.forEach(addAudioFile);
    if (wasEmpty && tracks.length > 0) setTimeout(() => loadAndPlay(0), 100);
    $("fileInput").value = "";
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio"));
    if (!files.length) return;
    const wasEmpty = !tracks.length;
    files.forEach(addAudioFile);
    if (wasEmpty && tracks.length > 0) setTimeout(() => loadAndPlay(0), 100);
  });

  /* ── Playlist ── */
  function renderPlaylist() {
    trackCount.textContent = tracks.length + " bài";
    if (!tracks.length) {
      playlistBody.innerHTML = "";
      playlistBody.appendChild(emptyState);
      return;
    }
    emptyState.remove();
    playlistBody.innerHTML = tracks.map((t, i) => `
      <button class="track-row ${i === currentIdx ? "active" : ""}" data-idx="${i}">
        ${i === currentIdx && isPlaying
          ? `<div class="t-eq"><div class="t-bar b1" style="height:8px"></div><div class="t-bar b2" style="height:12px"></div><div class="t-bar b3" style="height:5px"></div></div>`
          : `<span class="t-num">${i + 1}</span>`}
        <div class="t-info">
          <div class="t-name">${esc(t.name)}</div>
        </div>
        <button class="t-del" data-del="${i}" title="Xóa">✕</button>
      </button>
    `).join("");

    playlistBody.querySelectorAll(".track-row").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".t-del")) return;
        loadAndPlay(+el.dataset.idx);
      });
    });

    playlistBody.querySelectorAll(".t-del").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = +el.dataset.del;
        deleteTrackFromIndexedDB(idx);
        tracks.splice(idx, 1);
        if (idx === currentIdx) {
          if (tracks.length) {
            loadAndPlay(Math.min(idx, tracks.length - 1));
          } else {
            audio.pause();
            isPlaying = false;
            setPlay();
            vinylDisc.classList.remove("spinning");
            currentIdx = -1;
            artworkVinyl.classList.remove("visible");
            artworkInner.style.opacity = "1";
          }
        } else if (idx < currentIdx) {
          currentIdx--;
        }
        renderPlaylist();
      });
    });
  }

  /* ── Theme Dots ── */
  document.querySelectorAll(".tdot").forEach((dot) => {
    dot.addEventListener("click", () => {
      document.querySelectorAll(".tdot").forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
      autoColor = false;
      beatColor = false;
      autoColorBtn.classList.remove("on");
      $("beat-color-btn").classList.remove("on");
      setHue(+dot.dataset.h);
    });
  });

  autoColorBtn.addEventListener("click", () => {
    autoColor = !autoColor;
    beatColor = false;
    $("beat-color-btn").classList.remove("on");
    autoColorBtn.classList.toggle("on", autoColor);
    autoColorBtn.textContent = autoColor ? "🎨 On" : "🎨 Auto";
  });

  $("beat-color-btn").addEventListener("click", () => {
    beatColor = !beatColor;
    autoColor = false;
    autoColorBtn.classList.remove("on");
    $("beat-color-btn").classList.toggle("on", beatColor);
    $("beat-color-btn").textContent = beatColor ? "🔊 On" : "🔊 Bass";
  });

  /* ── Vis Mode Buttons ── */
  document.querySelectorAll(".vis-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".vis-mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      visMode = btn.dataset.mode;
      particles = [];
    });
  });

  /* ── Keyboard Shortcuts ── */
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
    if (e.code === "ArrowRight" && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (e.code === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (e.code === "ArrowUp") { volSlider.value = Math.min(1, +volSlider.value + 0.05); volSlider.dispatchEvent(new Event("input")); }
    if (e.code === "ArrowDown") { volSlider.value = Math.max(0, +volSlider.value - 0.05); volSlider.dispatchEvent(new Event("input")); }
    if (e.code === "KeyN") nextBtn.click();
    if (e.code === "KeyP") prevBtn.click();
  });

  /* ── Helpers ── */
  function fmt(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ── Init ── */
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  updateVolSliderBg();
  initIndexedDB()
    .then(() => { loadTracksFromIndexedDB(); })
    .catch((err) => { console.error("Failed to initialize IndexedDB:", err); });
  animate();
})();