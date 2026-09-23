// Quaternion order follows THREE: x, y, z, w. Reject missing/corrupt metadata.
export function validThumbnailQuaternion(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    Math.abs(value.reduce((sum, n) => sum + n * n, 0) - 1) < 0.001
}
