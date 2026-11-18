import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('OutputsGuard');
const isDarwin = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isICloudPlaceholderError = (error) => {
  if (!error) return false;
  if (error.errno === -70) return true;
  if (typeof error.code === 'string' && error.code.includes('Unknown system error -70')) {
    return true;
  }
  return false;
};

const tryReadSingleByte = async (filePath) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      const error = new Error('No data read from file');
      error.code = 'EMPTY_READ';
      throw error;
    }
  } finally {
    await handle.close();
  }
};

const triggerICloudDownload = async (filePath) => {
  if (!isDarwin) {
    return false;
  }
  try {
    await execFileAsync('brctl', ['download', filePath]);
    logger.info(`Requested iCloud download for ${filePath}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to request iCloud download for ${filePath}: ${error.message}`);
    return false;
  }
};

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;

const getOneDriveRoots = () => {
  if (!isWindows) {
    return [];
  }
  const candidates = [
    'OneDriveCommercial',
    'OneDriveConsumer',
    'OneDrive',
    'ONEDRIVE',
  ];
  return candidates
    .map((key) => process.env[key])
    .filter(Boolean)
    .map((dir) => path.resolve(dir).toLowerCase());
};

const oneDriveRoots = getOneDriveRoots();

const isOneDrivePath = (filePath) => {
  if (!isWindows) {
    return false;
  }
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('onedrive')) {
    return true;
  }
  return oneDriveRoots.some((root) => lowerPath.startsWith(root));
};

const triggerOneDriveDownload = async (filePath) => {
  if (!isOneDrivePath(filePath)) {
    return false;
  }

  const quotedPath = psQuote(filePath);
  const psCommand = `
$ErrorActionPreference = 'SilentlyContinue';
$path = ${quotedPath};
if (Test-Path -LiteralPath $path) {
  try {
    $item = Get-Item -LiteralPath $path;
    if ($item.Attributes -band [System.IO.FileAttributes]::Offline) {
      attrib -P -U $path | Out-Null;
    }
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite);
    try {
      $buffer = New-Object byte[] 1;
      $stream.Read($buffer, 0, 1) | Out-Null;
    } finally {
      $stream.Close();
    }
  } catch {}
}
`.trim();

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCommand], {
      windowsHide: true,
    });
    logger.info(`Requested OneDrive download for ${filePath}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to request OneDrive download for ${filePath}: ${error.message}`);
    return false;
  }
};

const requestRemoteDownload = async (filePath, error) => {
  if (isICloudPlaceholderError(error)) {
    return { handled: await triggerICloudDownload(filePath), provider: 'icloud' };
  }
  if (isOneDrivePath(filePath)) {
    return { handled: await triggerOneDriveDownload(filePath), provider: 'onedrive' };
  }
  return { handled: false, provider: null };
};

const ensureFileIsLocal = async (filePath) => {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    return;
  }

  if (stat.size === 0) {
    // Empty file, nothing to download
    return;
  }

  let provider = null;

  try {
    await tryReadSingleByte(filePath);
    return;
  } catch (error) {
    const { handled, provider: detectedProvider } = await requestRemoteDownload(filePath, error);
    if (!handled) {
      throw error;
    }
    provider = provider || detectedProvider;
  }

  const maxAttempts = 60; // ~30s with 500ms delay
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(500);
    try {
      await tryReadSingleByte(filePath);
      return;
    } catch (error) {
      const { handled, provider: detectedProvider } = await requestRemoteDownload(filePath, error);
      if (!handled) {
        throw error;
      }
      provider = provider || detectedProvider;
    }
  }

  const timeoutError = new Error('Timed out waiting for remote storage to make the file available locally');
  if (provider === 'onedrive') {
    timeoutError.code = 'ONEDRIVE_TIMEOUT';
  } else {
    timeoutError.code = 'ICLOUD_TIMEOUT';
  }
  throw timeoutError;
};

export const createEnsureLocalOutputsMiddleware = (outputsDir) => {
  const outputsRoot = path.resolve(outputsDir);

  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const decodedPath = decodeURIComponent(req.path || '');
    if (decodedPath.includes('\0')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const trimmedPath = decodedPath.replace(/^[/\\]+/, '');
    const normalizedPath = path.normalize(trimmedPath);
    if (!normalizedPath || normalizedPath === '.' || normalizedPath.startsWith('..')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const absolutePath = path.join(outputsRoot, normalizedPath);
    const insideOutputs = absolutePath === outputsRoot
      || absolutePath.startsWith(`${outputsRoot}${path.sep}`);
    if (!insideOutputs) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    try {
      await ensureFileIsLocal(absolutePath);
      return next();
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      if (error.code === 'ICLOUD_TIMEOUT') {
        logger.warn(`Timeout waiting for iCloud file: ${absolutePath}`);
        return res.status(503).json({ error: 'File is not available locally yet. Please try again in a moment.' });
      }
      if (error.code === 'ONEDRIVE_TIMEOUT') {
        logger.warn(`Timeout waiting for OneDrive file: ${absolutePath}`);
        return res.status(503).json({ error: 'File is still being downloaded from OneDrive. Please retry shortly.' });
      }
      if (error.code === 'EMPTY_READ') {
        logger.warn(`Empty read for file: ${absolutePath}`);
        return res.status(500).json({ error: 'Failed to read file contents.' });
      }
      if (isICloudPlaceholderError(error)) {
        logger.warn(`File placeholder still present for ${absolutePath}: ${error.message}`);
        return res.status(503).json({ error: 'File is being retrieved from iCloud. Please retry shortly.' });
      }
      if (isOneDrivePath(absolutePath)) {
        logger.warn(`OneDrive placeholder still present for ${absolutePath}: ${error.message}`);
        return res.status(503).json({ error: 'File is being retrieved from OneDrive. Please retry shortly.' });
      }

      logger.error(`Unexpected error while preparing ${absolutePath}: ${error.message}`);
      return next(error);
    }
  };
};
