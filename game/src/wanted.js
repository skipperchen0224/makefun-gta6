export function createWanted() {
  return {
    stars: 0,
    timer: 0,
    add(amount) {
      this.stars = Math.min(5, this.stars + amount);
      this.timer = 15; // 15 seconds cooldown per star level if hiding
    },
    clear() {
      this.stars = 0;
      this.timer = 0;
    },
    update(dt) {
      if (this.stars > 0) {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.stars--;
          this.timer = 15;
        }
      }
    }
  };
}
