export function createAudio() {
  let ctx = null;
  let muted = false;

  function init() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  return {
    resume() {
      init();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    },
    setMuted(m) {
      muted = m;
    },
    start() {
      init();
      this.beep(440, 0.1);
    },
    beep(freq = 440, duration = 0.1) {
      if (muted) return;
      init();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration);
    },
    shoot() {
      this.beep(150, 0.05);
    },
    coin() {
      if (muted) return;
      init();
      this.beep(880, 0.08);
      setTimeout(() => this.beep(1320, 0.12), 80);
    },
    crash() {
      this.beep(80, 0.2);
    },
    busted() {
      if (muted) return;
      init();
      [300, 200, 100].forEach((f, i) => setTimeout(() => this.beep(f, 0.3), i * 300));
    },
    engine(speed) {}
  };
}
