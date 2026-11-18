const express = require('express')
const router = express.Router()
const axios = require('axios')

// API Gateway health check
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// MCP Server health check (proxy)
router.get('/mcp', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8001/health', {
      timeout: 5000
    })
    
    res.json({
      status: 'healthy',
      service: 'mcp-server',
      data: response.data
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'mcp-server',
      error: error.message
    })
  }
})

module.exports = router