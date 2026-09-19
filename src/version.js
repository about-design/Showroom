const APP_VERSION_INFO = {
  version: 'MARA09.19.h',
  history: [
    { version: 'MARA09.19.h', description: 'Lange Hilfetexte im Produktdetail sind gemeinsam einklappbar; Namens-Farbregeln, Vertex-Reduktion und Sichtbarkeit zeigen zunächst eine Kurzzeile.' },
    { version: 'MARA09.19.g', description: 'Mesh-Kontextmenü kann RAL direkt auswählen und speichert eine Mesh-Namens-Farbregel mit passender Oberfläche; vorhandene exakte Regeln werden aktualisiert.' },
    { version: 'MARA09.19.f', description: 'Neue Produkt-Namens-Farbregeln starten mit Ziel Mesh; eine aktiv geänderte RAL-Auswahl setzt die Oberfläche auf Pulver, bei RAL 9007 auf Verzinkt.' },
    { version: 'MARA09.19.e', description: 'Automatische Dashboard-Queue startet erst nach dem Karten-Refresh; laufende Slots verwenden die bestehende Produktkarten-Liveanzeige mit Laufzeit.' },
    { version: 'MARA09.19.d', description: 'Dashboard-Drop reicht neu angelegte STEP-Produkte bei aktivierter Automatik an die gemeinsame Konvertierungsqueue weiter; manuelle Starts verwenden denselben Scheduler.' },
    { version: 'MARA09.19.c', description: 'Automatische STEP-Konvertierung wartet beim Drag & Drop auf die zentral gespeicherten Einstellungen, bevor die gemeinsame Warteschlange startet.' },
    { version: 'MARA09.19.b', description: 'Zentrale Einstellungen steuern automatische STEP-Konvertierungen nach Drag & Drop sowie 1–5 parallele Queue-Slots; Werte bleiben dauerhaft gespeichert.' },
    { version: 'MARA09.19.a', description: 'Drag-&-Drop-Konvertierungen mit einstellbarer paralleler Warteschlange (1–5, Standard 3). Nach Abschluss oder Fehler eines Jobs startet automatisch die nächste wartende Datei.' },
    { version: 'MARA09.18.h', description: 'FreeCommander verwendet für GLB-Dateien seine bestehende Single-Instance-Weiterleitung statt ein neues Fenster zu erzwingen.' },
    { version: 'MARA09.18.g', description: 'Produktkarten markieren die gespeicherte GLB-Datei im gewählten Windows-Dateimanager; Explorer und FreeCommander sind konfigurierbar.' },
    { version: 'MARA09.18.f', description: 'Große STEP-Dateien mit gemeinsamem Zeitbudget, robuster Prozessausgabe und Laufzeit-/Tessellierungsdiagnose konvertiert.' },
    { version: 'MARA09.18.e', description: 'Kurztext (SAP) im Produktdetail unter der Überschrift und in den Stammdaten angezeigt.' },
    { version: 'MARA09.18.d', description: 'Produktsuche um Kurztext (SAP) erweitert.' },
    { version: 'MARA09.18.c', description: 'SAP-Kurztexte aus Excel über EAN mit Artikelnummer-Fallback übernommen; Bestand aktualisiert und automatische Übernahme nach Konvertierung ergänzt.' },
    { version: 'MARA09.18.b', description: 'Eigenständigen Kurztext (SAP) auf Produktkarten vorbereitet und angezeigt.' },
    { version: 'MARA09.18.a', description: 'Farbregel-Status mit zugeordneten und gesamten Einzelteilen auf Produktkarten ergänzt.' },
    { version: 'MARA09.17.d', description: 'Mesh-Liste zeigt vollständige Namen; STEP-Produktstruktur bestimmt die Zeichnungsnummer je Bauteil.' },
    { version: 'MARA09.17.c', description: 'Mesh-Liste zeigt Zeichnungsnummer und Gruppennummer ohne EAN- und Artikelnummer-Präfix.' },
    { version: 'MARA09.17.b', description: 'STEP-Meshes werden je Zeichnungsnummer in Bauteilreihenfolge ab eins nummeriert.' },
    { version: 'MARA09.17.a', description: 'Archivierung überschreibt vorhandene Zielartefakte nach bestätigter Vorschau.' },
    { version: 'MARA09.16.ad', description: 'Detail-Footer weiter verdichtet, damit alle Aktionen bei normaler Breite in einer Zeile bleiben.' },
    { version: 'MARA09.16.ac', description: 'Detail-Footer mit kompakter rechter Aktionsgruppe und vollständig sichtbarem Übernehmen-Button ausgerichtet.' },
    { version: 'MARA09.16.ab', description: 'Produktentfernen-Aktion in der Detailleiste klar beschriftet und horizontal ausgerichtet.' },
    { version: 'MARA09.16.aa', description: 'Archivdialog mit kompakten Spalten, gekürzten Pfaden und vollständigen Tooltips verbessert.' },
    { version: 'MARA09.16.z', description: 'Archivierung beim Produktentfernen umfasst auch eindeutig zugeordnete CAD- und Originaldateien.' },
    { version: 'MARA09.16.y', description: 'Produktentfernung archiviert zugehörige GLB-, USDZ- und Vorschaudateien nach bestätigter Vorschau.' },
    { version: 'MARA09.16.x', description: 'Neu-Konvertierung eines Produkts kann direkt aus der Produktdetailansicht gestartet werden.' },
    { version: 'MARA09.16.w', description: 'Mesh-Schublade wird beim Sprung zu einer Namens-Farbregel zuverlässig eingeklappt.' },
    { version: 'MARA09.16.v', description: 'Über Mesh-Kontextmenü kann direkt zu einer vorhandenen Namens-Farbregel gesprungen werden.' },
    { version: 'MARA09.16.u', description: 'Einzelteile-Schublade horizontal an den Stammdaten ausgerichtet.' },
    { version: 'MARA09.16.t', description: 'Mesh-Liste zeigt Auswahl und vorhandene Namens-Farbregeln farblich an; Schublade schließt nach Regelübernahme automatisch.' },
    { version: 'MARA09.16.s', description: 'Namens-Farbregel kann wahlweise den vollständigen oder einen markierten Teil des Mesh-Namens übernehmen.' },
    { version: 'MARA09.16.r', description: 'Einzelteile-Schublade in den fixierten Vorschaubereich aufgenommen.' },
    { version: 'MARA09.16.q', description: 'Fixierten Vorschaubereich erweitert und Abstände der Einzelteile-Schublade optimiert.' },
    { version: 'MARA09.16.p', description: '3D-Vorschau fixiert und Einzelteile-Bereich ein- und ausklappbar gestaltet.' },
    { version: 'MARA09.16.o', description: 'Übernahme von Einzelteilnamen in Namens-Farbregeln ohne ^- und $-Begrenzung.' },
    { version: 'MARA09.16.n', description: 'Einzelteile können per Rechtsklick direkt als Namens-Farbregel übernommen werden.' },
    { version: 'MARA09.16.m', description: 'Geöffnetes Produkt wird im Showroom automatisch in der Produktliste markiert.' },
    { version: 'MARA09.16.l', description: 'Sichtbarkeit der Buttons in der Kopfzeile der Produktverwaltung verbessert.' },
    { version: 'MARA09.16.k', description: 'Löschen-Button für die Suche in der Produktverwaltung ergänzt.' },
    { version: 'MARA09.16.j', description: 'Löschen-Button für die Produktsuche im Showroom ergänzt.' },
    { version: 'MARA09.16.i', description: 'Live-Konvertierungsanzeige in die jeweilige Produktkarte verschoben.' },
    { version: 'MARA09.16.h', description: 'Separaten Konvertierungsstatus für jedes Einzelteil ergänzt.' },
    { version: 'MARA09.16.g', description: 'Darstellung der Versions-Hover-History verbessert.' },
    { version: 'MARA09.16.f', description: 'Änderungshistorie über die Versionsanzeige hinzugefügt.' },
    { version: 'MARA09.16.e', description: 'Showroom-Produktliste um Hover-Vorschauen mit vorhandenen Produktbildern erweitert.' },
    { version: 'MARA09.16.d', description: 'Showroom-Produktliste um Live-Suche und verstellbare Breite erweitert.' },
    { version: 'MARA09.16.c', description: 'Kopfzeilen von Showroom und Produktverwaltung vereinheitlicht.' },
    { version: 'MARA09.16.b', description: 'Versionsanzeige und Showroom-Button in der Produktverwaltung korrigiert.' },
    { version: 'MARA09.16.a', description: 'Zentrale Versions- und Historie-Notierung eingeführt.' },
  ],
};

if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION_INFO.version;
  window.APP_HISTORY = APP_VERSION_INFO.history;
}

if (typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const history = window.APP_HISTORY || APP_VERSION_INFO.history;
    const badge = document.getElementById('appVersionBadge');
    const trigger = document.querySelector('.sr-topbar-version');
    if (!badge || !trigger) return;

    badge.textContent = window.APP_VERSION || APP_VERSION_INFO.version;
    trigger.classList.add('version-history-trigger');
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', 'Änderungshistorie öffnen');

    const makeEntries = (entries) => entries.map((entry) =>
      `<li><strong>${entry.version}</strong><span>${entry.description}</span></li>`,
    ).join('');

    const tooltip = document.createElement('div');
    tooltip.className = 'version-history-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.innerHTML = `<div class="version-history-heading">Letzte Änderungen</div><ul>${makeEntries(history.slice(0, 5))}</ul>`;
    trigger.append(tooltip);

    const modal = document.createElement('div');
    modal.className = 'version-history-modal';
    modal.hidden = true;
    modal.innerHTML = `<div class="version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="versionHistoryTitle">
      <div class="version-history-dialog-header">
        <h2 id="versionHistoryTitle">Änderungshistorie</h2>
        <button type="button" class="version-history-close" aria-label="Historie schließen">×</button>
      </div>
      <ul class="version-history-full-list">${makeEntries(history)}</ul>
      <button type="button" class="version-history-close-button">Schließen</button>
    </div>`;
    document.body.append(modal);

    const closeModal = () => { modal.hidden = true; };
    const openModal = () => { modal.hidden = false; modal.querySelector('.version-history-close').focus(); };
    trigger.addEventListener('click', openModal);
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModal();
      }
    });
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    modal.querySelector('.version-history-close').addEventListener('click', closeModal);
    modal.querySelector('.version-history-close-button').addEventListener('click', closeModal);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });

    const style = document.createElement('style');
    style.textContent = `
      .version-history-trigger { position: relative; display: inline-flex !important; cursor: pointer; }
      .version-history-tooltip { position: absolute; top: calc(100% + 12px); left: -12px; display: none; box-sizing: border-box; width: min(480px, calc(100vw - 24px)); padding: 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: #252830; box-shadow: 0 12px 32px rgba(0,0,0,.32); color: #f8fafc; z-index: 110; }
      .version-history-trigger:hover .version-history-tooltip, .version-history-trigger:focus .version-history-tooltip { display: block; }
      .version-history-heading { margin-bottom: 8px; color: #f8fafc; font-size: .76rem; font-weight: 700; }
      .version-history-tooltip ul, .version-history-full-list { margin: 0; padding: 0; list-style: none; }
      .version-history-tooltip li, .version-history-full-list li { display: grid; gap: 3px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,.1); font-size: .72rem; line-height: 1.35; }
      .version-history-tooltip li:first-child, .version-history-full-list li:first-child { border-top: 0; padding-top: 0; }
      .version-history-tooltip strong, .version-history-full-list strong { color: #f8fafc; }
      .version-history-tooltip span, .version-history-full-list span { color: rgba(248,250,252,.74); overflow-wrap: anywhere; white-space: normal; }
      .version-history-modal[hidden] { display: none; }
      .version-history-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.55); }
      .version-history-dialog { width: min(560px, 100%); max-height: min(680px, calc(100vh - 40px)); overflow: auto; padding: 20px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: #252830; box-shadow: 0 24px 64px rgba(0,0,0,.45); color: #f8fafc; }
      .version-history-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
      .version-history-dialog h2 { margin: 0; font-size: 1rem; }
      .version-history-close { border: 0; background: transparent; color: #f8fafc; font-size: 1.5rem; line-height: 1; cursor: pointer; }
      .version-history-close-button { margin-top: 16px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; background: rgba(255,255,255,.08); color: #f8fafc; font: inherit; font-size: .8rem; cursor: pointer; }
    `;
    document.head.append(style);
  });
}

export default APP_VERSION_INFO;
