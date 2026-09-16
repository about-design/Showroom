import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';

export const OBJ_EXTENSIONS = new Set(['.obj']);
export const MTL_EXTENSIONS = new Set(['.mtl']);
export const STEP_EXTENSIONS = new Set(['.step', '.stp']);
export const TEXTURE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tga', '.bmp']);
export const DATA_EXTENSIONS = new Set(['.csv', '.xlsx']);

export const ALLOWED_EXTENSIONS = new Set([
  ...OBJ_EXTENSIONS,
  ...MTL_EXTENSIONS,
  ...STEP_EXTENSIONS,
  ...TEXTURE_EXTENSIONS,
  ...DATA_EXTENSIONS
]);

export const ARCHIVE_EXTENSIONS = new Set(['.zip']);
export const ACCEPTED_UPLOAD_EXTENSIONS = new Set([...ALLOWED_EXTENSIONS, ...ARCHIVE_EXTENSIONS]);

export const EXTENSION_MIME_MAP = {
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.step': 'application/step',
  '.stp': 'application/step',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tiff': 'image/tiff',
  '.tga': 'image/x-targa',
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const sanitizeSegment = (segment) => {
  const sanitized = segment.replace(/[^a-zA-Z0-9.-]/g, '_');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return '_';
  }
  return sanitized;
};

export const ensureInsideDir = (root, target) => {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const ensureUniqueFilePath = async (dir, fileName) => {
  let candidate = path.join(dir, fileName);
  const parsed = path.parse(fileName);
  let index = 1;
  while (await pathExists(candidate)) {
    const nextName = `${parsed.name}_${index}${parsed.ext}`;
    candidate = path.join(dir, nextName);
    index += 1;
  }
  return candidate;
};

export const extractZipArchive = async ({
  archivePath,
  originalname,
  baseDir,
  fieldname = 'archive',
  encoding = '7bit',
  removeArchive = false
}) => {
  const archive = new AdmZip(archivePath);
  const extractedFiles = [];
  let skippedEntries = 0;

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const rawSegments = entry.entryName
      .replace(/\\/g, '/')
      .split('/')
      .filter(segment => Boolean(segment) && segment !== '.' && segment !== '..');

    if (rawSegments.length === 0) {
      continue;
    }

    const rawFileName = rawSegments[rawSegments.length - 1];
    const extension = path.extname(rawFileName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      skippedEntries += 1;
      continue;
    }

    const sanitizedSegments = rawSegments.map(sanitizeSegment);
    const sanitizedFileName = sanitizedSegments.pop();
    const targetDir = path.join(baseDir, ...sanitizedSegments);

    if (!ensureInsideDir(baseDir, targetDir)) {
      skippedEntries += 1;
      continue;
    }

    await fs.mkdir(targetDir, { recursive: true });
    const outputPath = await ensureUniqueFilePath(targetDir, sanitizedFileName);
    const data = entry.getData();
    await fs.writeFile(outputPath, data);

    extractedFiles.push({
      fieldname,
      originalname: rawFileName,
      encoding,
      mimetype: EXTENSION_MIME_MAP[extension] || 'application/octet-stream',
      size: data.length,
      destination: targetDir,
      filename: path.basename(outputPath),
      path: outputPath
    });
  }

  if (removeArchive) {
    try {
      await fs.unlink(archivePath);
    } catch {
      // ignore failures when removing archive
    }
  }

  return {
    files: extractedFiles,
    skipped: skippedEntries
  };
};
