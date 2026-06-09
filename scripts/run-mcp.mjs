#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MCP_DIR = path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'mcp-server')
const isWin = process.platform === 'win32'
const venvPython = path.join(MCP_DIR, isWin ? 'venv/Scripts/python.exe' : 'venv/bin/python3')

const child = spawn(venvPython, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8001'], {
  cwd: MCP_DIR,
  stdio: 'inherit',
  env: { ...process.env, BLENDER_OUTPUT_DIR: process.env.BLENDER_OUTPUT_DIR || path.join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'outputs') },
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
