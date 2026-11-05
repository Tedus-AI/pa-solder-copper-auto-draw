import { OrthographicCamera } from 'three';

export const faceViews = ['top', 'bottom', 'front', 'back', 'left', 'right'];

// CAD views use one scale at every depth, including the isometric view.
export function createCADCamera() {
  const camera = new OrthographicCamera(-40, 40, 30, -30, .01, 10000);
  camera.up.set(0, 0, 1);
  return camera;
}

export function cameraView(view, scale) {
  const directions = { top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  if (view === 'iso') return { offset: [scale, -scale * 1.2, scale], up: [0, 0, 1] };
  if (!directions[view]) throw new Error(`Unknown camera view: ${view}`);
  return { offset: directions[view].map(v => v * scale * 2.1), up: ['top', 'bottom'].includes(view) ? [0, 1, 0] : [0, 0, 1] };
}
