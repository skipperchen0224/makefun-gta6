export function createInput(canvas) {
  const keys = {};
  let mouseDX = 0;
  let mouseDY = 0;
  let clicked = false;
  let consumedActions = {};

  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    keys[e.key.toLowerCase()] = true;
  });

  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('click', () => {
    canvas.requestPointerLock();
    clicked = true;
  });

  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas) {
      mouseDX += e.movementX;
      mouseDY += e.movementY;
    }
  });

  return {
    keys,
    get mouseDX() {
      const val = mouseDX;
      mouseDX = 0;
      return val;
    },
    get mouseDY() {
      const val = mouseDY;
      mouseDY = 0;
      return val;
    },
    get clicked() {
      const val = clicked;
      clicked = false;
      return val;
    },
    axis(negativeKey, positiveKey) {
      let val = 0;
      if (keys[negativeKey] || keys[negativeKey.toUpperCase()]) val -= 1;
      if (keys[positiveKey] || keys[positiveKey.toUpperCase()]) val += 1;
      return val;
    },
    consume(action) {
      if (keys[action] || keys[action.toLowerCase()]) {
        if (consumedActions[action]) return false;
        consumedActions[action] = true;
        return true;
      }
      consumedActions[action] = false;
      return false;
    }
  };
}
