import * as THREE from '../vendor/three.module.min.js';
import { COLORS, TUNING } from './config.js';
import { createVehicle } from './vehicles.js';

export function createCops(scene, city) {
  const cops = [];

  return {
    list: cops,
    spawn(pos, wantedStars) {
      if (cops.length >= wantedStars * 2) return;
      const angle = Math.random() * Math.PI * 2;
      const spawnDist = 40;
      const x = pos.x + Math.sin(angle) * spawnDist;
      const z = pos.z + Math.cos(angle) * spawnDist;

      const cruiser = createVehicle(scene, { x, y: 0, z, color: COLORS.COP });

      // Add red/blue flashing light bar on roof (y=1.6 sits on the cabin roof,
      // above the body top at y=1.0, so the lights stay visible).
      const barGroup = new THREE.Group();
      const lightGeo = new THREE.BoxGeometry(0.8, 0.2, 0.3);

      const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const blueMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });

      const redLight = new THREE.Mesh(lightGeo, redMat);
      redLight.position.set(-0.2, 1.6, 0);
      barGroup.add(redLight);

      const blueLight = new THREE.Mesh(lightGeo, blueMat);
      blueLight.position.set(0.2, 1.6, 0);
      barGroup.add(blueLight);

      cruiser.group.add(barGroup);

      cops.push({
        car: cruiser,
        redLight,
        blueLight,
        update(dt, targetPos) {
          const dir = new THREE.Vector3().subVectors(targetPos, cruiser.pos);
          dir.y = 0;
          const dist = dir.length();
          dir.normalize();

          const targetHeading = Math.atan2(dir.x, dir.z);
          let diff = targetHeading - cruiser.heading;

          // Normalize diff to -PI to PI
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;

          let left = false;
          let right = false;
          if (Math.abs(diff) > 0.05) {
            if (diff > 0) {
              right = true;
            } else {
              left = true;
            }
          }

          // Flashing lights cycle
          const flashTime = Date.now() * 0.01;
          const flashState = Math.floor(flashTime) % 2 === 0;
          this.redLight.visible = flashState;
          this.blueLight.visible = !flashState;

          cruiser.update(dt, { forward: dist > 5, left, right }, city.colliders);
        }
      });
    },
    despawnAll() {
      cops.forEach(c => c.car.destroy());
      cops.length = 0;
    },
    update(dt, playerPos, wantedStars) {
      if (wantedStars > 0 && Math.random() < 0.02 * wantedStars) {
        this.spawn(playerPos, wantedStars);
      }
      cops.forEach(c => c.update(dt, playerPos));
    },
    isNearPlayer(playerPos, dist = 3.0) {
      return cops.some(c => c.car.pos.distanceTo(playerPos) < dist);
    },
    touchPlayer(playerPos) {
      return cops.some(c => c.car.pos.distanceTo(playerPos) < TUNING.COP_CATCH_DIST);
    }
  };
}
