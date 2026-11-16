import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaults } from '../src/design.js';
import { copperFootprint } from '../src/copper-geometry.js';
import { holeCenters } from '../src/hole-corners.js';
import { featureEdges } from '../src/feature-edges.js';

// The copper base exactly as the 3D preview extrudes it.
function base(copper) {
  const shapes = copperFootprint(copper).profile.map(polygon => {
    const shape = new THREE.Shape(polygon[0].slice(0, -1).map(p => new THREE.Vector2(...p)));
    shape.holes = polygon.slice(1).map(ring => new THREE.Path(ring.slice(0, -1).map(p => new THREE.Vector2(...p))));
    return shape;
  });
  return new THREE.ExtrudeGeometry(shapes, { depth: copper.base_thickness, bevelEnabled: false, curveSegments: 24 });
}
// Edges lying flat inside the base, away from its outline and its holes.
function strayEdges(edges, c) {
  const p = edges.getAttribute('position'),
    stray = [];
  for (let i = 0; i < p.count; i += 2) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)],
      b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    if (Math.abs(a[2] - b[2]) > 1e-4) continue;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const onHole = holeCenters(c).some(
      ([x, y]) => Math.abs(Math.hypot(m[0] - x, m[1] - y) - c.hole_diameter / 2) < 0.05,
    );
    const inside =
      Math.abs(m[0]) < c.base_length / 2 - c.corner_radius / 3 - 0.05 && Math.abs(m[1]) < c.base_width / 2 - 0.05;
    if (inside && !onHole && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) stray.push([a, b]);
  }
  return stray;
}

test('3D outline has no stray line between hanging holes (degenerate triangles on the hole bridge)', () => {
  const c = {
    ...defaults.copper,
    base_length: 36,
    base_width: 32,
    corner_radius: 3,
    hole_edge_offset: 3.5,
    hole_diameter: 2.5,
  };
  c.hole_corners = ['bottom_left', 'top_right'];
  const geometry = base(c);
  assert.ok(
    strayEdges(new THREE.EdgesGeometry(geometry, 24), c).length > 0,
    'this case reproduces the stray hole-to-hole line',
  );
  assert.deepEqual(strayEdges(featureEdges(geometry, 24), c), []);
});

test('featureEdges draws the same outline as EdgesGeometry when there are no degenerate triangles', () => {
  const key = (g, i) => [0, 1, 2].map(k => Math.round(g.getAttribute('position').getComponent(i, k) * 1e3)).join(',');
  const set = edges => {
    const result = new Set();
    for (let i = 0; i < edges.getAttribute('position').count; i += 2)
      result.add([key(edges, i), key(edges, i + 1)].sort().join('|'));
    return result;
  };
  for (const geometry of [
    base(defaults.copper),
    new THREE.BoxGeometry(2, 3, 4),
    new THREE.CylinderGeometry(1, 1, 2, 32),
  ]) {
    assert.deepEqual(set(featureEdges(geometry, 24)), set(new THREE.EdgesGeometry(geometry, 24)));
  }
});
