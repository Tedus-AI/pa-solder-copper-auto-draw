export const faceViews = ['top', 'bottom', 'front', 'back', 'left', 'right'];

export function cameraView(view, scale) {
  const directions = { top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  if (view === 'iso') return { offset: [scale, -scale * 1.2, scale], up: [0, 0, 1] };
  if (!directions[view]) throw new Error(`Unknown camera view: ${view}`);
  return { offset: directions[view].map(v => v * scale * 2.1), up: ['top', 'bottom'].includes(view) ? [0, 1, 0] : [0, 0, 1] };
}
