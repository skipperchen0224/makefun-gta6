import * as THREE from '../vendor/three.module.min.js';
import { MISSIONS, COLORS } from './config.js';

export function createMissions(scene, city, ctx) {
  let currentIndex = 0;
  let currentMission = null;
  let stageIndex = 0;
  let stageTimer = 0;
  let beaconMesh = null;
  let beaconLight = null;

  function createBeacon(x, z) {
    if (beaconMesh) {
      scene.remove(beaconMesh);
      scene.remove(beaconLight);
    }
    const geo = new THREE.CylinderGeometry(2, 2, 20, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.BEACON, wireframe: true, transparent: true, opacity: 0.6 });
    beaconMesh = new THREE.Mesh(geo, mat);
    beaconMesh.position.set(x, 10, z);
    scene.add(beaconMesh);

    beaconLight = new THREE.PointLight(COLORS.BEACON, 2, 30);
    beaconLight.position.set(x, 5, z);
    scene.add(beaconLight);
  }

  function removeBeacon() {
    if (beaconMesh) {
      scene.remove(beaconMesh);
      scene.remove(beaconLight);
      beaconMesh = null;
      beaconLight = null;
    }
  }

  return {
    get current() { return currentMission; },
    get index() { return currentIndex; },
    get complete() { return currentIndex >= MISSIONS.length; },
    start(i) {
      if (i >= MISSIONS.length) return;
      currentIndex = i;
      currentMission = MISSIONS[i];
      stageIndex = 0;
      const stage = currentMission.stages[stageIndex];
      stageTimer = stage.seconds || 0;
      createBeacon(stage.x, stage.z);
      ctx.toast(`Mission Started: ${currentMission.name}`);
    },
    update(dt) {
      if (!currentMission) return;
      const stage = currentMission.stages[stageIndex];
      const targetPos = new THREE.Vector3(stage.x, 0, stage.z);
      const playerPos = ctx.car ? ctx.car.pos : ctx.player.pos;

      if (stage.seconds > 0) {
        stageTimer -= dt;
        if (stageTimer <= 0) {
          ctx.toast("Mission Failed: Time ran out!");
          removeBeacon();
          currentMission = null;
          return;
        }
      }

      if (stage.type === 'evade') {
        if (ctx.wanted.stars === 0) {
          this.nextStage();
        }
      } else {
        if (playerPos.distanceTo(targetPos) <= stage.radius) {
          if (stage.type === 'steal') {
            ctx.addWanted(2);
          }
          this.nextStage();
        }
      }
    },
    nextStage() {
      if (!currentMission) return;
      stageIndex++;
      if (stageIndex >= currentMission.stages.length) {
        ctx.toast(`Mission Complete! Earned $${currentMission.reward}`);
        ctx.onPayout(currentMission.reward);
        removeBeacon();
        currentMission = null;
        currentIndex++;
      } else {
        const stage = currentMission.stages[stageIndex];
        stageTimer = stage.seconds || 0;
        createBeacon(stage.x, stage.z);
        ctx.toast(stage.text);
      }
    },
    statusText() {
      if (!currentMission) return "No active mission. Explore the city or find a mission trigger.";
      const stage = currentMission.stages[stageIndex];
      const timeStr = stage.seconds > 0 ? ` (Time: ${Math.ceil(stageTimer)}s)` : '';
      return `${currentMission.name}: ${stage.text}${timeStr}`;
    },
    get marker() {
      if (!currentMission) return null;
      const stage = currentMission.stages[stageIndex];
      return { x: stage.x, z: stage.z };
    }
  };
}
