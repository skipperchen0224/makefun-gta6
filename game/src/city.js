import * as THREE from '../vendor/three.module.min.js';
import { WORLD, COLORS } from './config.js';

export function buildCity(scene) {
  const colliders = [];
  const roads = [];

  // Lighting
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.6);
  hemiLight.position.set(0, 200, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.8);
  dirLight.position.set(150, 300, 100);
  dirLight.castShadow = true;
  dirLight.shadow.camera.top = WORLD.SIZE;
  dirLight.shadow.camera.bottom = -WORLD.SIZE;
  dirLight.shadow.camera.left = -WORLD.SIZE;
  dirLight.shadow.camera.right = WORLD.SIZE;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 800;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  // Big Sky-Dome Sphere with vertex-color gradient (BackSide)
  const skyGeo = new THREE.SphereGeometry(600, 32, 15);
  skyGeo.scale(-1, 1, 1);
  const posAttr = skyGeo.attributes.position;
  const colors = [];
  const topColor = new THREE.Color(0x3a7bd5);
  const bottomColor = new THREE.Color(0xf2994a);
  const tempColor = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const t = (y + 600) / 1200;
    tempColor.copy(bottomColor).lerp(topColor, Math.max(0, Math.min(1, t)));
    colors.push(tempColor.r, tempColor.g, tempColor.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(WORLD.SIZE * 2, WORLD.SIZE * 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.GROUND, roughness: 0.9 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid / Blocks layout
  const blockSize = WORLD.BLOCK;
  const roadWidth = WORLD.ROAD_W;
  const halfWorld = WORLD.SIZE / 2;

  // Build grid roads and buildings
  for (let x = -halfWorld + blockSize / 2; x < halfWorld; x += blockSize) {
    for (let z = -halfWorld + blockSize / 2; z < halfWorld; z += blockSize) {
      // Road segments around the block
      roads.push({ x, z, w: blockSize, h: blockSize });

      // Building
      const bWidth = blockSize - roadWidth - 4;
      const bDepth = blockSize - roadWidth - 4;
      const bHeight = 15 + Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 35);

      const bGeo = new THREE.BoxGeometry(bWidth, bHeight, bDepth);
      const bMat = new THREE.MeshStandardMaterial({
        color: (Math.abs(x + z) % 80 === 0) ? COLORS.BUILDING_ACCENT : COLORS.BUILDING,
        roughness: 0.7
      });
      const building = new THREE.Mesh(bGeo, bMat);
      building.position.set(x, bHeight / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);

      // Collider box for building
      colliders.push(new THREE.Box3().setFromObject(building));

      // Sidewalk surrounding building
      const swGeo = new THREE.BoxGeometry(blockSize - roadWidth, 0.2, blockSize - roadWidth);
      const swMat = new THREE.MeshStandardMaterial({ color: COLORS.SIDEWALK });
      const sidewalk = new THREE.Mesh(swGeo, swMat);
      sidewalk.position.set(x, 0.1, z);
      sidewalk.receiveShadow = true;
      scene.add(sidewalk);
    }
  }

  // Road surfaces overlay
  const roadMat = new THREE.MeshStandardMaterial({ color: COLORS.ROAD, roughness: 0.8 });
  for (let i = -halfWorld; i <= halfWorld; i += blockSize) {
    // X roads
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.SIZE, roadWidth), roadMat);
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.set(0, 0.05, i);
    roadX.receiveShadow = true;
    scene.add(roadX);

    // Z roads
    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, WORLD.SIZE), roadMat);
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.set(i, 0.05, 0);
    roadZ.receiveShadow = true;
    scene.add(roadZ);
  }

  // --- ADDED DETAILS ---

  // Helper: Palm Trees
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 6, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.8 });

  function createPalmTree(x, z) {
    const treeGroup = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    for (let f = 0; f < 5; f++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(2, 0.5, 4), frondMat);
      const angle = (f / 5) * Math.PI * 2;
      frond.position.set(Math.sin(angle) * 1.2, 5.5, Math.cos(angle) * 1.2);
      frond.rotation.z = Math.sin(angle) * 0.5;
      frond.rotation.x = Math.cos(angle) * 0.5;
      frond.castShadow = true;
      treeGroup.add(frond);
    }
    treeGroup.position.set(x, 0, z);
    scene.add(treeGroup);
  }

  // Helper: Street Lamps
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
  const bulbGeo = new THREE.SphereGeometry(0.3, 8, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });

  function createStreetLamp(x, z) {
    const lampGroup = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3;
    lampGroup.add(pole);

    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(0.5, 5.8, 0);
    lampGroup.add(bulb);

    lampGroup.position.set(x, 0, z);
    scene.add(lampGroup);
  }

  // Place palm trees and street lamps along intersections / road sides
  for (let x = -halfWorld + blockSize / 2; x < halfWorld; x += blockSize) {
    for (let z = -halfWorld + blockSize / 2; z < halfWorld; z += blockSize) {
      const halfSw = (blockSize - roadWidth) / 2;
      createPalmTree(x - halfSw + 1, z - halfSw + 1);
      createStreetLamp(x + halfSw - 1, z + halfSw - 1);
    }
  }

  // Beach Strip & Animated Ocean Plane on South Edge (z beyond +180)
  const beachZ = halfWorld + 40;
  const beachGeo = new THREE.PlaneGeometry(WORLD.SIZE * 2, 100);
  const beachMat = new THREE.MeshStandardMaterial({ color: 0xf4d06f, roughness: 0.95 });
  const beach = new THREE.Mesh(beachGeo, beachMat);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.02, beachZ);
  beach.receiveShadow = true;
  scene.add(beach);

  const oceanZ = beachZ + 120;
  const oceanGeo = new THREE.PlaneGeometry(WORLD.SIZE * 3, WORLD.SIZE * 2, 32, 32);
  const oceanMat = new THREE.MeshStandardMaterial({ color: 0x1e90ff, roughness: 0.1, transparent: true, opacity: 0.85 });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.2, oceanZ);
  scene.add(ocean);

  // Small Marina with Wooden Docks
  const dockGroup = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
  const mainDock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 40), plankMat);
  mainDock.position.set(0, 0.3, beachZ);
  mainDock.receiveShadow = true;
  dockGroup.add(mainDock);

  for (let dz = -15; dz <= 15; dz += 10) {
    const sideDock = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 2), plankMat);
    sideDock.position.set(6, 0.3, beachZ + dz);
    sideDock.receiveShadow = true;
    dockGroup.add(sideDock);
  }
  scene.add(dockGroup);

  // Distant Skyline Boxes Beyond City Bounds
  const skylineGroup = new THREE.Group();
  const skylineMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.5 });
  for (let i = 0; i < 30; i++) {
    const swWidth = 20 + Math.random() * 30;
    const swDepth = 20 + Math.random() * 30;
    const swHeight = 80 + Math.random() * 120;
    const sBox = new THREE.Mesh(new THREE.BoxGeometry(swWidth, swHeight, swDepth), skylineMat);

    const angle = (i / 30) * Math.PI * 2;
    const dist = halfWorld + 80 + Math.random() * 40;
    sBox.position.set(Math.cos(angle) * dist, swHeight / 2, Math.sin(angle) * dist);
    skylineGroup.add(sBox);
  }
  scene.add(skylineGroup);

  // --- END ADDED DETAILS ---

  // Outer bounds walls (invisible colliders)
  const boundLimit = halfWorld - 10;
  const bounds = {
    minX: -boundLimit,
    maxX: boundLimit,
    minZ: -boundLimit,
    maxZ: boundLimit
  };

  return {
    colliders,
    roads,
    spawn: { x: 0, y: 0.5, z: halfWorld - 30 },
    bounds,
    update: (dt) => {
      // Animate ocean waves
      const time = Date.now() * 0.002;
      const posAttrOcean = ocean.geometry.attributes.position;
      for (let i = 0; i < posAttrOcean.count; i++) {
        const u = posAttrOcean.getX(i);
        const v = posAttrOcean.getY(i);
        posAttrOcean.setZ(i, Math.sin(u * 0.1 + time) * Math.cos(v * 0.1 + time) * 1.5);
      }
      posAttrOcean.needsUpdate = true;
    }
  };
}
