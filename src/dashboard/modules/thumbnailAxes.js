import { Quaternion, Vector3 } from 'three'
import { validThumbnailQuaternion } from '../../lib/thumbnailCamera.js'

export function thumbnailAxesMarkup(quaternion) {
  if (!validThumbnailQuaternion(quaternion)) return ''
  const inverse = new Quaternion().fromArray(quaternion).invert()
  const axes = [
    { label: 'X', color: '#dc2626', direction: new Vector3(1, 0, 0) },
    { label: 'Y', color: '#15803d', direction: new Vector3(0, 1, 0) },
    { label: 'Z', color: '#2563eb', direction: new Vector3(0, 0, 1) },
  ].map(axis => ({ ...axis, direction: axis.direction.applyQuaternion(inverse) }))
  axes.sort((a, b) => a.direction.z - b.direction.z)
  return `<svg class="card-thumbnail-axes" viewBox="0 0 64 64" role="img" aria-label="XYZ-Achsen der Vorschaubildkamera">${axes.map(({ label, color, direction: d }) =>
    `<g stroke="${color}" fill="${color}"><line x1="32" y1="32" x2="${32 + d.x * 20}" y2="${32 - d.y * 20}" stroke-width="2" stroke-linecap="round"/><text x="${32 + d.x * 27}" y="${32 - d.y * 27}" stroke="none" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="600">${label}</text></g>`
  ).join('')}<circle cx="32" cy="32" r="2" fill="#64748b"/></svg>`
}

export function updateThumbnailAxes(container, quaternion) {
  container?.querySelector('.card-thumbnail-axes')?.remove()
  container?.insertAdjacentHTML('beforeend', thumbnailAxesMarkup(quaternion))
}

// Reads the viewer's camera only; called by its existing animation loop.
export function createLiveCameraAxes(container, camera) {
  const host = document.createElement('div')
  host.className = 'detail-camera-axes'
  container.append(host)
  const current = new Quaternion()
  let previous = ''
  function update() {
    const quaternion = camera.getWorldQuaternion(current).toArray()
    const signature = quaternion.join(',')
    if (signature === previous) return
    previous = signature
    host.innerHTML = thumbnailAxesMarkup(quaternion)
    host.firstElementChild?.setAttribute('aria-label', 'XYZ-Achsen der aktuellen Kameraansicht')
  }
  update()
  return { update, dispose: () => host.remove() }
}
