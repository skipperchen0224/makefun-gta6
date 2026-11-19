import * as THREE from '../vendor/three.module.min.js';
import { COLORS } from './config.js';

export function createPeds(scene, city, count = 20) {
  const peds = [];

  const pedGeo = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
  const pedMat = new THREE.MeshStandardMaterial({ color: COLORS.PED, roughness: 0.8 });

  for (let i = 0; i < count; i++) {
    const road = city.roads[Math.floor(Math.random() * city.roads.length)];
    const mesh = new THREE.Mesh(pedGeo, pedMat);
    mesh.position.set(
      road.x + (Math.random() - 0.5) * 30,
      0.9,
      road.z + (Math.random() - 0.5) * 30
    );
    mesh.castShadow = true;
    scene.add(mesh);

    peds.push({
      mesh,
      health: 10,
      wanderTimer: Math.random() * 5,
      dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
      isPed: true,
      destroy() {
        scene.remove(mesh);
      }
    });
  }

  return {
    list: peds,
    update(dt, playerPos) {
      peds.forEach(ped => {
        ped.wanderTimer -= dt;
        if (ped.wanderTimer <= 0) {
          ped.wanderTimer = 3 + Math.random() * 5;
          ped.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        }
        ped.mesh.position.addScaledVector(ped.dir, 1.2 * dt);

        if (ped.mesh.position.distanceTo(playerPos) > 300) {
          ped.mesh.position.set(
            playerPos.x + (Math.random() - 0.5) * 200,
            0.9,
            playerPos.z + (Math.random() - 0.5) * 200
          );
        }
      });
    }
  };
}
