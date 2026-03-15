/**
 * motion.js
 * Motion classification and intensity computation.
 * Uses simple threshold logic on sensor data.
 */

const Motion = (() => {
  // ── Thresholds ─────────────────────────────────────────────
  const THRESHOLDS = {
    sudden:   20,   // m/s²  — magnitude spike
    running:  15,   // m/s²
    walking:   6,   // m/s²
    rotation:  90,  // °/s   — angular velocity magnitude
    tiltFwd:   45,  // °     — beta (front/back)
    tiltSide:  45,  // °     — gamma (left/right)
    intensityLow:    4,   // m/s²
    intensityMedium: 12,  // m/s²
  };

  // ── Gravity-filtered acceleration buffer ───────────────────
  // Simple low-pass to estimate gravity component
  let gravX = 0, gravY = 0, gravZ = 9.8;
  const ALPHA_LP = 0.8; // low-pass factor

  /**
   * Classify the current motion state.
   * @param {object} data - { ax, ay, az, alpha, beta, gamma, rotAlpha, rotBeta, rotGamma }
   * @returns {string} motion label
   */
  function classify(data) {
    const { ax, ay, az, beta, gamma } = data;

    // Update gravity estimate via low-pass filter
    gravX = ALPHA_LP * gravX + (1 - ALPHA_LP) * ax;
    gravY = ALPHA_LP * gravY + (1 - ALPHA_LP) * ay;
    gravZ = ALPHA_LP * gravZ + (1 - ALPHA_LP) * az;

    // Linear (gravity-free) acceleration
    const lax = ax - gravX;
    const lay = ay - gravY;
    const laz = az - gravZ;

    const magnitude = Math.sqrt(lax * lax + lay * lay + laz * laz);

    // Gyroscope angular velocity magnitude
    const { rotAlpha = 0, rotBeta = 0, rotGamma = 0 } = data;
    const rotMag = Math.sqrt(rotAlpha ** 2 + rotBeta ** 2 + rotGamma ** 2);

    if (magnitude > THRESHOLDS.sudden)  return 'Sudden Movement';
    if (rotMag    > THRESHOLDS.rotation) return 'Rotation';
    if (Math.abs(beta)  > THRESHOLDS.tiltFwd)  return 'Forward/Back Tilt';
    if (Math.abs(gamma) > THRESHOLDS.tiltSide) return 'Side Tilt';
    if (magnitude > THRESHOLDS.running)  return 'Running';
    if (magnitude > THRESHOLDS.walking)  return 'Walking';
    return 'Standing';
  }

  /**
   * Compute raw motion intensity (magnitude of acceleration vector).
   * @param {number} ax
   * @param {number} ay
   * @param {number} az
   * @returns {number}
   */
  function intensity(ax, ay, az) {
    return Math.sqrt(ax * ax + ay * ay + az * az);
  }

  /**
   * Classify intensity level.
   * @param {number} mag - intensity value
   * @returns {'low'|'medium'|'high'}
   */
  function intensityLevel(mag) {
    if (mag < THRESHOLDS.intensityLow)    return 'low';
    if (mag < THRESHOLDS.intensityMedium) return 'medium';
    return 'high';
  }

  /**
   * Determine if this reading should trigger a loggable event.
   * Returns an event string or null.
   * @param {string} motionType
   * @param {string} prevMotionType
   * @returns {string|null}
   */
  function detectEvent(motionType, prevMotionType) {
    if (motionType !== prevMotionType && motionType !== 'Standing') {
      return motionType + ' detected';
    }
    return null;
  }

  return { classify, intensity, intensityLevel, detectEvent, THRESHOLDS };
})();
