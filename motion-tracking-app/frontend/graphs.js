/**
 * graphs.js
 * Initialises and manages the real-time Chart.js acceleration graph.
 * Exposes a single function: Graphs.update(ax, ay, az)
 */

const Graphs = (() => {
  const BUFFER_SIZE = 100; // number of data points shown
  const labels  = Array(BUFFER_SIZE).fill('');
  const dataAx  = Array(BUFFER_SIZE).fill(0);
  const dataAy  = Array(BUFFER_SIZE).fill(0);
  const dataAz  = Array(BUFFER_SIZE).fill(0);

  let chart = null;
  let frameCount = 0;

  function init() {
    const ctx = document.getElementById('accel-chart').getContext('2d');

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ax',
            data: dataAx,
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88,166,255,.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: 'Ay',
            data: dataAy,
            borderColor: '#3fb950',
            backgroundColor: 'rgba(63,185,80,.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: 'Az',
            data: dataAz,
            borderColor: '#f85149',
            backgroundColor: 'rgba(248,81,73,.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            display: false,
          },
          y: {
            ticks: { color: '#8b949e', font: { size: 10 } },
            grid:  { color: 'rgba(48,54,61,.8)' },
            title: {
              display: true,
              text: 'm/s²',
              color: '#8b949e',
              font: { size: 10 },
            },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: '#e6edf3',
              boxWidth: 12,
              font: { size: 11 },
            },
          },
        },
      },
    });
  }

  /**
   * Push new sensor values into the rolling buffer and redraw.
   * @param {number} ax
   * @param {number} ay
   * @param {number} az
   */
  function update(ax, ay, az) {
    if (!chart) return;

    frameCount++;
    // Update rolling arrays
    labels.push(frameCount);   labels.shift();
    dataAx.push(ax);           dataAx.shift();
    dataAy.push(ay);           dataAy.shift();
    dataAz.push(az);           dataAz.shift();

    chart.update('none'); // skip animation for performance
  }

  return { init, update };
})();
