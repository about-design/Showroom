/**
 * bakeYUp.js – Post-Processing: brennt Root-Node Z-up-Korrekturen in Vertex-Daten ein.
 * Wird vom ConversionService VOR _optimizeGlbArtifact aufgerufen wenn bakeYUp=true.
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'fs/promises';
import path from 'path';

const EPSILON = 0.005;

function isIdentityQuat([x, y, z, w]) {
  return Math.abs(x) < EPSILON && Math.abs(y) < EPSILON &&
         Math.abs(z) < EPSILON && Math.abs(Math.abs(w) - 1) < EPSILON;
}

/** 3×3-Rotationsteil der 4×4-Matrix ist Identity (bis auf EPSILON). */
function isIdentityMatrix4(m) {
  if (!m || m.length < 16) return true;
  const e = EPSILON;
  return (
    Math.abs(m[0] - 1) < e && Math.abs(m[1]) < e && Math.abs(m[2]) < e &&
    Math.abs(m[4]) < e && Math.abs(m[5] - 1) < e && Math.abs(m[6]) < e &&
    Math.abs(m[8]) < e && Math.abs(m[9]) < e && Math.abs(m[10] - 1) < e
  );
}

/** Quaternion aus 4×4-Matrix (3×3-Rotation, column-major) extrahieren (xyzw). */
function mat4ToQuat(m) {
  if (!m || m.length < 16) return [0, 0, 0, 1];
  const m0 = m[0], m1 = m[1], m2 = m[2], m4 = m[4], m5 = m[5], m6 = m[6], m8 = m[8], m9 = m[9], m10 = m[10];
  const trace = m0 + m5 + m10;
  const out = [0, 0, 0, 1];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[3] = 0.25 / s;
    out[0] = (m6 - m9) * s;
    out[1] = (m8 - m2) * s;
    out[2] = (m4 - m1) * s;
  } else if (m0 > m5 && m0 > m10) {
    const s = 2 * Math.sqrt(1 + m0 - m5 - m10);
    out[3] = (m6 - m9) / s;
    out[0] = 0.25 * s;
    out[1] = (m1 + m4) / s;
    out[2] = (m2 + m8) / s;
  } else if (m5 > m10) {
    const s = 2 * Math.sqrt(1 + m5 - m0 - m10);
    out[3] = (m8 - m2) / s;
    out[0] = (m1 + m4) / s;
    out[1] = 0.25 * s;
    out[2] = (m6 + m9) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m10 - m0 - m5);
    out[3] = (m4 - m1) / s;
    out[0] = (m2 + m8) / s;
    out[1] = (m6 + m9) / s;
    out[2] = 0.25 * s;
  }
  return out;
}
function quatToMat3([qx, qy, qz, qw]) {
  const xx=qx*qx,yy=qy*qy,zz=qz*qz,xy=qx*qy,xz=qx*qz,yz=qy*qz,wx=qw*qx,wy=qw*qy,wz=qw*qz;
  return [1-2*(yy+zz),2*(xy-wz),2*(xz+wy),2*(xy+wz),1-2*(xx+zz),2*(yz-wx),2*(xz-wy),2*(yz+wx),1-2*(xx+yy)];
}
function rotVec3(m,x,y,z){return[m[0]*x+m[1]*y+m[2]*z,m[3]*x+m[4]*y+m[5]*z,m[6]*x+m[7]*y+m[8]*z];}
function quatMul([ax,ay,az,aw],[bx,by,bz,bw]){
  return[aw*bx+ax*bw+ay*bz-az*by,aw*by-ax*bz+ay*bw+az*bx,aw*bz+ax*by-ay*bx+az*bw,aw*bw-ax*bx-ay*by-az*bz];
}

function rotateAccessor(accessor, mat) {
  if (!accessor) return;
  const arr = accessor.getArray();
  if (!arr) return;
  for (let i = 0; i < arr.length; i += 3) {
    const [rx,ry,rz] = rotVec3(mat, arr[i], arr[i+1], arr[i+2]);
    arr[i]=rx; arr[i+1]=ry; arr[i+2]=rz;
  }
  accessor.setArray(arr);
}
function rotateTangentAccessor(accessor, mat) {
  if (!accessor) return;
  const arr = accessor.getArray();
  if (!arr) return;
  for (let i = 0; i < arr.length; i += 4) {
    const [rx,ry,rz] = rotVec3(mat, arr[i], arr[i+1], arr[i+2]);
    arr[i]=rx; arr[i+1]=ry; arr[i+2]=rz;
  }
  accessor.setArray(arr);
}
function transformMeshData(mesh, q) {
  const mat = quatToMat3(q);
  for (const prim of mesh.listPrimitives()) {
    rotateAccessor(prim.getAttribute('POSITION'), mat);
    rotateAccessor(prim.getAttribute('NORMAL'), mat);
    rotateTangentAccessor(prim.getAttribute('TANGENT'), mat);
    for (const target of prim.listTargets()) {
      rotateAccessor(target.getAttribute('POSITION'), mat);
      rotateAccessor(target.getAttribute('NORMAL'), mat);
      rotateTangentAccessor(target.getAttribute('TANGENT'), mat);
    }
  }
}
function bakeLeafMesh(node) {
  const q = node.getRotation();
  if (isIdentityQuat(q)) return;
  const mesh = node.getMesh();
  if (!mesh) { node.setRotation([0,0,0,1]); return; }
  const parents = mesh.listParents().filter(p => p.propertyType === 'Node');
  if (parents.length > 1) {
    const clone = mesh.clone();
    node.setMesh(clone);
    transformMeshData(clone, q);
  } else {
    transformMeshData(mesh, q);
  }
  node.setRotation([0,0,0,1]);
}
function pushRotationDown(parentNode, parentQ, parentMat) {
  for (const child of parentNode.listChildren()) {
    const ct = child.getTranslation();
    child.setTranslation(rotVec3(parentMat, ct[0], ct[1], ct[2]));
    const cq = child.getRotation();
    const newQ = quatMul(parentQ, cq);
    child.setRotation(newQ);
    if (child.listChildren().length > 0) {
      if (!isIdentityQuat(newQ)) {
        const newMat = quatToMat3(newQ);
        pushRotationDown(child, newQ, newMat);
        child.setRotation([0,0,0,1]);
      }
    } else {
      bakeLeafMesh(child);
    }
  }
}
/** Einzelnen Node prüfen und ggf. Rotation einbrennen (alle Ebenen, nicht nur Scene-Kinder). */
function bakeNodeRotation(node) {
  let q = node.getRotation();
  const mat = typeof node.getMatrix === 'function' ? node.getMatrix() : null;
  const matrixNotIdentity = mat && !isIdentityMatrix4(mat);
  if (isIdentityQuat(q) && !matrixNotIdentity) return false;
  if (isIdentityQuat(q) && matrixNotIdentity) q = mat4ToQuat(mat);

  const s = node.getScale();
  if (Math.abs(s[0] - 1) > EPSILON || Math.abs(s[1] - 1) > EPSILON || Math.abs(s[2] - 1) > EPSILON) {
    return false;
  }

  const mat3 = quatToMat3(q);
  const ownMesh = node.getMesh();
  if (ownMesh) transformMeshData(ownMesh, q);
  pushRotationDown(node, q, mat3);
  node.setRotation([0, 0, 0, 1]);
  node.setTranslation([0, 0, 0]);
  return true;
}

function bakeRootRotation(doc) {
  let baked = false;
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      if (bakeNodeRotation(node)) baked = true;
    });
  }
  return baked;
}

/**
 * Brennt Root-Node-Transforms in die Vertex-Daten ein.
 * @param {string} inputPath  – Pfad zur GLB-Datei
 * @param {string} [outputPath] – Zielpfad (default: inputPath überschreiben)
 * @returns {{ outputPath: string, baked: boolean, logs: object[] }}
 */
export async function bakeYUpGlb(inputPath, outputPath) {
  const target = outputPath || inputPath;
  const logs = [];
  const ts = () => new Date().toISOString();
  try {
    const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
    try {
      const draco = await import('draco3dgltf');
      io.registerDependencies({
        'draco3d.decoder': await draco.default.createDecoderModule(),
        'draco3d.encoder': await draco.default.createEncoderModule(),
      });
    } catch { /* Draco nicht verfügbar – OK für nicht-Draco-Dateien */ }
    const doc = await io.read(inputPath);
    const baked = bakeRootRotation(doc);
    if (baked) {
      await io.write(target, doc);
      const [sizeBefore, sizeAfter] = await Promise.all([
        fs.stat(inputPath).then(s=>s.size).catch(()=>0),
        fs.stat(target).then(s=>s.size).catch(()=>0),
      ]);
      const pct = sizeBefore ? (((sizeAfter-sizeBefore)/sizeBefore)*100).toFixed(1) : '?';
      logs.push({ timestamp:ts(), level:'INFO', message:`Y-up Einbrennen: ${path.basename(target)} (${(sizeBefore/1024).toFixed(0)} KB → ${(sizeAfter/1024).toFixed(0)} KB, ${pct}%)` });
      if (parseFloat(pct) > 20) {
        logs.push({ timestamp:ts(), level:'WARN', message:`Y-up Einbrennen: Datei ${pct}% größer als vorher – Draco-Komprimierung empfohlen.` });
      }
    } else {
      logs.push({ timestamp:ts(), level:'INFO', message:`Y-up Einbrennen: kein Root-Transform gefunden in ${path.basename(inputPath)} – keine Änderung.` });
    }
    return { outputPath: target, baked, logs };
  } catch (err) {
    logs.push({ timestamp:ts(), level:'WARN', message:`Y-up Einbrennen fehlgeschlagen für ${path.basename(inputPath)}: ${err.message} – Originaldatei bleibt.` });
    return { outputPath: inputPath, baked: false, logs };
  }
}
