import pkg from 'bullmq';
const { Queue, Worker } = pkg;
import Redis from 'ioredis';
import axios from 'axios';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';
import { getClaudeService } from './claudeService.js';
import { getGTINService } from './gtinService.js';
import { bakeYUpGlb } from './bakeYUp.js';
import {
  OBJ_EXTENSIONS,
  MTL_EXTENSIONS,
  STEP_EXTENSIONS,
  TEXTURE_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  extractZipArchive
} from '../utils/uploadUtils.js';

const logger = createLogger('ConversionService');

const isTrueString = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveLocalBin = (name) => {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return path.join(process.cwd(), 'node_modules', '.bin', `${name}${ext}`);
};

const runCli = (command, args, { cwd, timeoutMs = 0 } = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const maxCapture = 64 * 1024;
    const append = (buffer, next) => {
      if (!buffer) return next;
      const text = buffer.toString('utf8');
      if (next.length >= maxCapture) return next;
      return (next + text).slice(0, maxCapture);
    };

    child.stdout.on('data', (d) => {
      stdout = append(d, stdout);
    });
    child.stderr.on('data', (d) => {
      stderr = append(d, stderr);
    });

    let timeoutHandle = null;
    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
      }, timeoutMs);
    }

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const msg = `Command failed (exit ${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`;
      reject(new Error(msg));
    });
  });
};

export class ConversionService {
  constructor() {
    // Redis connection for BullMQ
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100
    });

    // BullMQ queue for conversion jobs
    this.conversionQueue = new Queue('blender-conversion', {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });

    // Initialize worker
    this.initializeWorker();

    // MCP server configuration
    this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:8001';
    this.uploadRoot = path.resolve(path.join(process.cwd(), '..', 'uploads'));

    // Local material library (persisted JSON)
    const projectRoot = path.resolve(path.join(process.cwd(), '..'));
    this.materialLibraryPath = process.env.MATERIAL_LIBRARY_PATH
      ? path.resolve(process.env.MATERIAL_LIBRARY_PATH)
      : path.join(projectRoot, 'data', 'material-library.json');

    // Local mesh signature library (persisted JSON)
    this.meshSignaturesPath = process.env.MESH_SIGNATURES_PATH
      ? path.resolve(process.env.MESH_SIGNATURES_PATH)
      : path.join(projectRoot, 'data', 'mesh-signatures.json');
  }

  _uploadJobDir(jobId) {
    if (!jobId) return null;
    return path.join(this.uploadRoot, String(jobId));
  }

  async _markUploadInProgress(jobId) {
    try {
      const dir = this._uploadJobDir(jobId);
      if (!dir) return;
      await fs.mkdir(dir, { recursive: true });
      const lockPath = path.join(dir, '.in_progress');
      await fs.writeFile(lockPath, new Date().toISOString(), 'utf8');
    } catch (e) {
      logger.warn(`Failed to mark upload in progress for ${jobId}: ${e?.message || e}`);
    }
  }

  async _clearUploadInProgress(jobId) {
    try {
      const dir = this._uploadJobDir(jobId);
      if (!dir) return;
      const lockPath = path.join(dir, '.in_progress');
      await fs.unlink(lockPath);
    } catch {
      // ignore
    }
  }

  async _loadMeshSignatures() {
    try {
      const raw = await fs.readFile(this.meshSignaturesPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return { version: 1, updatedAt: null, signatures: {} };
      }
      const signatures = (parsed.signatures && typeof parsed.signatures === 'object') ? parsed.signatures : {};
      return {
        version: Number.isFinite(parsed.version) ? parsed.version : 1,
        updatedAt: parsed.updatedAt || null,
        signatures
      };
    } catch {
      return { version: 1, updatedAt: null, signatures: {} };
    }
  }

  async getMeshSignatures() {
    return await this._loadMeshSignatures();
  }

  async resolveTargetMeshSignature(options = {}) {
    if (options && typeof options.targetMeshSignature === 'object' && options.targetMeshSignature) {
      return options.targetMeshSignature;
    }
    const id = options?.targetMeshSignatureId;
    if (!id || typeof id !== 'string') {
      return null;
    }
    const store = await this._loadMeshSignatures();
    const signature = store?.signatures?.[id];
    return (signature && typeof signature === 'object') ? signature : null;
  }

  _isGlbOptimizationEnabled(options = {}) {
    if (isTrueString(process.env.DISABLE_GLTF_OPTIMIZATION)) return false;
    // Always on by default. Request options can enable it but cannot disable it.
    // To disable globally (e.g. for debugging), set DISABLE_GLTF_OPTIMIZATION=true.
    return true;
  }

  async _optimizeGlbArtifact(outputPath, { jobId, options } = {}) {
    // GLB-Optimierung deaktiviert: Blender exportiert bereits saubere GLBs mit Draco.
    // gltf-transform CLI und gltfpack wurden entfernt da sie EXT_meshopt_compression
    // einführen, was Blender-Inkompatibilität verursacht.
    return { outputPath, logs: [] };
  }

  _builtinSurfacePresets() {
    // Values are stored in a Blender-friendly way:
    // - kd in 0..1 RGB
    // - metallic/roughness in 0..1
    // Note: These are defaults and can be fine-tuned later.
    return [
      {
        name: 'Verzinkt metall',
        kd: [0.62, 0.64, 0.66],
        metallic: 1.0,
        roughness: 0.55,
        source: 'builtin'
      },
      {
        name: 'Verzinkt glänzend metall',
        kd: [0.64, 0.64, 0.64],
        metallic: 1.0,
        roughness: 0.25,
        source: 'builtin'
      },
      {
        name: 'Plastikkappe',
        kd: [0.67, 0.67, 0.67],
        metallic: 0.0,
        roughness: 0.90,
        source: 'builtin'
      },
      // Powder-coated presets (approx. RAL-inspired defaults)
      {
        name: 'lichtgrau Pulverbeschichtet',
        kd: [0.957, 0.957, 0.957],
        metallic: 0.0,
        roughness: 0.300,
        source: 'builtin'
      },
      {
        name: 'rotorange Pulverbeschichtet',
        kd: [0.882, 0.494, 0.000],
        metallic: 0.0,
        roughness: 0.60,
        source: 'builtin'
      },
      {
        name: 'tiefschwarz Pulverbeschichtet',
        kd: [0.03, 0.03, 0.03],
        metallic: 0.0,
        roughness: 0.55,
        source: 'builtin'
      },
      {
        name: 'anthrazit Pulverbeschichtet',
        kd: [0.22, 0.24, 0.26],
        metallic: 0.0,
        roughness: 0.50,
        source: 'builtin'
      },
      {
        name: 'enzianblau Pulverbeschichtet',
        kd: [0.07451, 0.54118, 1.0],
        metallic: 0.0,
        roughness: 0.50,
        source: 'builtin'
      }
    ];
  }

  _ensureBuiltinPresets(library) {
    const now = new Date().toISOString();
    const lib = (library && typeof library === 'object') ? library : { version: 1, updatedAt: now, materials: [] };
    const materials = Array.isArray(lib.materials) ? lib.materials : [];
    const byKey = new Map();
    for (const m of materials) {
      if (m?.name) byKey.set(String(m.name).toLowerCase(), m);
    }

    let changed = false;
    for (const preset of this._builtinSurfacePresets()) {
      const key = String(preset.name).toLowerCase();
      const existing = byKey.get(key);
      if (!existing) {
        materials.unshift({
          name: preset.name,
          kd: Array.isArray(preset.kd) ? preset.kd : null,
          mapKd: null,
          metallic: typeof preset.metallic === 'number' ? preset.metallic : null,
          roughness: typeof preset.roughness === 'number' ? preset.roughness : null,
          source: preset.source || 'builtin',
          firstSeenAt: now,
          lastSeenAt: now
        });
        changed = true;
      } else {
        // Only fill missing fields to avoid overwriting user edits.
        if (!existing.kd && Array.isArray(preset.kd)) {
          existing.kd = preset.kd;
          changed = true;
        }
        if (typeof existing.metallic !== 'number' && typeof preset.metallic === 'number') {
          existing.metallic = preset.metallic;
          changed = true;
        }
        if (typeof existing.roughness !== 'number' && typeof preset.roughness === 'number') {
          existing.roughness = preset.roughness;
          changed = true;
        }
      }
    }

    lib.materials = materials;
    return { library: lib, changed };
  }

  async _ensureMaterialLibraryDir() {
    const dir = path.dirname(this.materialLibraryPath);
    await fs.mkdir(dir, { recursive: true });
  }

  async _loadMaterialLibrary() {
    await this._ensureMaterialLibraryDir();
    try {
      const raw = await fs.readFile(this.materialLibraryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.materials)) {
        const seeded = this._ensureBuiltinPresets(parsed);
        if (seeded.changed) {
          await this._saveMaterialLibrary(seeded.library);
        }
        return seeded.library;
      }
    } catch {
      // ignore
    }
    const empty = {
      version: 1,
      updatedAt: new Date().toISOString(),
      materials: []
    };
    const seeded = this._ensureBuiltinPresets(empty);
    await this._saveMaterialLibrary(seeded.library);
    return seeded.library;
  }

  async _saveMaterialLibrary(library) {
    await this._ensureMaterialLibraryDir();
    const data = {
      ...(library || {}),
      version: 1,
      updatedAt: new Date().toISOString(),
      materials: Array.isArray(library?.materials) ? library.materials : []
    };
    await fs.writeFile(this.materialLibraryPath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }

  _parseMtlText(text = '') {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let current = null;

    const flush = () => {
      if (current && current.name) {
        out.push(current);
      }
      current = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      const key = parts[0];

      if (key === 'newmtl') {
        flush();
        const name = parts.slice(1).join(' ').trim();
        current = {
          name,
          kd: null,
          mapKd: null
        };
        continue;
      }

      if (!current) continue;

      if (key === 'Kd' && parts.length >= 4) {
        const r = Number.parseFloat(parts[1]);
        const g = Number.parseFloat(parts[2]);
        const b = Number.parseFloat(parts[3]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          current.kd = [r, g, b];
        }
      }

      if ((key === 'map_Kd' || key === 'mapKd') && parts.length >= 2) {
        current.mapKd = parts.slice(1).join(' ').trim();
      }
    }

    flush();
    return out;
  }

  async ingestMaterialLibraryFromMtlFiles(mtlFileEntries = []) {
    const mtlFiles = Array.isArray(mtlFileEntries) ? mtlFileEntries : [];
    if (mtlFiles.length === 0) {
      return { added: 0, updated: 0, total: (await this._loadMaterialLibrary()).materials.length };
    }

    const library = await this._loadMaterialLibrary();
    const materials = Array.isArray(library.materials) ? library.materials : [];
    const byKey = new Map();
    for (const m of materials) {
      if (m?.name) byKey.set(String(m.name).toLowerCase(), m);
    }

    let added = 0;
    let updated = 0;
    for (const f of mtlFiles) {
      const filePath = f?.path;
      if (!filePath) continue;
      let txt = '';
      try {
        txt = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const parsed = this._parseMtlText(txt);
      for (const p of parsed) {
        if (!p?.name) continue;
        const key = String(p.name).toLowerCase();
        const existing = byKey.get(key);
        const now = new Date().toISOString();
        if (!existing) {
          const entry = {
            name: p.name,
            kd: Array.isArray(p.kd) ? p.kd : null,
            mapKd: p.mapKd || null,
            source: f.originalname || path.basename(filePath),
            firstSeenAt: now,
            lastSeenAt: now
          };
          materials.push(entry);
          byKey.set(key, entry);
          added += 1;
        } else {
          let changed = false;
          if (!existing.kd && Array.isArray(p.kd)) {
            existing.kd = p.kd;
            changed = true;
          }
          if (!existing.mapKd && p.mapKd) {
            existing.mapKd = p.mapKd;
            changed = true;
          }
          existing.lastSeenAt = now;
          if (changed) updated += 1;
        }
      }
    }

    library.materials = materials;
    await this._saveMaterialLibrary(library);
    return { added, updated, total: materials.length };
  }

  async getMaterialLibrary({ limit = 500 } = {}) {
    const library = await this._loadMaterialLibrary();
    const materials = Array.isArray(library.materials) ? library.materials : [];
    const slice = materials.slice(0, Math.max(0, Math.min(Number(limit) || 500, 5000)));
    return {
      updatedAt: library.updatedAt,
      materials: slice
    };
  }

  async scanUploadFolder(jobId, { expandArchives = true } = {}) {
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('jobId is required');
    }

    if (jobId.includes('..') || jobId.includes('/') || jobId.includes('\\')) {
      throw new Error('Invalid jobId');
    }

    await fs.mkdir(this.uploadRoot, { recursive: true });
    const folderPath = path.join(this.uploadRoot, jobId);
    const resolvedFolderPath = path.resolve(folderPath);

    if (!this._isWithinUploadRoot(resolvedFolderPath)) {
      throw new Error('Folder is outside the uploads directory');
    }

    let exists = false;
    try {
      const stat = await fs.stat(resolvedFolderPath);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }

    if (!exists) {
      throw new Error(`Upload folder not found: ${jobId}`);
    }

    return await this._scanDirectory(resolvedFolderPath, { expandArchives: expandArchives === true });
  }

  async startConversionFromUpload(jobId, options = {}) {
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('jobId is required');
    }

    if (jobId.includes('..') || jobId.includes('/') || jobId.includes('\\')) {
      throw new Error('Invalid jobId');
    }

    const { filesByType, archiveExtractionInfo, stats } = await this.scanUploadFolder(jobId, { expandArchives: true });

    if (filesByType.obj.length === 0 && filesByType.step.length === 0) {
      throw new Error('Upload folder does not contain any OBJ or STEP files');
    }

    const organizedFiles = {
      obj: filesByType.obj,
      step: filesByType.step,
      mtl: filesByType.mtl,
      textures: filesByType.textures
    };

    const job = await this.startConversion({
      jobId,
      files: organizedFiles,
      options
    });

    if (archiveExtractionInfo.length > 0) {
      await this.redis.hset(
        `job:${jobId}`,
        'archiveInfo', JSON.stringify(archiveExtractionInfo)
      );
    }

    await this.redis.hset(
      `job:${jobId}`,
      'sourceFolder', jobId,
      'sourceStats', JSON.stringify(stats)
    );

    return {
      ...job,
      archiveExtractionInfo,
      stats
    };
  }

  async runPreflight({ jobId, files, options = {} }) {
    const objFiles = files?.obj || [];
    const stepFiles = files?.step || [];
    const mtlFiles = files?.mtl || [];
    const textures = (files?.textures || []).map(f => f.path);

    const convertibleCount = objFiles.length + stepFiles.length;
    if (convertibleCount === 0) {
      throw new Error('No valid input file (OBJ or STEP) provided');
    }

    const resolveBooleanFlag = (value, defaultValue = true) => {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
      }
      return value === true;
    };

    let rotateYUpRaw;
    if (options && Object.prototype.hasOwnProperty.call(options, 'rotateYUp')) {
      rotateYUpRaw = options.rotateYUp;
    } else if (options && Object.prototype.hasOwnProperty.call(options, 'rotate_y_up')) {
      rotateYUpRaw = options.rotate_y_up;
    }
    const rotateYUpFlag = resolveBooleanFlag(rotateYUpRaw, true);

    const findMatchingMtl = async (objFile) => {
      const result = {
        path: null,
        reference: null,
        source: 'none',
        candidates: []
      };

      if (!objFile) {
        if (mtlFiles[0]?.path) {
          result.path = mtlFiles[0].path;
          result.reference = mtlFiles[0].originalname || path.basename(mtlFiles[0].path);
          result.source = 'fallback-first';
        }
        return result;
      }

      if (mtlFiles.length === 0) {
        // We'll still try to resolve mtllib references directly next to the OBJ.
      }

      const referencedNames = [];
      try {
        const handle = await fs.open(objFile.path, 'r');
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > 0) {
            const header = buffer.slice(0, bytesRead).toString('utf8');
            const regex = /^mtllib\s+([^\r\n]+)/gim;
            let match;
            while ((match = regex.exec(header)) !== null) {
              const rawName = match[1].trim();
              if (rawName) {
                referencedNames.push(rawName);
              }
            }
          }
        } finally {
          await handle.close();
        }
      } catch (err) {
        logger.debug(`Failed to read mtllib reference for ${objFile.path}: ${err.message}`);
      }

      const normalizedReferences = referencedNames
        .map(name => path.basename(name).toLowerCase())
        .filter(Boolean);

      // Strongest signal: referenced file exists directly next to OBJ.
      for (const raw of referencedNames) {
        try {
          const candidatePath = path.resolve(path.dirname(objFile.path), raw);
          if (path.extname(candidatePath).toLowerCase() === '.mtl') {
            const st = await fs.stat(candidatePath);
            if (st.isFile()) {
              result.path = candidatePath;
              result.reference = path.basename(raw);
              result.source = 'mtllib-relative-path';
              return result;
            }
          }
        } catch {
          // ignore
        }
      }

      const candidates = [];
      for (const mtl of mtlFiles) {
        const mtlBase = path.basename(mtl.path).toLowerCase();
        if (normalizedReferences.includes(mtlBase)) {
          candidates.push(mtl);
        }
      }

      result.candidates = candidates.map(c => c.originalname || path.basename(c.path));

      if (candidates.length > 0) {
        result.path = candidates[0].path;
        result.reference = candidates[0].originalname || path.basename(candidates[0].path);
        result.source = 'mtllib-match';
        return result;
      }

      if (mtlFiles[0]?.path) {
        result.path = mtlFiles[0].path;
        result.reference = mtlFiles[0].originalname || path.basename(mtlFiles[0].path);
        result.source = 'fallback-first';
      }

      return result;
    };

    const objFileEntry = objFiles[0] || null;
    const stepFileEntry = objFileEntry ? null : (stepFiles[0] || null);
    const mtlInfo = objFileEntry ? await findMatchingMtl(objFileEntry) : { path: null, reference: null };

    const resolvedTargetMeshSignature = await this.resolveTargetMeshSignature(options);

    const inputData = {
      jobId,
      objFile: objFileEntry?.path || null,
      stepFile: stepFileEntry?.path || null,
      mtlFile: mtlInfo.path,
      mtlReference: mtlInfo.reference,
      textureFiles: textures,
      options: {
        embedTextures: options.embedTextures,
        useAI: options.useAI,
        useDraco: options.useDraco === true,
        outputFormat: options.outputFormat,
        scale: options.scale,
        decimateRatio: options.decimateRatio,
        autoLabelParts: options.autoLabelParts === true,
        useClaudeAI: options.useAI === true || options.useClaudeAI === true,
        useGTINNaming: options.useGTINNaming === true,
        gtin: options.gtin || null,
        articleNumber: options.articleNumber || null,
        rotateYUp: rotateYUpFlag,
        rotateAxis: options.rotateAxis || null,
        rotateDegrees: options.rotateDegrees || null,
        importUpAxis: options.importUpAxis || 'AUTO',
        stripCamerasLights: options.stripCamerasLights !== false,
        keepCamerasLights: options.keepCamerasLights === true,
        enablePreflight: options.enablePreflight !== false,
        colorSaturation: options.colorSaturation ?? 1.0,
        colorBrightness: options.colorBrightness ?? 1.0,
        roughnessMultiplier: options.roughnessMultiplier ?? 1.0,
        metallicMultiplier: options.metallicMultiplier ?? 1.0,
        // Ensure preflight applies the same user overrides as export.
        selectedColors: options.selectedColors ?? null,
        colorOverrides: options.colorOverrides ?? null,
        colorMaterials: options.colorMaterials ?? null,
        targetMeshSignature: resolvedTargetMeshSignature,
        targetMeshMatchThreshold: options.targetMeshMatchThreshold,
        targetMeshMaterial: options.targetMeshMaterial ?? null,
        tessellationQuality: options.tessellationQuality || 0.1,
        materialFinish: options.materialFinish || 'auto',
        overwriteExisting: true,
        preflightOnly: true
      }
    };

    logger.info(`Calling MCP preflight at ${this.mcpServerUrl}/mcp/call for upload ${jobId}`);
    const mcpResponse = await axios.post(`${this.mcpServerUrl}/mcp/call`, {
      method: 'blender-convert',
      params: inputData
    }, {
      timeout: 600000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (!mcpResponse.data.success) {
      throw new Error(`MCP server error: ${mcpResponse.data.error}`);
    }

    const result = mcpResponse.data.result || {};
    return {
      jobId,
      convertibleFiles: convertibleCount,
      preflight: result.preflight ?? null,
      logs: result.logs || [],
      preflightOnly: true
    };
  }

  _isWithinUploadRoot(targetPath) {
    const resolved = path.resolve(targetPath);
    return resolved.startsWith(this.uploadRoot);
  }

  _normalizeFileEntry(filePath) {
    return {
      path: filePath,
      originalname: path.basename(filePath)
    };
  }

  _getArchiveExtractionBase(archivePath) {
    const archiveDir = path.dirname(archivePath);
    const archiveName = path.basename(archivePath, path.extname(archivePath));
    return path.join(archiveDir, '__extracted', archiveName);
  }

  async _scanDirectory(rootDir, { expandArchives = false } = {}) {
    const filesByType = {
      obj: [],
      mtl: [],
      step: [],
      textures: []
    };
    const archiveEntries = [];
    const archiveExtractionInfo = [];
    const stats = {
      obj: 0,
      mtl: 0,
      step: 0,
      textures: 0,
      archives: 0,
      skipped: 0,
      totalBytes: 0
    };

    const stack = [rootDir];

    while (stack.length > 0) {
      const currentDir = stack.pop();

      if (!this._isWithinUploadRoot(currentDir)) {
        continue;
      }

      let entries = [];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (err) {
        logger.warn(`Failed to read directory ${currentDir}: ${err.message}`);
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);

        if (!this._isWithinUploadRoot(entryPath)) {
          continue;
        }

        if (entry.isSymbolicLink && entry.isSymbolicLink()) {
          logger.warn(`Skipping symbolic link in uploads directory: ${entryPath}`);
          continue;
        }

        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();

        if (ARCHIVE_EXTENSIONS.has(ext)) {
          stats.archives += 1;
          archiveEntries.push({ path: entryPath, originalname: entry.name });
          continue;
        }

        if (
          !OBJ_EXTENSIONS.has(ext) &&
          !MTL_EXTENSIONS.has(ext) &&
          !STEP_EXTENSIONS.has(ext) &&
          !TEXTURE_EXTENSIONS.has(ext)
        ) {
          stats.skipped += 1;
          continue;
        }

        const fileEntry = this._normalizeFileEntry(entryPath);

        try {
          const stat = await fs.stat(entryPath);
          stats.totalBytes += stat.size;
        } catch (statErr) {
          logger.debug(`Failed to stat ${entryPath}: ${statErr.message}`);
        }

        if (OBJ_EXTENSIONS.has(ext)) {
          filesByType.obj.push(fileEntry);
          stats.obj += 1;
        } else if (MTL_EXTENSIONS.has(ext)) {
          filesByType.mtl.push(fileEntry);
          stats.mtl += 1;
        } else if (STEP_EXTENSIONS.has(ext)) {
          filesByType.step.push(fileEntry);
          stats.step += 1;
        } else if (TEXTURE_EXTENSIONS.has(ext)) {
          filesByType.textures.push(fileEntry);
          stats.textures += 1;
        }
      }
    }

    if (expandArchives && archiveEntries.length > 0) {
      for (const archive of archiveEntries) {
        const extractionBase = this._getArchiveExtractionBase(archive.path);

        if (!this._isWithinUploadRoot(extractionBase)) {
          logger.warn(`Skipping archive extraction outside upload root: ${archive.path}`);
          continue;
        }

        let alreadyExtracted = false;
        try {
          const existing = await fs.readdir(extractionBase);
          alreadyExtracted = existing.length > 0;
        } catch {
          // Directory does not exist yet
        }

        if (!alreadyExtracted) {
          await fs.mkdir(extractionBase, { recursive: true });
          const { files, skipped } = await extractZipArchive({
            archivePath: archive.path,
            originalname: archive.originalname,
            baseDir: extractionBase,
            fieldname: 'archive',
            encoding: '7bit',
            removeArchive: false
          });

          logger.info(`Extracted ${files.length} file(s) from ${archive.originalname} for manual job (skipped ${skipped})`);

          archiveExtractionInfo.push({
            archive: archive.originalname,
            extracted: files.length,
            skipped,
            target: path.relative(this.uploadRoot, extractionBase) || '.'
          });

          for (const file of files) {
            const ext = path.extname(file.originalname).toLowerCase();
            const normalized = this._normalizeFileEntry(file.path);

            if (OBJ_EXTENSIONS.has(ext)) {
              filesByType.obj.push(normalized);
              stats.obj += 1;
            } else if (MTL_EXTENSIONS.has(ext)) {
              filesByType.mtl.push(normalized);
              stats.mtl += 1;
            } else if (STEP_EXTENSIONS.has(ext)) {
              filesByType.step.push(normalized);
              stats.step += 1;
            } else if (TEXTURE_EXTENSIONS.has(ext)) {
              filesByType.textures.push(normalized);
              stats.textures += 1;
            }

            if (typeof file.size === 'number') {
              stats.totalBytes += file.size;
            }
          }
        } else {
          logger.info(`Archive ${archive.originalname} already extracted at ${path.relative(this.uploadRoot, extractionBase) || '.'}`);
          archiveExtractionInfo.push({
            archive: archive.originalname,
            extracted: 0,
            skipped: 0,
            target: path.relative(this.uploadRoot, extractionBase) || '.',
            alreadyExtracted: true
          });
        }
      }
    } else if (!expandArchives && archiveEntries.length > 0) {
      for (const archive of archiveEntries) {
        archiveExtractionInfo.push({
          archive: archive.originalname,
          extracted: 0,
          skipped: 0,
          pending: true
        });
      }
    }

    stats.totalFiles = stats.obj + stats.mtl + stats.step + stats.textures;

    return {
      filesByType,
      archiveExtractionInfo,
      stats
    };
  }

  async listUploadDirectories() {
    try {
      await fs.mkdir(this.uploadRoot, { recursive: true });
      const entries = await fs.readdir(this.uploadRoot, { withFileTypes: true });
      const directories = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const folderPath = path.join(this.uploadRoot, entry.name);
        const relativePath = entry.name;

        const scanResult = await this._scanDirectory(folderPath, { expandArchives: false });
        let createdAt = null;
        let updatedAt = null;
        try {
          const dirStat = await fs.stat(folderPath);
          createdAt = dirStat.birthtime?.toISOString?.() || null;
          updatedAt = dirStat.mtime?.toISOString?.() || null;
        } catch (err) {
          logger.debug(`Failed to stat directory ${folderPath}: ${err.message}`);
        }

        directories.push({
          folder: relativePath,
          stats: {
            totalFiles: scanResult.stats.totalFiles,
            obj: scanResult.stats.obj,
            mtl: scanResult.stats.mtl,
            step: scanResult.stats.step,
            textures: scanResult.stats.textures,
            archives: scanResult.stats.archives,
            skipped: scanResult.stats.skipped,
            totalBytes: scanResult.stats.totalBytes
          },
          archives: scanResult.archiveExtractionInfo,
          createdAt,
          updatedAt
        });
      }

      directories.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

      return directories;
    } catch (error) {
      logger.error(`Failed to list upload directories: ${error.message}`);
      throw error;
    }
  }

  async startConversionFromExistingFolder(folderName, options = {}) {
    if (!folderName || typeof folderName !== 'string') {
      throw new Error('folderName is required');
    }

    if (folderName.includes('..') || folderName.includes('/') || folderName.includes('\\')) {
      throw new Error('Invalid folder name');
    }

    await fs.mkdir(this.uploadRoot, { recursive: true });
    const folderPath = path.join(this.uploadRoot, folderName);
    const resolvedFolderPath = path.resolve(folderPath);

    if (!this._isWithinUploadRoot(resolvedFolderPath)) {
      throw new Error('Folder is outside the uploads directory');
    }

    let exists = false;
    try {
      const stat = await fs.stat(resolvedFolderPath);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }

    if (!exists) {
      throw new Error(`Folder not found: ${folderName}`);
    }

    const { filesByType, archiveExtractionInfo, stats } = await this._scanDirectory(resolvedFolderPath, { expandArchives: true });

    if (filesByType.obj.length === 0 && filesByType.step.length === 0) {
      throw new Error('Folder does not contain any OBJ or STEP files');
    }

    const jobId = uuidv4();

    const organizedFiles = {
      obj: filesByType.obj,
      step: filesByType.step,
      mtl: filesByType.mtl,
      textures: filesByType.textures
    };

    logger.info(`Starting conversion from existing folder ${folderName} with jobId ${jobId}`);

    const job = await this.startConversion({
      jobId,
      files: organizedFiles,
      options
    });

    if (archiveExtractionInfo.length > 0) {
      await this.redis.hset(
        `job:${jobId}`,
        'archiveInfo', JSON.stringify(archiveExtractionInfo)
      );
    }

    await this.redis.hset(
      `job:${jobId}`,
      'sourceFolder', folderName,
      'sourceStats', JSON.stringify(stats)
    );

    return {
      ...job,
      archiveExtractionInfo,
      stats
    };
  }

  /**
   * Initialize BullMQ worker for processing conversion jobs
   */
  initializeWorker() {
    this.worker = new Worker('blender-conversion', async (job) => {
      return await this.processConversionJob(job);
    }, {
      connection: this.redis,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2
    });

    this.worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      logger.error(`Job ${job.id} failed:`, err);
    });

    this.worker.on('progress', (job, progress) => {
      logger.info(`Job ${job.id} progress: ${progress}%`);
    });
  }

  /**
   * Start a new conversion job
   * @param {Object} conversionData - Job data including jobId, files, and options
   * @returns {Object} Job information
   */
  async startConversion(conversionData) {
    try {
      logger.info(`Starting conversion job: ${conversionData.jobId}`);

      // Protect uploads for this job from the cleanup scheduler.
      await this._markUploadInProgress(conversionData.jobId);
      
      const job = await this.conversionQueue.add(
        'convert-to-glb',
        conversionData,
        {
          jobId: conversionData.jobId,
          delay: 0
        }
      );

      // Store initial job metadata
      await this.redis.hset(
        `job:${conversionData.jobId}`,
        'status', 'queued',
        'createdAt', new Date().toISOString(),
        'files', JSON.stringify(conversionData.files),
        'options', JSON.stringify(conversionData.options)
      );

      return {
        id: job.id,
        jobId: conversionData.jobId,
        status: 'queued'
      };
    } catch (error) {
      logger.error(`Failed to start conversion job: ${conversionData.jobId}`, error);
      throw error;
    }
  }

  /**
   * Process a conversion job by communicating with MCP server
   * @param {Object} job - BullMQ job object
   */
  async processConversionJob(job) {
    const { jobId, files, options } = job.data;

    try {
      logger.info(`Processing conversion job: ${jobId}`);
      logger.info(`Material finish option received: ${options?.materialFinish ?? 'none'}`);

      // Refresh the lock timestamp in case the job has been queued for a while.
      await this._markUploadInProgress(jobId);
      
      // Update status to processing
      await this.updateJobStatus(jobId, 'processing', { progress: 10 });

      const objFiles = files.obj || [];
      const stepFiles = files.step || [];
      const mtlFiles = files.mtl || [];
      const textures = (files.textures || []).map(f => f.path);

      const resolveBooleanFlag = (value, defaultValue = true) => {
        if (value === undefined || value === null) {
          return defaultValue;
        }
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        return value === true;
      };

      let rotateYUpRaw;
      if (options && Object.prototype.hasOwnProperty.call(options, 'rotateYUp')) {
        rotateYUpRaw = options.rotateYUp;
      } else if (options && Object.prototype.hasOwnProperty.call(options, 'rotate_y_up')) {
        rotateYUpRaw = options.rotate_y_up;
      }

      const rotateYUpFlag = resolveBooleanFlag(rotateYUpRaw, true);

      const resolvedTargetMeshSignature = await this.resolveTargetMeshSignature(options || {});

      const materialAnalyses = [];
      const appliedFinishes = [];
      const requestedFinishes = [];
      let skippedFiles = 0;

      // Collect preflight info (kept intentionally small)
      const preflightReports = [];
      let preflightSkippedForBatch = false;

      // Helper: read mtllib reference from OBJ to find the exact MTL file
        const findMatchingMtl = async (objFile) => {
        const result = {
          path: null,
          reference: null,
          source: 'none',
            candidates: []
        };

        if (!objFile || mtlFiles.length === 0) {
          if (mtlFiles[0]?.path) {
            result.path = mtlFiles[0].path;
            result.reference = mtlFiles[0].originalname || path.basename(mtlFiles[0].path);
            result.source = 'fallback-first';
          }
          return result;
        }

        const referencedNames = [];
        try {
          const handle = await fs.open(objFile.path, 'r');
          try {
            const buffer = Buffer.alloc(64 * 1024); // read first 64KB which should contain header
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > 0) {
              const header = buffer.slice(0, bytesRead).toString('utf8');
              const regex = /^mtllib\s+([^\r\n]+)/gim;
              let match;
              while ((match = regex.exec(header)) !== null) {
                const rawName = match[1].trim();
                if (!rawName) {
                  continue;
                }
                const cleanedName = rawName.split(/\s+/)[0];
                if (cleanedName) {
                  referencedNames.push(cleanedName);
                }
              }
            }
          } finally {
            await handle.close();
          }
        } catch (err) {
          logger.debug(`Failed to read mtllib from OBJ ${objFile.path}: ${err.message}`);
        }

        if (objFile.originalname) {
          const objBase = objFile.originalname.replace(/\.[^.]+$/, '');
          referencedNames.push(`${objBase}.mtl`);
          referencedNames.push(`${objBase}.MTL`);
        }

        const candidateEntries = referencedNames
          .map(name => ({
            original: name,
            normalized: path.basename(name).toLowerCase()
          }))
          .filter(entry => entry.normalized)
          .filter((entry, index, array) => array.findIndex(e => e.normalized === entry.normalized) === index);

        result.candidates = candidateEntries.map(entry => entry.original);

        for (const candidate of candidateEntries) {
          const match = mtlFiles.find(m => {
            const original = (m.originalname || '').toLowerCase();
            const base = path.basename(m.path || '').toLowerCase();
            return original === candidate.normalized || base === candidate.normalized;
          });
          if (match) {
            result.path = match.path;
            result.reference = candidate.original;
            result.source = 'mtllib';
            return result;
          }
        }

        try {
          const objBase = path.basename(objFile.path).replace(/\.[^.]+$/, '').toLowerCase();
          const exact = mtlFiles.find(m => {
            const originalBase = (m.originalname || '').replace(/\.[^.]+$/, '').toLowerCase();
            const storedBase = path.basename(m.path || '').replace(/\.[^.]+$/, '').toLowerCase();
            return originalBase === objBase || storedBase === objBase;
          });
          if (exact?.path) {
            result.path = exact.path;
            result.reference = exact.originalname || path.basename(exact.path);
            result.source = 'basename';
            return result;
          }
        } catch (err) {
          logger.debug(`Fallback MTL match failed for ${objFile.path}: ${err.message}`);
        }

        if (mtlFiles[0]?.path) {
          result.path = mtlFiles[0].path;
          result.reference = mtlFiles[0].originalname || path.basename(mtlFiles[0].path);
          result.source = 'fallback-first';
        }

        return result;
      };

      const outputs = [];
      const aggregatedLogs = [];
      let aggregatedAIMetrics = null;
      let aggregatedLabelMetrics = [];
      let stepColorFallbackFlag = false;
      const stepColorNotes = new Set();
      const stepColorScripts = new Set();

      const enforcePreflightLimit = (count) => count > 10;

      if (objFiles.length <= 1 && stepFiles.length <= 1) {
        // Single-file behavior (backward compatible)
        const objFileEntry = objFiles[0] || null;
        const objFile = objFileEntry?.path || null;
        const stepFile = stepFiles[0]?.path || null;
        const mtlInfo = objFileEntry ? await findMatchingMtl(objFileEntry) : { path: null, reference: null, source: 'none', candidates: [] };
        const { path: mtlFilePath, reference: mtlReference, source: mtlSource, candidates: mtlCandidates } = mtlInfo;
        if (objFileEntry) {
          logger.info(`MTL match for ${objFileEntry.originalname || objFileEntry.path}: path=${mtlFilePath || 'none'} | mtllibCandidates=${mtlCandidates.join(',') || 'none'} | matched=${mtlReference || 'none'} | source=${mtlSource}`);
          if (mtlFilePath) {
            aggregatedLogs.push({
              timestamp: new Date().toISOString(),
              level: 'INFO',
              message: `Applying MTL ${mtlReference || path.basename(mtlFilePath)} for ${objFileEntry.originalname || objFileEntry.path}`
            });
          } else {
            aggregatedLogs.push({
              timestamp: new Date().toISOString(),
              level: 'WARN',
              message: `No MTL matched for ${objFileEntry.originalname || objFileEntry.path}`
            });
          }
        }
        
        // Must have either OBJ or STEP file
        if (!objFile && !stepFile) {
          throw new Error('No valid input file (OBJ or STEP) provided');
        }
        
        if (objFileEntry) {
          logger.info(`MTL resolved for ${objFileEntry.originalname || objFileEntry.path}: ${mtlFilePath}`);
        }

        const inputData = {
            jobId,
            objFile,
            stepFile,
            mtlFile: mtlFilePath,
            mtlReference: mtlReference,
          textureFiles: textures,
          options: {
            embedTextures: options.embedTextures,
            useAI: options.useAI,
            useDraco: options.useDraco === true,
            outputFormat: options.outputFormat,
            scale: options.scale,
            decimateRatio: options.decimateRatio,
            autoLabelParts: options.autoLabelParts === true,
            useClaudeAI: options.useAI === true || options.useClaudeAI === true,
            useGTINNaming: options.useGTINNaming === true,
            gtin: options.gtin || null,
            articleNumber: options.articleNumber || null,
            rotateYUp: rotateYUpFlag,
            rotateAxis: options.rotateAxis || null,
            rotateDegrees: options.rotateDegrees || null,
            importUpAxis: options.importUpAxis || 'AUTO',
            stripCamerasLights: options.stripCamerasLights !== false,
            keepCamerasLights: options.keepCamerasLights === true,
            enablePreflight: options.enablePreflight !== false,
            colorSaturation: options.colorSaturation ?? 1.0,
            colorBrightness: options.colorBrightness ?? 1.0,
            roughnessMultiplier: options.roughnessMultiplier ?? 1.0,
            metallicMultiplier: options.metallicMultiplier ?? 1.0,
            targetMeshSignature: resolvedTargetMeshSignature,
            targetMeshMatchThreshold: options.targetMeshMatchThreshold,
            targetMeshMaterial: options.targetMeshMaterial ?? null,
            selectedColors: options.selectedColors ?? null,
            colorOverrides: options.colorOverrides ?? null,
            colorMaterials: options.colorMaterials ?? null,
            tessellationQuality: options.tessellationQuality || 0.1,
            materialFinish: options.materialFinish || 'auto',
            overwriteExisting: options.overwriteExisting !== false,
            preserveMtlColors: options.preserveMtlColors === true || options.preserveMtlColors === 'true',
            defaultColorOverride: options.defaultColorOverride === true || options.defaultColorOverride === 'true',
            defaultColorHex: options.defaultColorHex || null,
            exportUsdz: options.exportUsdz !== false
          }
        };

        await this.updateJobStatus(jobId, 'processing', { progress: 30 });
        logger.info(`Calling MCP server at ${this.mcpServerUrl}/mcp/call for job ${jobId}`);
        logger.info(`Forwarding options to MCP for job ${jobId}: scale=${inputData.options.scale}, decimateRatio=${inputData.options.decimateRatio}, outputFormat=${inputData.options.outputFormat}, autoLabelParts=${inputData.options.autoLabelParts}`);

        const mcpResponse = await axios.post(`${this.mcpServerUrl}/mcp/call`, {
          method: 'blender-convert',
          params: inputData
        }, {
          timeout: 600000,
          headers: { 'Content-Type': 'application/json' }
        });

        await this.updateJobStatus(jobId, 'processing', { progress: 80 });

        if (!mcpResponse.data.success) {
          throw new Error(`MCP server error: ${mcpResponse.data.error}`);
        }
        const result = mcpResponse.data.result;
        const originalOutputPath = result.outputPath;
        let outputPath = originalOutputPath;
        const logs = result.logs || [];
        aggregatedLogs.push(...logs);

        // Bake VOR Optimierung: Root-Rotation in Vertex-Daten einbrennen (echtes Y-up)
        if (options?.bakeYUp && path.extname(outputPath).toLowerCase() === '.glb') {
          logger.info(`Applying Y-up bake on original output for job ${jobId}: ${path.basename(outputPath)}`);
          const baked = await bakeYUpGlb(outputPath);
          if (baked.logs?.length) aggregatedLogs.push(...baked.logs);
        }

        const optimized = await this._optimizeGlbArtifact(outputPath, { jobId, options });
        outputPath = optimized.outputPath;
        if (optimized.logs?.length) {
          aggregatedLogs.push(...optimized.logs);
        }

        outputs.push(outputPath);
        if (result.skipped) {
          skippedFiles += 1;
          aggregatedLogs.push({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message: `Skipped conversion for existing artifact: ${outputPath}`
          });
        }
        if (objFileEntry) {
          aggregatedLogs.push({
            timestamp: new Date().toISOString(),
            level: mtlFilePath ? 'INFO' : 'WARN',
            message: mtlFilePath
              ? `MTL ${mtlReference || path.basename(mtlFilePath)} applied for ${objFileEntry.originalname || objFileEntry.path}`
              : `No MTL available for ${objFileEntry.originalname || objFileEntry.path}`
          });
        }
        
        // Extract AI metrics and label metrics from result
        if (result.aiMetrics) {
          aggregatedAIMetrics = result.aiMetrics;
        }
        if (result.labelMetrics) {
          // Store label metrics in metadata for single-file conversion
          aggregatedLabelMetrics = result.labelMetrics;
        }
        if (result.material_analysis) {
          materialAnalyses.push({ jobId, analysis: result.material_analysis });
        }
        if (result.applied_material_finish) {
          appliedFinishes.push({ jobId, finish: result.applied_material_finish });
        }
        if (result.requested_material_finish) {
          requestedFinishes.push({ jobId, finish: result.requested_material_finish });
        }

        if (result.preflight) {
          preflightReports.push({ jobId, preflight: result.preflight });
        }

        const stepConversionMeta = result.stepConversion || result.step_conversion || null;
        const stepFallbackSources = [
          result.stepColorFallback,
          stepConversionMeta?.step_color_fallback
        ];
        if (stepFallbackSources.some(flag => flag === true)) {
          stepColorFallbackFlag = true;
        }
        const noteSources = [result.stepColorNotes, stepConversionMeta?.step_color_notes];
        noteSources.forEach(source => {
          if (Array.isArray(source)) {
            source.forEach(note => {
              if (note) {
                stepColorNotes.add(note);
              }
            });
          }
        });
        const scriptSources = [result.stepConverterScript, stepConversionMeta?.step_script_used];
        scriptSources.forEach(script => {
          if (script) {
            stepColorScripts.add(script);
          }
        });

      } else {
        // Multi-file with chunking
        const combinedFiles = [
          ...objFiles.map(file => ({ kind: 'obj', file })),
          ...stepFiles.map(file => ({ kind: 'step', file }))
        ];
        const total = combinedFiles.length;
                const preflightForcedOff = enforcePreflightLimit(total);
                preflightSkippedForBatch = preflightForcedOff;
                if (preflightForcedOff) {
                  aggregatedLogs.push({
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    message: `Preflight deaktiviert: Batch enthält ${total} Dateien (>10)`
                  });
                }
        if (total === 0) {
          throw new Error('No convertible OBJ or STEP files provided');
        }
        const chunkSizeRaw = options.batchChunkSize;
        const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0 ? Math.min(Math.max(chunkSizeRaw, 1), 100) : (parseInt(process.env.BATCH_CHUNK_SIZE) || 20);
        const totalChunks = Math.ceil(total / chunkSize);

        for (let c = 0; c < totalChunks; c++) {
          const start = c * chunkSize;
          const end = Math.min(start + chunkSize, total);
          const chunk = combinedFiles.slice(start, end);
          logger.info(`Processing chunk ${c + 1}/${totalChunks} (items ${start + 1}..${end}) for job ${jobId} with chunkSize=${chunkSize}`);

          for (let i = 0; i < chunk.length; i++) {
            const globalIndex = start + i; // 0-based across all files
            const entry = chunk[i];
            const objEntry = entry.kind === 'obj' ? entry.file : null;
            const stepEntry = entry.kind === 'step' ? entry.file : null;
            const subJobId = `${jobId}-${globalIndex + 1}`;
            
            try {
                const mtlInfo = objEntry ? await findMatchingMtl(objEntry) : { path: null, reference: null, source: 'none', candidates: [] };
                const { path: mtlFilePath, reference: mtlReference, source: mtlSource, candidates: mtlCandidates } = mtlInfo;
                if (objEntry) {
                  logger.info(`MTL match for ${objEntry.originalname || objEntry.path}: path=${mtlFilePath || 'none'} | mtllibCandidates=${mtlCandidates.join(',') || 'none'} | matched=${mtlReference || 'none'} | source=${mtlSource}`);
                  logger.info(`Material finish option within batch: ${options?.materialFinish ?? 'none'}`);
                  if (mtlFilePath) {
                    aggregatedLogs.push({
                      timestamp: new Date().toISOString(),
                      level: 'INFO',
                      message: `Applying MTL ${mtlReference || path.basename(mtlFilePath)} for ${objEntry.originalname || objEntry.path}`
                    });
                  } else {
                    aggregatedLogs.push({
                      timestamp: new Date().toISOString(),
                      level: 'WARN',
                      message: `No MTL matched for ${objEntry.originalname || objEntry.path}`
                    });
                  }
                }
                const inputData = {
                jobId: subJobId,
                objFile: objEntry ? objEntry.path : null,
                stepFile: stepEntry ? stepEntry.path : null,
                  mtlFile: mtlFilePath,
                  mtlReference,
                textureFiles: textures,
                options: {
                  embedTextures: options.embedTextures,
                  useAI: options.useAI,
                  useDraco: options.useDraco === true,
                  outputFormat: options.outputFormat,
                  scale: options.scale,
                  decimateRatio: options.decimateRatio,
                  autoLabelParts: options.autoLabelParts === true,
                  useClaudeAI: options.useAI === true || options.useClaudeAI === true,
                  useGTINNaming: options.useGTINNaming === true,
                  gtin: options.gtin || null,
                  articleNumber: options.articleNumber || null,
                  rotateYUp: rotateYUpFlag,
                  rotateAxis: options.rotateAxis || null,
                  rotateDegrees: options.rotateDegrees || null,
                  importUpAxis: options.importUpAxis || 'AUTO',
                  stripCamerasLights: options.stripCamerasLights !== false,
                  keepCamerasLights: options.keepCamerasLights === true,
                  enablePreflight: preflightForcedOff ? false : (options.enablePreflight !== false),
                  colorSaturation: options.colorSaturation ?? 1.0,
                  colorBrightness: options.colorBrightness ?? 1.0,
                  roughnessMultiplier: options.roughnessMultiplier ?? 1.0,
                  metallicMultiplier: options.metallicMultiplier ?? 1.0,
                  targetMeshSignature: resolvedTargetMeshSignature,
                  targetMeshMatchThreshold: options.targetMeshMatchThreshold,
                  targetMeshMaterial: options.targetMeshMaterial ?? null,
                  selectedColors: options.selectedColors ?? null,
                  colorOverrides: options.colorOverrides ?? null,
                  colorMaterials: options.colorMaterials ?? null,
                  tessellationQuality: options.tessellationQuality || 0.1,
                  materialFinish: options.materialFinish || 'auto',
                  overwriteExisting: options.overwriteExisting !== false,
                  preserveMtlColors: options.preserveMtlColors === true || options.preserveMtlColors === 'true',
                  defaultColorOverride: options.defaultColorOverride === true || options.defaultColorOverride === 'true',
                  defaultColorHex: options.defaultColorHex || null,
                  exportUsdz: options.exportUsdz !== false
                }
              };
              if (!inputData.objFile && !inputData.stepFile) {
                throw new Error('Missing OBJ or STEP file path for batch entry');
              }
              const progress = Math.round(10 + (70 * (globalIndex / total)));
              await this.updateJobStatus(jobId, 'processing', { progress, current: globalIndex + 1, total, currentChunk: c + 1, totalChunks });
              logger.info(`MCP call ${globalIndex + 1}/${total} (chunk ${c + 1}/${totalChunks}) for batch job ${jobId} (subJobId=${subJobId})`);
              
              const mcpResponse = await axios.post(`${this.mcpServerUrl}/mcp/call`, {
                method: 'blender-convert',
                params: inputData
              }, {
                timeout: 600000,
                headers: { 'Content-Type': 'application/json' }
              });
              
              if (!mcpResponse.data.success) {
                throw new Error(`MCP server error: ${mcpResponse.data.error}`);
              }
              
              const originalOutputPath = mcpResponse.data.result.outputPath;
              let outputPath = originalOutputPath;
              const logs = mcpResponse.data.result.logs || [];
              const aiMetrics = mcpResponse.data.result.aiMetrics || null;
              const materialAnalysis = mcpResponse.data.result.material_analysis || null;
              const preflight = mcpResponse.data.result.preflight || null;
              const appliedFinish = mcpResponse.data.result.applied_material_finish || null;
              const requestedFinish = mcpResponse.data.result.requested_material_finish || null;

              aggregatedLogs.push(...logs);

              // Bake VOR Optimierung: Root-Rotation in Vertex-Daten einbrennen (echtes Y-up)
              if (options?.bakeYUp && path.extname(outputPath).toLowerCase() === '.glb') {
                logger.info(`Applying Y-up bake on original output for job ${subJobId}: ${path.basename(outputPath)}`);
                const baked = await bakeYUpGlb(outputPath);
                if (baked.logs?.length) aggregatedLogs.push(...baked.logs);
              }

              const optimized = await this._optimizeGlbArtifact(outputPath, { jobId: subJobId, options });
              outputPath = optimized.outputPath;
              if (optimized.logs?.length) {
                aggregatedLogs.push(...optimized.logs);
              }

              outputs.push(outputPath);
              if (mcpResponse.data.result.skipped) {
                skippedFiles += 1;
                aggregatedLogs.push({
                  timestamp: new Date().toISOString(),
                  level: 'INFO',
                  message: `Skipped conversion for existing artifact: ${outputPath}`
                });
              }
              if (objEntry) {
                aggregatedLogs.push({
                  timestamp: new Date().toISOString(),
                  level: mtlFilePath ? 'INFO' : 'WARN',
                  message: mtlFilePath
                    ? `MTL ${mtlReference || path.basename(mtlFilePath)} applied for ${objEntry.originalname || objEntry.path}`
                    : `No MTL available for ${objEntry.originalname || objEntry.path}`
                });
              }
              
              // Aggregate AI metrics from all files
              if (aiMetrics) {
                if (!aggregatedAIMetrics) {
                  aggregatedAIMetrics = {
                    totalMeshes: 0,
                    aiOverrides: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    apiCalls: 0,
                    totalCost: 0.0,
                    processingTime: 0,
                    confidenceDistribution: {
                      "0.0-0.5": 0,
                      "0.5-0.7": 0,
                      "0.7-0.85": 0,
                      "0.85-0.95": 0,
                      "0.95-1.0": 0
                    }
                  };
                }
                
                // Sum up metrics
                aggregatedAIMetrics.totalMeshes += aiMetrics.totalMeshes || 0;
                aggregatedAIMetrics.aiOverrides += aiMetrics.aiOverrides || 0;
                aggregatedAIMetrics.inputTokens += aiMetrics.inputTokens || 0;
                aggregatedAIMetrics.outputTokens += aiMetrics.outputTokens || 0;
                aggregatedAIMetrics.apiCalls += aiMetrics.apiCalls || 0;
                aggregatedAIMetrics.totalCost += aiMetrics.totalCost || 0;
                aggregatedAIMetrics.processingTime += aiMetrics.processingTime || 0;
                
                // Aggregate confidence distribution
                Object.keys(aggregatedAIMetrics.confidenceDistribution).forEach(key => {
                  aggregatedAIMetrics.confidenceDistribution[key] += aiMetrics.confidenceDistribution?.[key] || 0;
                });
              }

              if (materialAnalysis) {
                materialAnalyses.push({ jobId: subJobId, analysis: materialAnalysis });
              }
              if (appliedFinish) {
                appliedFinishes.push({ jobId: subJobId, finish: appliedFinish });
              }
              if (requestedFinish) {
                requestedFinishes.push({ jobId: subJobId, finish: requestedFinish });
              }

              if (preflight) {
                preflightReports.push({ jobId: subJobId, preflight });
              }

              const stepConversionMeta = mcpResponse.data.result.stepConversion || mcpResponse.data.result.step_conversion || null;
              const stepFallbackSources = [
                mcpResponse.data.result.stepColorFallback,
                stepConversionMeta?.step_color_fallback
              ];
              if (stepFallbackSources.some(flag => flag === true)) {
                stepColorFallbackFlag = true;
              }
              const noteSources = [mcpResponse.data.result.stepColorNotes, stepConversionMeta?.step_color_notes];
              noteSources.forEach(source => {
                if (Array.isArray(source)) {
                  source.forEach(note => {
                    if (note) {
                      stepColorNotes.add(note);
                    }
                  });
                }
              });
              const scriptSources = [mcpResponse.data.result.stepConverterScript, stepConversionMeta?.step_script_used];
              scriptSources.forEach(script => {
                if (script) {
                  stepColorScripts.add(script);
                }
              });
            } catch (fileError) {
              // Log individual file error but continue with next files
              const failedName = objEntry?.originalname || objEntry?.path || stepEntry?.originalname || stepEntry?.path || `item-${globalIndex + 1}`;
              const errorMsg = `File ${globalIndex + 1}/${total} (${failedName}) failed: ${fileError.message}`;
              logger.error(errorMsg);
              aggregatedLogs.push({
                timestamp: new Date().toISOString(),
                level: 'ERROR',
                message: errorMsg
              });
              
              // Store null for failed file to maintain index consistency
              outputs.push(null);
            }
          }
        }
      }

      await this.updateJobStatus(jobId, 'processing', { progress: 90 });

      // Filter out failed files (null entries) and create summary
      const successfulOutputs = outputs.filter(path => path !== null);
      const failedCount = outputs.length - successfulOutputs.length;
      const successCount = successfulOutputs.length;
      
      logger.info(`Batch conversion results: ${successCount} succeeded, ${failedCount} failed out of ${outputs.length} files`);

      // Store output information (keep first successful outputPath for backward compatibility)
      const primaryOutput = successfulOutputs[0] || null;
      
      // Prepare metadata with AI metrics if available
      const metadata = {
        totalFiles: outputs.length,
        successfulFiles: successCount,
        failedFiles: failedCount,
        skippedFiles
      };

      if (preflightSkippedForBatch) {
        metadata.preflightSkipped = true;
        metadata.preflightSkippedReason = 'batch_gt_10';
      }
      if (preflightReports.length > 0) {
        metadata.preflightReports = preflightReports;
      }
      // Preflight: store summary arrays if present
      if (typeof metadata.preflightForcedOff === 'boolean') {
        // placeholder (kept for future)
      }
      if (stepColorFallbackFlag) {
        metadata.stepColorFallback = true;
        if (stepColorNotes.size > 0) {
          metadata.stepColorNotes = Array.from(stepColorNotes);
        }
      }
      if (stepColorScripts.size > 0) {
        metadata.stepColorScripts = Array.from(stepColorScripts);
      }
      if (aggregatedAIMetrics) {
        metadata.aiMetrics = aggregatedAIMetrics;
        logger.info(`AI Metrics for job ${jobId}:`, JSON.stringify(aggregatedAIMetrics, null, 2));
      }
      if (aggregatedLabelMetrics && aggregatedLabelMetrics.length > 0) {
        metadata.labelMetrics = aggregatedLabelMetrics;
        logger.info(`Label Metrics for job ${jobId}: ${aggregatedLabelMetrics.length} labeled meshes`);
      }
      if (materialAnalyses.length === 1) {
        metadata.materialAnalysis = materialAnalyses[0].analysis;
      } else if (materialAnalyses.length > 1) {
        metadata.materialAnalyses = materialAnalyses;
      }
      if (appliedFinishes.length === 1) {
        metadata.appliedMaterialFinish = appliedFinishes[0].finish;
      } else if (appliedFinishes.length > 1) {
        metadata.appliedMaterialFinishes = appliedFinishes;
      }
      if (requestedFinishes.length === 1) {
        metadata.requestedMaterialFinish = requestedFinishes[0].finish;
      } else if (requestedFinishes.length > 1) {
        metadata.requestedMaterialFinishes = requestedFinishes;
      }
      
      await this.redis.hset(
        `job:${jobId}`,
        'outputPath', primaryOutput || '',
        'outputPaths', JSON.stringify(successfulOutputs), // Only store successful outputs
        'logs', JSON.stringify(aggregatedLogs),
        'metadata', JSON.stringify(metadata),
        'completedAt', new Date().toISOString()
      );

      // Determine final job status
      let finalStatus;
      if (failedCount === 0) {
        finalStatus = 'completed'; // All files succeeded
      } else if (successCount === 0) {
        finalStatus = 'failed'; // All files failed
      } else {
        finalStatus = 'partially_completed'; // Mixed results
      }

      await this.updateJobStatus(jobId, finalStatus, { 
        progress: 100,
        outputPath: primaryOutput,
        outputPaths: successfulOutputs,
        logs: aggregatedLogs,
        metadata
      });

      logger.info(`Conversion job ${jobId} finished with status: ${finalStatus} (${successCount}/${outputs.length} files)`);
      return { success: successCount > 0, outputPath: primaryOutput, outputPaths: successfulOutputs, logs: aggregatedLogs, metadata };

    } catch (error) {
      logger.error(`Conversion job ${jobId} failed:`, error);
      
      await this.updateJobStatus(jobId, 'failed', {
        error: error.message,
        failedAt: new Date().toISOString()
      });
      
      throw error;
    } finally {
      // Allow cleanup to remove uploads after job completion/failure.
      await this._clearUploadInProgress(jobId);
    }
  }

  /**
   * Get job status and information
   * @param {string} jobId - Job identifier
   * @returns {Object|null} Job status information
   */
  async getJobStatus(jobId) {
    try {
      const jobData = await this.redis.hgetall(`job:${jobId}`);
      
      if (!jobData || !jobData.status) {
        return null;
      }

      // Parse JSON fields
      const files = jobData.files ? JSON.parse(jobData.files) : {};
      const options = jobData.options ? JSON.parse(jobData.options) : {};
      const logs = jobData.logs ? JSON.parse(jobData.logs) : [];
      const outputPaths = jobData.outputPaths ? JSON.parse(jobData.outputPaths) : (jobData.outputPath ? [jobData.outputPath] : []);
      const metadata = jobData.metadata ? JSON.parse(jobData.metadata) : {};

      return {
        status: jobData.status,
        progress: jobData.progress || 0,
        createdAt: jobData.createdAt,
        completedAt: jobData.completedAt,
        failedAt: jobData.failedAt,
        files,
        options,
        logs,
        error: jobData.error,
        outputPath: jobData.outputPath,
        outputPaths,
        metadata,
        current: jobData.current ? parseInt(jobData.current) : undefined,
        total: jobData.total ? parseInt(jobData.total) : undefined,
        currentChunk: jobData.currentChunk ? parseInt(jobData.currentChunk) : undefined,
        totalChunks: jobData.totalChunks ? parseInt(jobData.totalChunks) : undefined
      };
    } catch (error) {
      logger.error(`Failed to get job status for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get output file path for completed job
   * @param {string} jobId - Job identifier
   * @returns {string|null} Output file path or null if not ready
   */
  async getOutputFile(jobId) {
    try {
      const status = await this.getJobStatus(jobId);
      
      if (status?.status === 'completed' && status.outputPath) {
        return status.outputPath;
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to get output file for job ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Clean up job files and data
   * @param {string} jobId - Job identifier
   */
  async cleanupJob(jobId) {
    try {
      logger.info(`Cleaning up job: ${jobId}`);
      
      // Get job data to find file paths
      const jobStatus = await this.getJobStatus(jobId);
      
      if (jobStatus) {
        // Clean up upload directory
        const uploadDir = path.join(process.cwd(), '..', 'uploads', jobId);
        try {
          await fs.rm(uploadDir, { recursive: true, force: true });
        } catch (error) {
          logger.warn(`Failed to remove upload directory for job ${jobId}: ${uploadDir}`, { error: error.message });
        }

        const outputTargets = new Set();

        if (jobStatus.outputPath) {
          outputTargets.add(jobStatus.outputPath);
        }

        if (Array.isArray(jobStatus.outputPaths)) {
          jobStatus.outputPaths.filter(Boolean).forEach((p) => outputTargets.add(p));
        }

        for (const target of outputTargets) {
          const resolvedTarget = path.isAbsolute(target)
            ? target
            : path.resolve(process.cwd(), '..', target);

          try {
            await fs.unlink(resolvedTarget);
          } catch (error) {
            logger.warn(`Failed to remove output artifact for job ${jobId}: ${resolvedTarget}`, { error: error.message });
          }
        }
      }

      // Remove job data from Redis
      await this.redis.del(`job:${jobId}`);
      
      logger.info(`Job ${jobId} cleaned up successfully`);
    } catch (error) {
      logger.error(`Failed to cleanup job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Update job status in Redis
   * @param {string} jobId - Job identifier
   * @param {string} status - New status
   * @param {Object} additionalData - Additional data to store
   */
  async updateJobStatus(jobId, status, additionalData = {}) {
    const updateData = {
      status,
      updatedAt: new Date().toISOString()
    };

    // Handle additional data - stringify objects and arrays
    for (const [key, value] of Object.entries(additionalData)) {
      if (typeof value === 'object' && value !== null) {
        updateData[key] = JSON.stringify(value);
      } else {
        updateData[key] = value;
      }
    }

    await this.redis.hset(`job:${jobId}`, updateData);
  }

  /**
   * Close connections
   */
  async close() {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}