/* The selected plush Naka artwork is the surface of a shallow relief mesh
   with an alpha-traced outline. Its unseen back is not invented.
   Scene cameras stay near the illustrated angle. */
import * as THREE from 'three';

export async function buildNakaRelief() {
  const texture = await new THREE.TextureLoader().loadAsync('/assets/naka-plush-sales.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const img = texture.image;
  const c = document.createElement('canvas');
  const n = 160;
  c.width = c.height = n + 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const positions = [], uv = [], indices = [];
  const size = 3.95;
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    const k = (y * (n + 1) + x) * 4;
    const alpha = rgba[k + 3] / 255;
    // A shallow convex relief adds depth without changing the illustrated pose.
    const px = x / n, py = y / n;
    const convex = Math.max(0, 1 - (px - .5) ** 2 * 3 - (py - .5) ** 2 * 2);
    const z = alpha * (.065 + .12 * convex);
    positions.push((px - .5) * size, (1 - py) * size, z);
    uv.push(px, 1 - py);
  }
  const solid = i => rgba[i * 4 + 3] > 24;
  const tri = (a, b, d) => {
    indices.push(a, b, d);
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x, b = a + 1, d = a + n + 1, e = d + 1;
    // Keep edge triangles; the texture alpha clips their exact curved outline.
    if (solid(a) || solid(d) || solid(b)) tri(a, d, b);
    if (solid(b) || solid(d) || solid(e)) tri(b, d, e);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .01, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  // Keep the seated coil fixed. Only the upper body follows a tiny, slow breath.
  const motion = { breath: { value: 0 }, lean: { value: 0 } };
  surface.material.onBeforeCompile = shader => {
    shader.uniforms.uNakaBreath = motion.breath;
    shader.uniforms.uNakaLean = motion.lean;
    shader.vertexShader = 'uniform float uNakaBreath; uniform float uNakaLean;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float upperBody = smoothstep(1.25, 2.85, position.y);
      transformed.y += uNakaBreath * upperBody;
      transformed.x += uNakaLean * upperBody * upperBody;
    `);
  };
  surface.renderOrder = 2;
  const group = new THREE.Group();
  group.name = 'Naka plush relief';
  group.add(surface);
  group.userData.motion = motion;
  group.userData.representation = 'selected plush artwork on alpha-traced 2.5D relief';
  return group;
}
