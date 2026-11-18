# Frontend-Dokumentation - Blender MCP Converter

## 📱 Web Interface Übersicht

Das Frontend ist eine moderne Vue.js 3 Single-Page-Application mit intuitivem Design für die 3D-Model-Konvertierung.

### Features

- **🎨 Modernes Design**: Glasmorphism-UI mit Tailwind CSS
- **📁 Drag & Drop Upload**: Intuitive Datei-Upload mit Visual Feedback
- **⏱️ Real-time Status**: Live Updates der Konvertierungs-Jobs
- **📊 Job Management**: Vollständige Übersicht aller Konvertierungen  
- **🔍 System Monitor**: Health-Check Dashboard aller Services
- **📱 Responsive**: Optimiert für Desktop und Mobile

## 🚀 Setup & Entwicklung

```bash
cd frontend

# Dependencies installieren
npm install

# Development Server starten
npm run dev
# → http://localhost:5173

# Production Build erstellen  
npm run build

# Build Preview
npm run preview
```

## 🏗️ Architektur

```
frontend/
├── src/
│   ├── components/          # Wiederverwendbare UI-Komponenten
│   │   ├── layout/         # Layout-Komponenten (Navbar, Footer)
│   │   └── ui/             # UI-Komponenten (Button, FileUpload)
│   ├── views/              # Haupt-Views/Seiten
│   │   ├── Home.vue        # Landing Page
│   │   ├── Convert.vue     # Konvertierungs-Interface
│   │   ├── Jobs.vue        # Job-Management Dashboard
│   │   └── About.vue       # System-Info & Status
│   ├── stores/             # Pinia State Management
│   │   ├── jobs.js         # Job-Verwaltung & API Calls
│   │   └── system.js       # System Health & Status
│   ├── router/             # Vue Router Setup
│   ├── utils/              # Helper & API Utils
│   └── assets/             # Statische Assets
├── public/                 # Public Assets
└── dist/                  # Build Output
```

## 🎯 Views/Seiten

### 1. Home.vue - Landing Page
- Hero Section mit System-Übersicht
- Features & Capabilities Showcase  
- Quick Start Guide
- Links zu anderen Views

### 2. Convert.vue - Konvertierungs-Interface
- **File Upload Zone**: Drag & Drop für OBJ/MTL/Texturen
- **Conversion Options**: Format (GLB/GLTF), AI-Materialien, Texturen einbetten
- **Real-time Progress**: Live Fortschritts-Updates während Konvertierung
- **Job Status**: Aktueller Status mit detailliertem Feedback
- **Download**: Direkter Download der GLB-Datei nach Completion

**Upload Flow:**
1. Dateien per Drag & Drop oder Klick hinzufügen
2. Optionen konfigurieren (Format, AI-Erkennung, etc.)
3. "Konvertierung starten" Button  
4. Real-time Progress Tracking
5. Download-Button bei Completion

### 3. Jobs.vue - Job-Management Dashboard
- **Job List**: Alle Konvertierungs-Jobs mit Status
- **Filter**: Nach Status filtern (queued, processing, completed, failed)
- **Job Details**: Dateien, Optionen, Timing, Logs
- **Actions**: Download, Job ID kopieren, Löschen
- **Auto-refresh**: Polling für aktive Jobs alle 5 Sekunden

**Job Status:**
- 🟡 **Queued**: Wartet auf Verarbeitung
- 🔵 **Processing**: Aktive Konvertierung mit Progress
- 🟢 **Completed**: Erfolgreich abgeschlossen
- 🔴 **Failed**: Fehler aufgetreten

### 4. About.vue - System-Information
- **System Architecture**: Übersicht der Komponenten
- **Feature List**: Alle verfügbaren Features  
- **Live Status**: Health-Check aller Services
- **Technical Details**: Unterstützte Formate, Requirements
- **Resources**: Links zur Dokumentation

## 🔧 State Management (Pinia)

### jobsStore (stores/jobs.js)
```javascript
// Job-Verwaltung
const jobStore = useJobStore()

// Jobs laden
await jobStore.fetchJobs()

// Neue Konvertierung starten
const jobId = await jobStore.convertFiles(files, options)

// Job Status abrufen
await jobStore.getJobStatus(jobId)

// Download
await jobStore.downloadJob(jobId)
```

**State:**
- `jobs[]` - Liste aller Jobs
- `activeJobs[]` - Jobs in Verarbeitung
- `isUploading` - Upload-Status
- `uploadProgress` - Upload-Fortschritt

### systemStore (stores/system.js)
```javascript
// System Health
const systemStore = useSystemStore()

// Health Check
await systemStore.checkHealth()

// Status abrufen
const status = systemStore.status
```

**State:**
- `status.api` - API Gateway Status
- `status.mcp` - MCP Server Status  
- `status.blender` - Blender Verfügbarkeit
- `status.healthy` - Gesamtsystem Status

## 🎨 UI Components

### FileUpload Component
```vue
<FileUpload 
  @files-selected="handleFiles"
  :accept="'.obj,.mtl,.jpg,.png,.bmp'"
  :multiple="true"
  :max-size="100"
/>
```

**Features:**
- Drag & Drop Zone mit Visual Feedback
- File Type Validation  
- Size Limits
- Progress Indicator
- Error Handling

### StatusBadge Component
```vue
<StatusBadge :status="job.status" />
```

**Status Colors:**
- Queued: Yellow (Warteschlange)
- Processing: Blue (Verarbeitung)  
- Completed: Green (Fertig)
- Failed: Red (Fehler)

### ProgressBar Component  
```vue
<ProgressBar 
  :value="progress" 
  :max="100"
  :animated="true" 
/>
```

## 🔄 API Integration

### API Utils (utils/api.js)
```javascript
// Konfigurierte Axios Instance
import api from '@/utils/api'

// POST Request mit File Upload
const response = await api.post('/convert', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  onUploadProgress: (event) => {
    // Progress Callback
  }
})
```

**Base URL:** 
- Development: `http://localhost:3000/api/v1`
- Production: `/api/v1`

### Error Handling
```javascript
try {
  await api.post('/convert', data)
} catch (error) {
  if (error.response?.status === 413) {
    toast.error('Datei zu groß')
  } else {
    toast.error(error.response?.data?.message || 'Unbekannter Fehler')
  }
}
```

## 🔔 Notifications (Toast)

```javascript
import { useToast } from 'vue-toastification'

const toast = useToast()

// Success
toast.success('Konvertierung erfolgreich!')

// Error  
toast.error('Upload fehlgeschlagen')

// Info
toast.info('Verarbeitung gestartet')

// Warning
toast.warning('Große Datei erkannt')
```

## 📱 Responsive Design

**Breakpoints (Tailwind):**
- `sm:` ≥ 640px (Mobile Landscape)
- `md:` ≥ 768px (Tablet)  
- `lg:` ≥ 1024px (Desktop)
- `xl:` ≥ 1280px (Large Desktop)

**Mobile Optimierungen:**
- Stacked Layout auf kleinen Bildschirmen
- Touch-optimierte Upload-Zone
- Responsives Grid System
- Mobile Navigation

## 🎯 Performance

### Optimierungen
- **Code Splitting**: Lazy-loaded Views
- **Image Optimization**: WebP Support
- **Bundle Splitting**: Vendor Chunks  
- **Caching**: Service Worker (optional)

### Build Optimierung
```javascript
// vite.config.js
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['vue', 'vue-router', 'pinia'],
          'ui': ['vue-toastification']
        }
      }
    }
  }
}
```

## 🧪 Testing

```bash
# Unit Tests
npm run test

# E2E Tests  
npm run test:e2e

# Coverage
npm run coverage
```

**Test Setup:**
- **Vitest**: Unit Testing Framework
- **Vue Test Utils**: Vue Component Testing
- **Cypress**: E2E Testing

## 🚀 Deployment

### Development
```bash
npm run dev
# → http://localhost:5173
```

### Production Build
```bash
npm run build
# → dist/ folder

# Serve static files via API Gateway
# Express.js serves dist/ in production mode
```

### Docker Deployment
```dockerfile
# Multi-stage build
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

## 🔧 Konfiguration

### Environment Variables
```bash
# .env
# Basis-URL ohne abschließenden Slash. Standard (wenn nicht gesetzt) entspricht http(s)://<host>:3000
VITE_API_BASE_URL=http://localhost:3000
# Optional: explizite Basis für bereitgestellte GLB-Dateien (standard: ${VITE_API_BASE_URL}/outputs )
VITE_OUTPUTS_BASE_URL=http://localhost:3000/outputs
VITE_APP_TITLE="Blender MCP Converter"
VITE_UPLOAD_MAX_SIZE=104857600  # 100MB
VITE_SUPPORTED_FORMATS=".obj,.mtl,.jpg,.png,.bmp"
```

**Hinweis:** Das Frontend merkt sich Nutzerpräferenzen (z. B. Achsenanzeige im Viewer) im `localStorage`.

### Vite Config
```javascript
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
}
```

## 🎨 Styling

### Tailwind CSS Setup
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#f97316',    // Orange
        secondary: '#1f2937',  // Dark Gray
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      }
    }
  }
}
```

### CSS Custom Properties
```css
:root {
  --color-primary: #f97316;
  --color-background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
  --glass-effect: rgba(255, 255, 255, 0.1);
}
```

### Glasmorphism Components
```css
.glass-effect {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```

---

**🎯 Das Frontend bietet eine vollständige, benutzerfreundliche Oberfläche für die 3D-Model-Konvertierung mit allen modernen Web-Standards und Best Practices.**