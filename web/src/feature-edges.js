import { Float32BufferAttribute, BufferGeometry, Triangle, Vector3, MathUtils } from 'three';

// Outline edges of a triangulated part, like THREE.EdgesGeometry (an edge is drawn where the
// two faces meet at more than `thresholdAngle`, or where only one face has it), except for
// degenerate triangles. A triangulator joins each hole to the outline with a zero-width
// bridge and can leave zero-area triangles along it; such a triangle has no normal, so
// EdgesGeometry drew the bridge as an edge — a stray line from one hanging hole to the next
// across the copper face. A degenerate triangle lies inside a flat face, so here it takes
// the normal of the neighbour whose plane holds all three of its points: the bridge then
// joins two pieces of the same face (no edge), while a real edge it touches, such as a
// hole rim, still separates two different faces.
const PRECISION = 1e4; // vertices closer than 0.1 µm are the same vertex
const SLIVER = 1e-6; // twice the area below this × (longest side)² = degenerate

export function featureEdges(geometry, thresholdAngle = 24) {
  const position = geometry.getAttribute('position'),
    index = geometry.index,
    count = index ? index.count : position.count;
  const cos = Math.cos(MathUtils.DEG2RAD * thresholdAngle);
  const key = i =>
    `${Math.round(position.getX(i) * PRECISION)},${Math.round(position.getY(i) * PRECISION)},${Math.round(position.getZ(i) * PRECISION)}`;
  const triangles = [],
    edges = new Map(),
    shape = new Triangle();
  for (let t = 0; t + 2 < count; t += 3) {
    const ids = [0, 1, 2].map(k => (index ? index.getX(t + k) : t + k)),
      keys = ids.map(key);
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue; // collapsed to a line or point
    const points = ids.map(id => new Vector3().fromBufferAttribute(position, id));
    shape.set(...points);
    const longest = Math.max(
      points[0].distanceToSquared(points[1]),
      points[1].distanceToSquared(points[2]),
      points[2].distanceToSquared(points[0]),
    );
    const triangle = {
      points,
      normal: 2 * shape.getArea() > SLIVER * longest ? shape.getNormal(new Vector3()) : null,
      hashes: [],
      lengths: [],
    };
    triangles.push(triangle);
    for (let k = 0; k < 3; k++) {
      const a = keys[k],
        b = keys[(k + 1) % 3],
        hash = a < b ? `${a}|${b}` : `${b}|${a}`;
      triangle.hashes.push(hash);
      triangle.lengths.push(points[k].distanceTo(points[(k + 1) % 3]));
      const edge = edges.get(hash);
      if (edge) edge.triangles.push(triangle);
      else edges.set(hash, { from: ids[k], to: ids[(k + 1) % 3], triangles: [triangle] });
    }
  }
  // Degenerate triangles take the plane of a neighbour that contains them (repeated for
  // chains of them). A degenerate triangle is a line segment, which lies in several planes
  // (the face it crosses, and maybe a hole wall along the same line), so the neighbour across
  // its longest side — the face the bridge runs through — is tried first. One that matches
  // no neighbour keeps no normal; its edges are not drawn.
  const scale = Math.sqrt(Math.max(...triangles.flatMap(t => t.points.map(p => p.lengthSq())), 1));
  for (let pass = 0, changed = true; changed && pass < 4; pass++) {
    changed = false;
    for (const triangle of triangles) {
      if (triangle.normal) continue;
      const order = [0, 1, 2].sort((x, y) => triangle.lengths[y] - triangle.lengths[x]);
      for (const hash of order.map(k => triangle.hashes[k])) {
        const host = edges
          .get(hash)
          .triangles.find(
            other =>
              other !== triangle &&
              other.normal &&
              triangle.points.every(p => Math.abs(other.normal.dot(p.clone().sub(other.points[0]))) < 1e-7 * scale),
          );
        if (host) {
          triangle.normal = host.normal;
          changed = true;
          break;
        }
      }
    }
  }
  const out = [];
  for (const { from, to, triangles: faces } of edges.values()) {
    if (faces.some(face => !face.normal)) continue;
    if (faces.length === 1 || faces[0].normal.dot(faces[1].normal) <= cos)
      out.push(
        position.getX(from),
        position.getY(from),
        position.getZ(from),
        position.getX(to),
        position.getY(to),
        position.getZ(to),
      );
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(out, 3));
  return result;
}
