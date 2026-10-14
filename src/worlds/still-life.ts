import * as THREE from 'three';
import { palette } from '../palette';
import type { World, WorldContext } from './world';

// A tiny calibration scene: a few pastel shapes on a tray, enough to judge
// the glass, the light and the shadows before a real world moves in.

const mat = (color: string) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0 });

export class StillLife implements World {
  readonly id = 'still-life';
  readonly name = 'Still life';
  private bush?: THREE.Mesh;
  private t = 0;

  mount({ root, bounds }: WorldContext) {
    const floor = bounds.min.y;
    const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
      mesh.position.set(x, floor + y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), mat(palette.wood)), 0, 0.025, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.02, 0.84), mat(palette.cream)), 0, 0.055, 0);
    this.bush = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(palette.sage)), -0.18, 0.2, -0.12);
    add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), mat(palette.peach)), 0.2, 0.15, 0.12);
    add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), mat(palette.butter)), 0.12, 0.165, -0.2);
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(palette.dustyBlue)), -0.05, 0.11, 0.25);
  }

  step(dt: number) {
    this.t += dt;
    // The bush breathes, very slowly.
    this.bush?.scale.setScalar(1 + Math.sin(this.t * 0.6) * 0.03);
  }
}
