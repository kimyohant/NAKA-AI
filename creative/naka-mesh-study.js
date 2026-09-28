/* Naka's reference-led mesh. The original artwork in assets/naka-mascot.png
   defines the dark visor, cyan pill eyes, layered white/cobalt crest and coil.
   All surfaces are geometry, lit by the same lights as the selling stage. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function plate(shape, material, depth = .09, bevel = .035) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 5, curveSegments: 36, steps: 1
  });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

// A swept flame profile, with the hooked tip and a hollow inner curve visible
// in the original illustration. These are layered plates, not cones/spikes.
function flame(material, length, width, bend, depth = .09) {
  const s = new THREE.Shape();
  s.moveTo(-width * .46, 0);
  s.bezierCurveTo(-width * .9, length * .28, -width * .54, length * .65, bend, length);
  s.bezierCurveTo(bend - width * .03, length * .79, bend - width * .8, length * .58, width * .18, length * .48);
  s.bezierCurveTo(width * .55, length * .62, width * .60, length * .30, width * .45, 0);
  s.quadraticCurveTo(0, -width * .16, -width * .46, 0);
  return plate(s, material, depth, .026);
}

function sweptBody(curve, material) {
  const segments = 280, radial = 40;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [], normals = [], colors = [], indices = [];
  const pearl = new THREE.Color(0xf3f7ff), blue = new THREE.Color(0x064fef);
  const radiusAt = t => t < .26 ? THREE.MathUtils.lerp(.045, .40, THREE.MathUtils.smoothstep(t, 0, .26)) :
    THREE.MathUtils.lerp(.40, .25, THREE.MathUtils.smoothstep(t, .62, 1));
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, p = curve.getPointAt(t), radius = radiusAt(t);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(p.x + n.x * radius, p.y + n.y * radius, p.z + n.z * radius);
      normals.push(n.x, n.y, n.z);
      const c = blue.clone().lerp(pearl, THREE.MathUtils.smoothstep(Math.cos(a), -.05, .12));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const body = new THREE.Mesh(geometry, material); body.castShadow = true;
  return { body, frames, radiusAt, segments };
}

export function buildReferenceNaka() {
  const group = new THREE.Group(), head = new THREE.Group(), eyes = [];
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf3f7ff, roughness: .27, metalness: .08, clearcoat: .65, envMapIntensity: .7 });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x0658fa, roughness: .2, metalness: .18, clearcoat: 1, emissive: 0x032b9c, emissiveIntensity: .16 });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x032878, roughness: .16, metalness: .2, clearcoat: 1, envMapIntensity: .6 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x80eaff, toneMapped: false });
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .26, metalness: .08, clearcoat: .65, envMapIntensity: .7 });

  // The tail rises on the right. The neck emerges from inside the broad coil
  // and bends back toward the head, reproducing the reference's compact S.
  const path = new THREE.CatmullRomCurve3([
    V(1.13, 1.48, -.4), V(1.32, 1.03, -.4), V(1.12, .50, .05),
    V(.42, .38, .67), V(-.53, .39, .69), V(-1.12, .50, .13),
    V(-.96, .64, -.51), V(-.19, .69, -.60), V(.50, .68, -.23),
    V(.31, .90, .43), V(-.32, 1.14, .49), V(-.66, 1.45, .27),
    V(-.40, 1.87, .08), V(-.20, 2.30, .06)
  ], false, 'catmullrom', .5);
  const { body, frames, radiusAt, segments } = sweptBody(path, bodyMat);
  group.add(body);
  const seam = [];
  for (let i = 6; i < segments; i += 3) {
    const t = i / segments, n = frames.normals[i].clone().multiplyScalar(Math.cos(1.63)).addScaledVector(frames.binormals[i], Math.sin(1.63));
    seam.push(path.getPointAt(t).addScaledVector(n, radiusAt(t) * 1.004));
  }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 220, .009, 6), cyan));
  const tail = new THREE.Group(); tail.position.copy(path.getPointAt(0));
  const tailBlue = flame(blue, .87, .40, -.20, .14);
  const tailWhite = flame(pearl, .64, .23, -.10, .09);
  tailBlue.rotation.z = .13; tailWhite.position.set(-.11, -.02, .08); tailWhite.rotation.z = .35;
  tail.add(tailBlue, tailWhite); group.add(tail);
  [.43, .61, .86].forEach((t, i) => {
    const fin = flame(blue, .30 + i * .05, .23, .14, .07);
    fin.position.copy(path.getPointAt(t)).add(V(.10, radiusAt(t) * .8, -.10));
    fin.rotation.set(-.45, -.35, -.7); group.add(fin);
  });

  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 36), pearl);
  skull.scale.set(.77, .46, .46); skull.position.set(0, .01, -.05); skull.castShadow = true;
  head.add(skull);
  // The visor is a wide rounded trapezoid, with the top sides swept upward.
  const face = new THREE.Shape();
  face.moveTo(-.65, .22);
  face.bezierCurveTo(-.74, .06, -.71, -.25, -.52, -.34);
  face.bezierCurveTo(-.26, -.45, .25, -.44, .52, -.32);
  face.bezierCurveTo(.75, -.21, .76, .13, .60, .26);
  face.bezierCurveTo(.43, .40, .08, .17, -.17, .12);
  face.bezierCurveTo(-.38, .11, -.49, .28, -.65, .22);
  const visor = plate(face, visorMat, .12, .038); visor.position.z = .35;
  head.add(visor);
  const rimCurve = new THREE.CatmullRomCurve3(face.getPoints(80).map(p => V(p.x, p.y, .39)), true);
  head.add(new THREE.Mesh(new THREE.TubeGeometry(rimCurve, 120, .032, 10, true), pearl));

  // These two light strips are the defining face in the user-supplied art.
  [-.29, .23].forEach((x, i) => {
    const eye = new THREE.Mesh(new RoundedBoxGeometry(.12, .23, .055, 5, .049), cyan);
    eye.position.set(x, -.10 + i * .02, .46); eye.userData.openHeight = 1;
    eyes.push(eye); head.add(eye);
  });
  // White V-shaped forehead blade traces the signature brow into the crest.
  const brow = new THREE.Shape();
  brow.moveTo(-.68, .30);
  brow.bezierCurveTo(-.49, .56, -.22, .72, .30, .73);
  brow.bezierCurveTo(.06, .58, -.10, .42, -.28, .09);
  brow.bezierCurveTo(-.42, .19, -.53, .25, -.68, .30);
  const browMesh = plate(brow, pearl, .11, .025); browMesh.position.z = .43; head.add(browMesh);

  // Offset layers show individual white and blue hooked blades rather than a
  // symmetric crown; the three-quarter pose exposes the right ear and fins.
  [
    [-.25, .32, -.14, 1.28, .49, .50, blue, -.20],
    [-.34, .31, -.04, 1.22, .39, .48, pearl, -.26],
    [.33, .15, -.05, 1.0, .40, .43, blue, -.30],
    [.42, .16, .03, .88, .26, .42, pearl, -.43],
    [-.57, .25, -.12, .69, .28, .34, blue, -.08],
    [-.57, .25, -.02, .65, .19, .30, pearl, -.13]
  ].forEach(([x,y,z,l,w,b,m,rz]) => {
    const f = flame(m, l, w, b, .12); f.position.set(x,y,z); f.rotation.set(-.18, -.10, rz); head.add(f);
  });
  [-1, 1].forEach(side => {
    const ear = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(.23, .25, .115, 56), pearl);
    shell.rotation.z = Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(.174, .174, .12, 56), blue);
    disc.rotation.z = Math.PI / 2; disc.position.x = side * .055;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.145, .016, 12, 56), cyan);
    rim.rotation.y = Math.PI / 2; rim.position.x = side * .119;
    ear.add(shell, disc, rim); ear.position.set(side * .76, -.005, -.06); head.add(ear);
  });
  head.position.copy(path.getPointAt(1)).add(V(-.08, .20, .07));
  head.rotation.set(.03, -.30, -.04);
  group.add(head);
  group.userData.head = head; group.userData.eyes = eyes;
  return group;
}
