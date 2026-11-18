import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const versionFile = path.join(rootDir, 'src', 'version.js');
const changelogFile = path.join(rootDir, 'CHANGELOG.md');

function parseVersion(version) {
  const match = /^MARA(\d{2})\.(\d{2})\.([a-z])$/i.exec(version);
  if (!match) {
    return null;
  }

  return {
    month: Number(match[1]),
    day: Number(match[2]),
    letter: match[3].toLowerCase(),
  };
}

function nextLetter(code) {
  return String.fromCharCode(code.charCodeAt(0) + 1);
}

function buildVersion(date = new Date(), currentVersion = 'MARA09.16.a') {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const parsed = parseVersion(currentVersion);

  if (!parsed || parsed.month !== Number(month) || parsed.day !== Number(day)) {
    return `MARA${month}.${day}.a`;
  }

  return `MARA${month}.${day}.${nextLetter(parsed.letter)}`;
}

async function updateVersionFiles() {
  const versionSource = await fs.readFile(versionFile, 'utf8');
  const currentMatch = /version:\s*'([^']+)'/.exec(versionSource);
  const currentVersion = currentMatch ? currentMatch[1] : 'MARA09.16.a';
  const nextVersion = buildVersion(new Date(), currentVersion);
  const historyEntry = `${nextVersion} – ${new Date().toISOString().slice(0, 10)} – Version aktualisiert.`;

  const updatedVersionSource = versionSource.replace(/version:\s*'[^']+'/u, `version: '${nextVersion}'`).replace(
    /history:\s*\[(.|\n)*?\]/u,
    `history: [\n    '${historyEntry}',\n  ]`,
  );

  const changelogSource = await fs.readFile(changelogFile, 'utf8');
  const changelogEntry = `\n## ${nextVersion} - ${new Date().toISOString().slice(0, 10)}\n\n- Version aktualisiert.`;
  const updatedChangelog = `${changelogEntry}\n${changelogSource}`;

  await fs.writeFile(versionFile, updatedVersionSource, 'utf8');
  await fs.writeFile(changelogFile, updatedChangelog, 'utf8');

  console.log(`Neue Version: ${nextVersion}`);
}

await updateVersionFiles();
