export function createHUD(ctx) {
  const cashEl = document.getElementById('hud-cash');
  const starsEl = document.getElementById('hud-stars');
  const healthFillEl = document.getElementById('hud-health-fill');
  const missionTitleEl = document.getElementById('hud-mission-title');
  const missionTextEl = document.getElementById('hud-mission-text');
  const speedEl = document.getElementById('hud-speed');
  const toastEl = document.getElementById('hud-toast');
  const minimapCanvas = document.getElementById('hud-minimap');
  const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

  let toastTimer = 0;

  return {
    toast(msg) {
      if (!toastEl) return;
      toastEl.innerText = msg;
      toastEl.style.opacity = '1';
      toastTimer = 4;
    },
    update(state, dt) {
      if (cashEl) cashEl.innerText = `$${state.money}`;
      if (starsEl) starsEl.innerText = '★'.repeat(state.wantedStars) || '☆';

      if (healthFillEl) {
        const hpPct = Math.max(0, Math.min(100, Math.round(state.health)));
        healthFillEl.style.width = `${hpPct}%`;
      }

      if (missionTextEl) {
        missionTextEl.innerText = state.missionText || '';
      }

      if (speedEl) {
        speedEl.innerText = `${Math.round(state.speed || 0)} mph`;
      }

      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0 && toastEl) {
          toastEl.style.opacity = '0';
        }
      }

      if (minimapCtx && minimapCanvas) {
        this.drawMinimap(state);
      }
    },
    drawMinimap(state) {
      const w = minimapCanvas.width;
      const h = minimapCanvas.height;
      minimapCtx.fillStyle = '#222';
      minimapCtx.fillRect(0, 0, w, h);

      const scale = 0.5;
      const cx = w / 2;
      const cy = h / 2;
      const p = state.playerPos;

      // Draw marker
      if (state.marker) {
        const mx = cx + (state.marker.x - p.x) * scale;
        const my = cy + (state.marker.z - p.z) * scale;
        minimapCtx.fillStyle = '#0ff';
        minimapCtx.beginPath();
        minimapCtx.arc(mx, my, 5, 0, Math.PI * 2);
        minimapCtx.fill();
      }

      // Draw player
      minimapCtx.fillStyle = '#36c';
      minimapCtx.beginPath();
      minimapCtx.arc(cx, cy, 4, 0, Math.PI * 2);
      minimapCtx.fill();

      // Draw cops
      minimapCtx.fillStyle = '#f00';
      state.cops.forEach(cop => {
        const copx = cx + (cop.pos.x - p.x) * scale;
        const copy = cy + (cop.pos.z - p.z) * scale;
        minimapCtx.fillRect(copx - 2, copy - 2, 4, 4);
      });
    }
  };
}
