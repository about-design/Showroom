#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const API_DIR = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'api-gateway')

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start'], {
  cwd: API_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    BLENDER_OUTPUT_DIR: process.env.BLENDER_OUTPUT_DIR || path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'outputs'),
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
