import * as THREE from '../vendor/three.module.min.js';
import { COLORS, TUNING } from './config.js';

export function createVehicle(scene, opts = {}) {
  const group = new THREE.Group();

  // Car body
  const bodyGeo = new THREE.BoxGeometry(1.8, 0.8, 4.0);
  const color = opts.color || COLORS.TRAFFIC[Math.floor(Math.random() * COLORS.TRAFFIC.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.5, 0.6, 2.0);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 1.2, -0.2);
  cabin.castShadow = true;
  group.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheelPositions = [
    [-0.9, 0.4, 1.3], [0.9, 0.4, 1.3],
    [-0.9, 0.4, -1.3], [0.9, 0.4, -1.3]
  ];
  const wheels = wheelPositions.map(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(...pos);
    group.add(wheel);
    return wheel;
  });

  scene.add(group);
  group.position.set(opts.x || 0, opts.y || 0, opts.z || 0);

  let speed = 0;
  let heading = opts.heading || 0;
  let health = 100;

  const car = {
    group,
    get pos() { return group.position; },
    get heading() { return heading; },
    get speed() { return speed; },
    get health() { return health; },
    set health(h) { health = h; },
    isCar: true,
    update(dt, ctrl = {}, colliders = []) {
      if (ctrl.forward) {
        speed = Math.min(speed + TUNING.CAR_ACCEL * dt, TUNING.CAR_MAX_SPEED);
      } else if (ctrl.reverse) {
        speed = Math.max(speed - TUNING.CAR_ACCEL * dt, -TUNING.CAR_MAX_SPEED * 0.4);
      } else {
        speed *= 0.95;
        if (Math.abs(speed) < 0.1) speed = 0;
      }

      if (ctrl.brake) {
        speed *= 0.85;
      }

      if (Math.abs(speed) > 0.5) {
        const steerDir = speed > 0 ? 1 : -1;
        if (ctrl.left) heading += TUNING.CAR_STEER * steerDir * dt;
        if (ctrl.right) heading -= TUNING.CAR_STEER * steerDir * dt;
      }

      group.rotation.y = heading;
      const moveX = Math.sin(heading) * speed * dt;
      const moveZ = Math.cos(heading) * speed * dt;

      group.position.x += moveX;
      group.position.z += moveZ;

      // Simple collision vs buildings
      const carBox = new THREE.Box3().setFromObject(body);
      for (let c of colliders) {
        if (carBox.intersectsBox(c)) {
          group.position.x -= moveX * 1.5;
          group.position.z -= moveZ * 1.5;
          health -= Math.abs(speed) * 0.8;
          speed = -speed * 0.3;
          break;
        }
      }
    },
    destroy() {
      scene.remove(group);
    }
  };

  return car;
}

export function createTraffic(scene, city, count = 15) {
  // Roads run on lines x/z = -200,-160,...,160,200; buildings sit at block
  // centers, so traffic must spawn ON a road line with a heading along it,
  // or it spawns inside a building and crashes forever.
  const roadCoords = [-200, -160, -120, -80, -40, 0, 40, 80, 120, 160, 200];

  function spawnRoadSpawn() {
    const r = roadCoords[Math.floor(Math.random() * roadCoords.length)];
    let x, z, heading;
    if (Math.random() < 0.5) {
      x = r;
      z = (Math.random() - 0.5) * 380; // range [-190, 190]
      heading = Math.random() < 0.5 ? 0 : Math.PI;
    } else {
      z = r;
      x = (Math.random() - 0.5) * 380; // range [-190, 190]
      heading = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
    return { x, z, heading };
  }

  const cars = [];
  for (let i = 0; i < count; i++) {
    const spawn = spawnRoadSpawn();
    const car = createVehicle(scene, { x: spawn.x, y: 0, z: spawn.z, heading: spawn.heading });
    cars.push(car);
  }

  return {
    list: cars,
    update(dt, playerPos) {
      cars.forEach(car => {
        car.update(dt, { forward: true }, city.colliders);
      });

      // Respawn far-away cars on a fresh road line. Heading lives inside
      // createVehicle with no setter, so respawn recreates the car.
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].pos.distanceTo(playerPos) > 250) {
          cars[i].destroy();
          const spawn = spawnRoadSpawn();
          cars[i] = createVehicle(scene, { x: spawn.x, y: 0, z: spawn.z, heading: spawn.heading });
        }
      }
    }
  };
}
