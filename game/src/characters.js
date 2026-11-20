// Palmetto Heat — dual protagonists: Lucia and Jason.
// GTA 6's spirit is a two-lead story, so Palmetto Heat has one too. Lucia
// is the wheelwoman: quicker on foot, sharper handling, lighter armour.
// Jason is the heavy: more health, more armour, slower on foot. Press Q to
// swap leads mid-run; the save remembers who you were last playing as.

import * as THREE from 'three';

export const CHARACTERS = {
  lucia: {
    id: 'lucia',
    name: 'Lucia',
    tag: 'Wheelwoman',
    jacket: 0xff5a7a,
    hair: 0x241610,
    hairStyle: 'bun',
    skin: 0xc98d64,
    pants: 0x27324a,
    hp: 100,
    armorMax: 50,
    walkSpeed: 7.6,
    runSpeed: 12.0,
    grip: 3.4,
    blurb: 'Lucia drives like the city owes her money.',
  },
  jason: {
    id: 'jason',
    name: 'Jason',
    tag: 'Heavy',
    jacket: 0x2e6fb5,
    hair: 0x14100c,
    hairStyle: 'cap',
    skin: 0xd9a986,
    pants: 0x3a2f28,
    hp: 120,
    armorMax: 100,
    walkSpeed: 6.6,
    runSpeed: 10.4,
    grip: 3.0,
    blurb: 'Jason hits hard and soaks up worse.',
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);

export function characterDef(id) {
  return CHARACTERS[id] || CHARACTERS.lucia;
}

export function otherCharacter(id) {
  return id === 'lucia' ? 'jason' : 'lucia';
}

// Build the on-foot mesh for a lead. Lucia gets a hair bun and a pink
// jacket; Jason gets a cap and a blue jacket. Same skeleton, same scale,
// so swapping is a mesh swap, never a physics change.
export function buildCharacterMesh(id) {
  const def = characterDef(id);
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: def.jacket });
  const skin = new THREE.MeshLambertMaterial({ color: def.skin });
  const pants = new THREE.MeshLambertMaterial({ color: def.pants });
  const hairMat = new THREE.MeshLambertMaterial({ color: def.hair });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.0, 8), jacket);
  body.position.y = 1.05;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
  head.position.y = 1.82;
  g.add(head);
  if (def.hairStyle === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), hairMat);
    bun.position.set(0, 2.02, -0.18);
    g.add(bun);
    const fringe = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hairMat,
    );
    fringe.position.y = 1.86;
    g.add(fringe);
  } else {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.12, 10), hairMat);
    cap.position.y = 2.0;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.3), hairMat);
    brim.position.set(0, 1.96, 0.3);
    g.add(brim);
  }
  for (const x of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 6), pants);
    leg.position.set(x, 0.32, 0);
    g.add(leg);
  }
  g.userData.characterId = def.id;
  return g;
}
