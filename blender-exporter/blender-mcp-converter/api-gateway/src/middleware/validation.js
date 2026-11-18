import Joi from 'joi';

/**
 * Validation schema for conversion requests
 */
export const conversionRequestSchema = Joi.object({
  embedTextures: Joi.string().valid('true', 'false').optional(),
  useAI: Joi.string().valid('true', 'false').optional(),
  useDraco: Joi.string().valid('true', 'false').optional(),
  outputFormat: Joi.string().valid('glb', 'gltf').optional(),
  scale: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  decimateRatio: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  autoLabelParts: Joi.string().valid('true','false').optional(),
  useClaudeAI: Joi.string().valid('true', 'false').optional(),
  useGTINNaming: Joi.string().valid('true', 'false').optional(),
  gtin: Joi.string().pattern(/^[0-9]{8,14}$/).optional(),
  articleNumber: Joi.string().pattern(/^[A-Za-z0-9 _.-]{1,80}$/).optional(),
  optimizeGlb: Joi.string().valid('true', 'false').optional(),
  overwriteExisting: Joi.string().valid('true', 'false').optional(),
  batchChunkSize: Joi.string().pattern(/^[0-9]+$/).optional(),
  rotateYUp: Joi.string().valid('true', 'false').optional(),
  bakeYUp: Joi.string().valid('true', 'false').optional(),
  importUpAxis: Joi.string().valid('AUTO', 'X', 'Y', 'Z').optional(),
  // Optional export rotation (mutually exclusive with rotateYUp)
  rotateAxis: Joi.string().valid('X', 'Y', 'Z').optional(),
  rotateDegrees: Joi.string().valid('90', '180', '270').optional(),
  stripCamerasLights: Joi.string().valid('true', 'false').optional(),
  keepCamerasLights: Joi.string().valid('true', 'false').optional(),
  enablePreflight: Joi.string().valid('true', 'false').optional(),
  colorSaturation: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  colorBrightness: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  roughnessMultiplier: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  metallicMultiplier: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  // STEP-specific options
  tessellationQuality: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  materialFinish: Joi.string().valid('standard', 'galvanized', 'powder-coated', 'auto').optional(),

  // Color selection / remap / presets (JSON strings)
  selectedColors: Joi.string().max(200000).optional(),
  colorOverrides: Joi.string().max(200000).optional(),
  colorMaterials: Joi.string().max(400000).optional(),

  // MTL color handling
  preserveMtlColors: Joi.string().valid('true', 'false').optional(),
  defaultColorOverride: Joi.string().valid('true', 'false').optional(),
  defaultColorHex: Joi.string().pattern(/^#?[0-9a-fA-F]{6}$/).optional(),

  // USDZ companion export (iOS AR Quick Look). Toggle via dashboard button.
  exportUsdz: Joi.string().valid('true', 'false').optional(),

  // Mesh fingerprint matching (Option A)
  targetMeshSignature: Joi.string().max(400000).optional(),
  targetMeshSignatureId: Joi.string().pattern(/^[A-Za-z0-9_.:-]{1,80}$/).optional(),
  targetMeshMatchThreshold: Joi.string().pattern(/^[0-9]*\.?[0-9]+$/).optional(),
  targetMeshMaterial: Joi.string().max(400000).optional()
});

/**
 * Middleware to validate conversion request
 */
export const validateConversionRequest = (req, res, next) => {
  try {
    // Validate request body (don't replace req.body to preserve actual values)
    const { error } = conversionRequestSchema.validate(req.body, { 
      stripUnknown: true,
      abortEarly: false 
    });
    
    if (error) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.details.map(detail => detail.message),
        jobId: req.jobId
      });
    }

    // Conflict: rotateAxis/rotateDegrees and rotateYUp are mutually exclusive
    const body = req.body || {};
    const rotateYUp = body.rotateYUp === 'true' || body.rotateYUp === true;
    const hasAxis = body.rotateAxis === 'X' || body.rotateAxis === 'Y' || body.rotateAxis === 'Z';
    const hasDegrees = ['90', '180', '270'].includes(String(body.rotateDegrees || '').trim());
    const hasExportRotation = hasAxis && hasDegrees;
    if (hasExportRotation && rotateYUp) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: ['rotateAxis/rotateDegrees and rotateYUp are mutually exclusive. Use either export rotation (X/Y/Z + degrees) or rotateYUp.'],
        jobId: req.jobId
      });
    }
    if ((hasAxis && !hasDegrees) || (!hasAxis && hasDegrees)) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: ['When using export rotation, both rotateAxis (X, Y or Z) and rotateDegrees (90, 180, 270) must be set.'],
        jobId: req.jobId
      });
    }
    
    // Validate files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded',
        jobId: req.jobId
      });
    }
    
    const hasObjOrStep = req.files.some(file => {
      const name = file.originalname.toLowerCase();
      return name.endsWith('.obj') || name.endsWith('.step') || name.endsWith('.stp');
    });
    const hasArchive = req.files.some(file => file.originalname.toLowerCase().endsWith('.zip'));
    
    if (!hasObjOrStep && !hasArchive) {
      return res.status(400).json({
        error: 'At least one .OBJ, .STEP/.STP file or .ZIP archive is required',
        jobId: req.jobId
      });
    }
    
    next();
  } catch (error) {
    res.status(500).json({
      error: 'Validation error',
      message: error.message,
      jobId: req.jobId
    });
  }
};