/**
 * script.js
 * Main application entry point.
 *
 * Responsibilities:
 *  - Request DeviceMotion / DeviceOrientation sensor permission
 *  - Register event listeners and maintain rolling sensor buffer
 *  - Drive the render loop (requestAnimationFrame)
 *  - Update all UI components: sensor values, intensity gauge,
 *    orientation cube, motion type, event log
 *  - Optionally POST data to a FastAPI backend via WebSocket
 */

(() => {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────────
  const enableBtn       = document.getElementById('enable-btn');
  const permissionPanel = document.getElementById('permission-panel');
  const permissionMsg   = document.getElementById('permission-msg');
  const dashboard       = document.getElementById('dashboard');
  const statusBadge     = document.getElementById('status-badge');

  const elAx     = document.getElementById('ax');
  const elAy     = document.getElementById('ay');
  const elAz     = document.getElementById('az');
  const elAlpha  = document.getElementById('alpha');
  const elBeta   = document.getElementById('beta');
  const elGamma  = document.getElementById('gamma');

  const elMotionType    = document.getElementById('motion-type');
  const elIntensityLbl  = document.getElementById('intensity-label');
  const elIntensityLvl  = document.getElementById('intensity-level');

  const elDispAlpha = document.getElementById('disp-alpha');
  const elDispBeta  = document.getElementById('disp-beta');
  const elDispGamma = document.getElementById('disp-gamma');

  const cube                = document.getElementById('cube');
  const eventLog            = document.getElementById('event-log');
  const clearTrajectoryBtn  = document.getElementById('clear-trajectory-btn');

  // ── Recording DOM refs ───────────────────────────────────
  const startRecordingBtn   = document.getElementById('start-recording-btn');
  const stopRecordingBtn    = document.getElementById('stop-recording-btn');
  const recordingStatus     = document.getElementById('recording-status');
  const recordingCount      = document.getElementById('recording-count');
  const recordingDownloads  = document.getElementById('recording-downloads');
  const downloadCsvBtn      = document.getElementById('download-csv-btn');
  const downloadXmlBtn      = document.getElementById('download-xml-btn');

  // ── Sensor state ─────────────────────────────────────────────
  const sensorState = {
    ax: 0, ay: 0, az: 0,
    alpha: 0, beta: 0, gamma: 0,
    rotAlpha: 0, rotBeta: 0, rotGamma: 0,
    timestamp: 0,
  };

  let prevMotionType  = '';
  let lastTimestamp   = null;

  // ── Recording state ──────────────────────────────────────
  let isRecording      = false;
  const recordedData   = [];  // holds row objects while recording
  const RECORD_INTERVAL_MS = 100; // ~10 samples/sec — prevents memory overload
  let   lastRecordTs   = 0;

  // ── Recorded data fields ─────────────────────────────────
  const RECORD_FIELDS = ['timestamp', 'ax', 'ay', 'az', 'alpha', 'beta', 'gamma',
                         'motion_intensity', 'motion_type'];

  // ── Intensity gauge canvas ───────────────────────────────────
  const gaugeCanvas = document.getElementById('intensity-gauge');
  const gaugeCtx    = gaugeCanvas.getContext('2d');
  const MAX_INTENSITY = 30; // m/s² — full scale

  // ── Rolling sensor buffer (for future analytics) ─────────────
  const BUFFER_SIZE = 200;
  const sensorBuffer = [];

  // ── WebSocket (optional backend) ─────────────────────────────
  let ws = null;
  function _tryConnectWS() {
    try {
      ws = new WebSocket('ws://localhost:8000/ws');
      ws.onopen  = () => console.info('[WS] Connected to backend');
      ws.onerror = () => { ws = null; /* silently ignore — backend optional */ };
      ws.onclose = () => { ws = null; };
    } catch (_) { ws = null; }
  }

  // ── Sensor Permission ────────────────────────────────────────
  enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true;
    permissionMsg.textContent = 'Requesting sensor access…';

    try {
      // iOS 13+ requires explicit permission for DeviceMotion
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          permissionMsg.textContent = '⚠️ Motion permission denied. Please allow in Settings.';
          enableBtn.disabled = false;
          return;
        }
      }

      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission().catch(() => {});
      }

      _startTracking();
    } catch (err) {
      permissionMsg.textContent = '⚠️ Could not request permission: ' + err.message;
      enableBtn.disabled = false;
    }
  });

  // ── Start Tracking ───────────────────────────────────────────
  function _startTracking() {
    permissionPanel.classList.add('hidden');
    dashboard.classList.remove('hidden');
    statusBadge.textContent   = 'Sensors Active';
    statusBadge.className     = 'badge badge-active';

    // Register sensor listeners
    window.addEventListener('devicemotion',      _onMotion,      { passive: true });
    window.addEventListener('deviceorientation', _onOrientation, { passive: true });

    // Init sub-modules
    Graphs.init();
    Trajectory.init();

    // Optional backend WebSocket
    _tryConnectWS();

    // Start render loop
    requestAnimationFrame(_renderLoop);

    _logEvent('Motion tracking started');
  }

  // ── DeviceMotion handler ─────────────────────────────────────
  function _onMotion(evt) {
    const a  = evt.accelerationIncludingGravity || {};
    const rr = evt.rotationRate || {};

    sensorState.ax = a.x  ?? 0;
    sensorState.ay = a.y  ?? 0;
    sensorState.az = a.z  ?? 0;

    sensorState.rotAlpha = rr.alpha ?? 0;
    sensorState.rotBeta  = rr.beta  ?? 0;
    sensorState.rotGamma = rr.gamma ?? 0;

    // dt computation
    const now = performance.now();
    sensorState.dt = lastTimestamp !== null
      ? Math.min((now - lastTimestamp) / 1000, 0.1) // cap at 0.1 s (100 ms)
      : 0.02;
    lastTimestamp = now;

    // Maintain buffer
    sensorBuffer.push({ ...sensorState });
    if (sensorBuffer.length > BUFFER_SIZE) sensorBuffer.shift();

    // Send to backend if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        timestamp: Date.now(),
        ax: sensorState.ax, ay: sensorState.ay, az: sensorState.az,
        alpha: sensorState.alpha, beta: sensorState.beta, gamma: sensorState.gamma,
        motion_intensity: Motion.intensity(sensorState.ax, sensorState.ay, sensorState.az),
      }));
    }
  }

  // ── DeviceOrientation handler ────────────────────────────────
  function _onOrientation(evt) {
    sensorState.alpha = evt.alpha ?? 0;
    sensorState.beta  = evt.beta  ?? 0;
    sensorState.gamma = evt.gamma ?? 0;
  }

  // ── Render Loop ──────────────────────────────────────────────
  function _renderLoop() {
    const { ax, ay, az, alpha, beta, gamma, dt = 0.02 } = sensorState;

    // ── Sensor value display
    elAx.textContent    = ax.toFixed(2);
    elAy.textContent    = ay.toFixed(2);
    elAz.textContent    = az.toFixed(2);
    elAlpha.textContent = alpha.toFixed(1);
    elBeta.textContent  = beta.toFixed(1);
    elGamma.textContent = gamma.toFixed(1);

    // ── Motion classification
    const motionType = Motion.classify({
      ax, ay, az, alpha, beta, gamma,
      rotAlpha: sensorState.rotAlpha,
      rotBeta:  sensorState.rotBeta,
      rotGamma: sensorState.rotGamma,
    });
    elMotionType.textContent = motionType;

    const event = Motion.detectEvent(motionType, prevMotionType);
    if (event) _logEvent(event);
    prevMotionType = motionType;

    // ── Intensity
    const mag   = Motion.intensity(ax, ay, az);
    const level = Motion.intensityLevel(mag);
    elIntensityLbl.textContent = mag.toFixed(2) + ' m/s²';
    elIntensityLvl.textContent = level.toUpperCase();
    elIntensityLvl.className   = 'intensity-level level-' + level;
    _drawGauge(mag);

    // ── Orientation cube
    cube.style.transform =
      `rotateX(${beta}deg) rotateY(${gamma}deg) rotateZ(${alpha}deg)`;
    elDispAlpha.textContent = alpha.toFixed(0) + '°';
    elDispBeta.textContent  = beta.toFixed(0)  + '°';
    elDispGamma.textContent = gamma.toFixed(0) + '°';

    // ── Update graphs
    Graphs.update(ax, ay, az);

    // ── Update trajectory
    Trajectory.update(ax, ay, az, dt);

    // ── Record sample if recording is active
    if (isRecording) {
      const now = Date.now();
      if (now - lastRecordTs >= RECORD_INTERVAL_MS) {
        lastRecordTs = now;
        recordedData.push({
          timestamp:        now,
          ax:               ax,
          ay:               ay,
          az:               az,
          alpha:            alpha,
          beta:             beta,
          gamma:            gamma,
          motion_intensity: mag,
          motion_type:      motionType,
        });
        recordingCount.textContent = recordedData.length + ' samples';
      }
    }

    requestAnimationFrame(_renderLoop);
  }

  // ── Intensity Gauge ──────────────────────────────────────────
  function _drawGauge(value) {
    const W = gaugeCanvas.width  = gaugeCanvas.offsetWidth  || 160;
    const H = gaugeCanvas.height = gaugeCanvas.offsetHeight || 160;
    const cx = W / 2, cy = H / 2;
    const r  = Math.min(W, H) / 2 - 10;

    const startAngle = Math.PI * 0.75;
    const sweepAngle = Math.PI * 1.5;
    const ratio      = Math.min(value / MAX_INTENSITY, 1);
    const endAngle   = startAngle + sweepAngle * ratio;

    const level = Motion.intensityLevel(value);
    const color = level === 'low'    ? '#3fb950'
                : level === 'medium' ? '#d29922'
                                     : '#f85149';

    gaugeCtx.clearRect(0, 0, W, H);

    // Track
    gaugeCtx.beginPath();
    gaugeCtx.arc(cx, cy, r, startAngle, startAngle + sweepAngle);
    gaugeCtx.strokeStyle = '#21262d';
    gaugeCtx.lineWidth   = 14;
    gaugeCtx.lineCap     = 'round';
    gaugeCtx.stroke();

    // Fill
    if (ratio > 0) {
      gaugeCtx.beginPath();
      gaugeCtx.arc(cx, cy, r, startAngle, endAngle);
      gaugeCtx.strokeStyle = color;
      gaugeCtx.lineWidth   = 14;
      gaugeCtx.lineCap     = 'round';
      gaugeCtx.stroke();
    }
  }

  // ── Event Log ────────────────────────────────────────────────
  const MAX_LOG_ENTRIES = 50;

  function _logEvent(message) {
    const li   = document.createElement('li');
    const t    = document.createElement('time');
    const now  = new Date();
    t.textContent = now.toTimeString().slice(0, 8);
    li.appendChild(t);
    li.appendChild(document.createTextNode(message));
    eventLog.prepend(li);

    // Trim old entries
    while (eventLog.children.length > MAX_LOG_ENTRIES) {
      eventLog.removeChild(eventLog.lastChild);
    }
  }

  // ── Clear Trajectory ─────────────────────────────────────────
  clearTrajectoryBtn.addEventListener('click', () => Trajectory.clear());

  // ── Recording Controls ────────────────────────────────────────
  startRecordingBtn.addEventListener('click', () => {
    recordedData.length = 0;
    isRecording = true;
    startRecordingBtn.disabled = true;
    stopRecordingBtn.disabled  = false;
    recordingStatus.textContent = '● Recording…';
    recordingStatus.classList.add('status-active');
    recordingCount.textContent  = '0 samples';
    recordingDownloads.classList.add('hidden');
    _logEvent('Recording started');
  });

  stopRecordingBtn.addEventListener('click', () => {
    isRecording = false;
    startRecordingBtn.disabled = false;
    stopRecordingBtn.disabled  = true;
    recordingStatus.textContent = 'Stopped — ' + recordedData.length + ' samples recorded';
    recordingStatus.classList.remove('status-active');
    recordingCount.textContent = '';
    if (recordedData.length > 0) {
      recordingDownloads.classList.remove('hidden');
    }
    _logEvent('Recording stopped (' + recordedData.length + ' samples)');
  });

  // ── CSV Download ──────────────────────────────────────────────
  downloadCsvBtn.addEventListener('click', () => {
    if (recordedData.length === 0) return;
    const rows = recordedData.map(r =>
      RECORD_FIELDS.map(h => r[h] !== undefined ? r[h] : '').join(',')
    );
    const csvContent = [RECORD_FIELDS.join(','), ...rows].join('\r\n');
    _triggerDownload(csvContent, 'motion_recording.csv', 'text/csv;charset=utf-8;');
  });

  // ── XML Download ──────────────────────────────────────────────
  downloadXmlBtn.addEventListener('click', () => {
    if (recordedData.length === 0) return;
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<motion_recording>'];
    recordedData.forEach(r => {
      lines.push('  <sample>');
      RECORD_FIELDS.forEach(k => {
        const val = r[k] !== undefined
          ? String(r[k]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          : '';
        lines.push(`    <${k}>${val}</${k}>`);
      });
      lines.push('  </sample>');
    });
    lines.push('</motion_recording>');
    _triggerDownload(lines.join('\n'), 'motion_recording.xml', 'application/xml;charset=utf-8;');
  });

  function _triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

})();
