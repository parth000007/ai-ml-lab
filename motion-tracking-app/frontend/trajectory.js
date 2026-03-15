/**
 * trajectory.js
 * Estimates 2D device trajectory by double-integrating acceleration data.
 * Renders the path on a canvas element.
 *
 * Physics:
 *   velocity[t]  = velocity[t-1]  + linearAccel * dt
 *   position[t]  = position[t-1]  + velocity[t]  * dt
 *
 * Note: double integration of noisy MEMS data drifts quickly; the
 * trajectory is an approximate relative-motion visualisation only.
 */

const Trajectory = (() => {
  // State
  let vx = 0, vy = 0;
  let px = 0, py = 0;

  // Gravity estimate (low-pass)
  let gx = 0, gy = 0, gz = 9.8;
  const LP = 0.85;

  // Path history (canvas-space coords)
  const path = [];
  const MAX_PATH = 400;

  // Canvas references set during init
  let canvas = null;
  let ctx    = null;
  let CW = 0, CH = 0;

  // Scale: metres → pixels (auto-range)
  const SCALE = 40; // px per meter — tune as needed

  // Velocity decay to limit drift accumulation
  const DECAY = 0.95;

  function init() {
    canvas = document.getElementById('trajectory-canvas');
    ctx    = canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
  }

  function _resize() {
    if (!canvas) return;
    CW = canvas.offsetWidth;
    CH = Math.max(180, Math.round(CW * 0.55));
    canvas.width  = CW;
    canvas.height = CH;
    _draw();
  }

  /**
   * Integrate new acceleration reading.
   * @param {number} ax  - raw accel X (m/s²)
   * @param {number} ay  - raw accel Y
   * @param {number} az  - raw accel Z
   * @param {number} dt  - time delta in seconds
   */
  function update(ax, ay, az, dt) {
    if (!canvas) return;

    // Estimate gravity via low-pass
    gx = LP * gx + (1 - LP) * ax;
    gy = LP * gy + (1 - LP) * ay;
    gz = LP * gz + (1 - LP) * az;

    // Linear (gravity-free) acceleration
    const lax = ax - gx;
    const lay = ay - gy;

    // Integrate velocity
    vx = (vx + lax * dt) * DECAY;
    vy = (vy + lay * dt) * DECAY;

    // Integrate position
    px += vx * dt;
    py += vy * dt;

    // Convert to canvas coords (origin = centre)
    const cx = CW / 2 + px * SCALE;
    const cy = CH / 2 - py * SCALE; // Y inverted in canvas

    path.push({ x: cx, y: cy });
    if (path.length > MAX_PATH) path.shift();

    _draw();
  }

  function _draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CW, CH);

    // Background grid
    ctx.strokeStyle = 'rgba(48,54,61,.5)';
    ctx.lineWidth = 0.5;
    const step = 30;
    for (let x = 0; x < CW; x += step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CH); ctx.stroke(); }
    for (let y = 0; y < CH; y += step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CW,y); ctx.stroke(); }

    // Centre crosshair
    ctx.strokeStyle = 'rgba(88,166,255,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CW/2,0); ctx.lineTo(CW/2,CH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,CH/2); ctx.lineTo(CW,CH/2); ctx.stroke();

    if (path.length < 2) return;

    // Draw gradient path
    for (let i = 1; i < path.length; i++) {
      const t = i / path.length;
      const alpha = 0.2 + 0.8 * t;
      ctx.strokeStyle = `rgba(88,166,255,${alpha})`;
      ctx.lineWidth   = 1 + t * 2;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(path[i-1].x, path[i-1].y);
      ctx.lineTo(path[i].x,   path[i].y);
      ctx.stroke();
    }

    // Current position dot
    const last = path[path.length - 1];
    ctx.fillStyle = '#58a6ff';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function clear() {
    path.length = 0;
    vx = 0; vy = 0;
    px = 0; py = 0;
    _draw();
  }

  return { init, update, clear };
})();
