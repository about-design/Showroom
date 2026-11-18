import express from 'express';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('ColorMappingRouter');

/**
 * GET /standards
 * Get standard color palette and threshold configuration for color mapping
 */
router.get('/standards', (req, res) => {
  try {
    // Return built-in presets matching _get_standard_color_palette() in Blender script
    const standardColors = [
      {
        name: 'Verzinkt glänzend metall',
        rgb: [0.64, 0.64, 0.64],
        hex: '#A3A3A3',
        metallic: 1.0,
        roughness: 0.25
      },
      {
        name: 'Verzinkt metall',
        rgb: [0.64, 0.64, 0.64],
        hex: '#A3A3A3',
        metallic: 1.0,
        roughness: 0.55
      },
      {
        name: 'lichtgrau Pulverbeschichtet',
        rgb: [0.957, 0.957, 0.957],
        hex: '#F4F4F4',
        metallic: 0.0,
        roughness: 0.300
      },
      {
        name: 'rotorange Pulverbeschichtet',
        rgb: [0.882, 0.494, 0.000],
        hex: '#E17E00',
        metallic: 0.0,
        roughness: 0.60
      },
      {
        name: 'tiefschwarz Pulverbeschichtet',
        rgb: [0.03, 0.03, 0.03],
        hex: '#080808',
        metallic: 0.0,
        roughness: 0.55
      },
      {
        name: 'anthrazit Pulverbeschichtet',
        rgb: [0.22, 0.24, 0.26],
        hex: '#383D42',
        metallic: 0.0,
        roughness: 0.50
      },
      {
        name: 'enzianblau Pulverbeschichtet',
        rgb: [0.07451, 0.54118, 1.0],
        hex: '#138AFF',
        metallic: 0.0,
        roughness: 0.50
      },
      {
        name: 'Plastikkappe',
        rgb: [0.05, 0.05, 0.05],
        hex: '#0D0D0D',
        metallic: 0.0,
        roughness: 0.65
      }
    ];

    res.json({
      enabled: process.env.COLOR_MAPPING_ENABLED !== 'false',
      threshold: parseFloat(process.env.COLOR_MAPPING_THRESHOLD || '0.20'),
      colors: standardColors,
      description: 'Standard color palette for threshold-based color mapping. Colors within the threshold distance will be mapped to the nearest standard color.'
    });
    
  } catch (error) {
    logger.error('Failed to get color mapping standards:', error);
    res.status(500).json({
      error: 'Failed to get color mapping standards',
      message: error.message
    });
  }
});

export { router as colorMappingRouter };
