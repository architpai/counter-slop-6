import * as THREE from 'three';

export function boxGeo(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export function cylGeo(r, len, seg = 8, axis = 'z') {
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  return geo;
}

export function sphereGeo(r, seg = 8) {
  return new THREE.SphereGeometry(r, seg, Math.max(3, Math.floor(seg / 2)));
}

export function coneGeo(r, len, seg = 6) {
  return new THREE.ConeGeometry(r, len, seg);
}

export function torusGeo(r, tube, seg = 6, rings = 16) {
  return new THREE.TorusGeometry(r, tube, seg, rings);
}

export function starGeo(points, outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const angle = i * Math.PI / points + Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function ringGeo(r, thickness, seg = 24) {
  return new THREE.RingGeometry(Math.max(0, r - thickness / 2), r + thickness / 2, seg);
}
