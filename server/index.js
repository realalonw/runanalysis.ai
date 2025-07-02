import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = promisify(exec);

// Temporary: Use system FFmpeg for now
const useSystemFFmpeg = true;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const PORT = process.env.PORT || 5001;
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure the upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const ext = path.extname(sanitizedName) || '.bin';
    const baseName = path.basename(sanitizedName, ext);
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  },
});

// Create multer instance with file filter
const upload = multer({
  storage,
  limits: { 
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024, // 500MB max file size
    files: 300, // Max 300 files for video frames
    fieldSize: 500 * 1024 * 1024 // 500MB max field size
  },
  fileFilter: (req, file, cb) => {
    try {
      // Check file extension
      const filetypes = /\.(jpe?g|png|gif|mp4|mov|avi|webm|mkv|pdf|docx|txt)$/i;
      const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
      
      // Check MIME type with more flexible matching
      const mimetypes = [
        /^image\//, // All image types
        /^video\//, // All video types
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ];
      
      const mimetype = mimetypes.some(type => 
        typeof type === 'string' 
          ? type === file.mimetype 
          : type.test(file.mimetype)
      );
      
      if (extname && mimetype) {
        return cb(null, true);
      } else {
        console.warn('File upload rejected:', {
          filename: file.originalname,
          mimetype: file.mimetype,
          extname: path.extname(file.originalname)
        });
        cb(new Error(`File type not supported: ${file.mimetype}`));
      }
    } catch (error) {
      console.error('Error in file filter:', error);
      cb(error);
    }
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://your-production-domain.com' 
    : 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Serve static files from the public directory
const publicPath = path.join(__dirname, '../public');
console.log('Serving static files from:', publicPath);
app.use(express.static(publicPath));

// Route for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Helper function to safely delete uploaded files
function cleanupFile(file) {
  if (!file || !file.path) return;
  
  return new Promise((resolve) => {
    fs.unlink(file.path, err => {
      if (err) {
        console.error('Error cleaning up file:', err);
      }
      resolve();
    });
  });
}

// Helper function to clean up temporary files
async function cleanupFiles(files) {
  if (!files) return;
  
  const fileArray = Array.isArray(files) ? files : [files];
  await Promise.all(fileArray.map(file => cleanupFile(file)));
}

// Error handler middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  
  // Handle file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum file size is 500MB.'
    });
  }
  
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: 'Too many files. Maximum 300 files allowed.'
    });
  }
  
  if (err.message?.includes('File type not supported')) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  // Default error response
  res.status(500).json({
    success: false,
    message: 'An error occurred while processing your request.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}

// Helper function to analyze multiple frames together as a sequence
async function analyzeVideoFrames(frames, originalVideo) {
  try {
    console.log(`Starting analysis of ${frames.length} frames as a sequence`);
    
    // Prepare all frames for analysis
    const frameContents = [];
    const frameAnalyses = [];
    
    // First, process all frames to collect their data
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      try {
        let frameBuffer;
        if (frame.path && fs.existsSync(frame.path)) {
          frameBuffer = fs.readFileSync(frame.path);
        } else if (frame.buffer && frame.buffer.length) {
          frameBuffer = frame.buffer;
        }
        
        if (!frameBuffer || frameBuffer.length === 0) {
          console.warn(`Skipping frame ${i+1}: empty or unreadable`);
          frameAnalyses.push({
            frameNumber: i + 1,
            timestamp: frame.timestamp ? frame.timestamp : (i * 0.5).toFixed(2) + 's',
            error: 'Frame data missing',
            details: 'Empty or unreadable frame data'
          });
          continue;
        }
        
        const base64Image = frameBuffer.toString('base64');
        const mimeType = frame.mimetype || 'image/jpeg';
        
        frameContents.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
            detail: 'high'
          }
        });
        
        // Store frame info for the response
        frameAnalyses.push({
          frameNumber: i + 1,
          timestamp: frame.timestamp ? frame.timestamp : (i * 0.5).toFixed(2) + 's',
          status: 'Pending analysis'
        });
        
      } catch (error) {
        console.error(`Error processing frame ${i + 1}:`, error);
        frameAnalyses.push({
          frameNumber: i + 1,
          timestamp: frame.timestamp ? frame.timestamp : (i * 0.5).toFixed(2) + 's',
          error: 'Failed to process frame',
          details: error.message
        });
      }
    }
    
    if (frameContents.length === 0) {
      throw new Error('No valid frames available for analysis');
    }
    
    // Enhanced running form analysis prompt with strict biomechanical focus
    const systemPrompt = `🔧 You are a biomechanics and running form expert. Your task is to analyze an athlete's running technique based on a sequence of video frames. Your evaluation must be highly detailed and biomechanically accurate, grounded in proper running form standards.

🔒 Important Instructions:
- Do NOT comment on video quality, lighting, background, framing, or non-running-related elements.
- Strictly focus on biomechanical aspects of the athlete's running form.
- Use only the information visible in the provided frames — do not guess or infer what cannot be seen.

📝 Output Format (repeat for each element below):

Key Observations: Specific biomechanical aspects visible in the frames

Priority Improvements: 1-2 most critical issues to address first

Actionable Drills: Specific exercises or cues to implement

🔍 Analyze the following key elements:

1. Posture
   - Head position relative to shoulders
   - Torso lean (forward/backward)
   - Pelvic alignment (neutral vs anterior/posterior tilt)

2. Arm Mechanics
   - Elbow angle (ideal ≈ 90°)
   - Arm swing direction and range (forward-back, not across midline)
   - Shoulder relaxation vs tension

3. Leg Mechanics
   - Stride length and cadence consistency
   - Knee drive height and timing
   - Foot strike pattern (forefoot, midfoot, or heel)

4. Efficiency
   - Vertical oscillation (how much the body bounces up/down)
   - Forward lean initiation (from ankles vs waist)
   - Signs of energy conservation or unnecessary effort

✅ Tone:
- Clear, professional, and biomechanical
- Focus on what can be improved, not just what's wrong
- Provide specific, implementable advice
- Back each point with direct visual evidence from the frames

🧠 Example Output Snippet:
Posture

Key Observations: 
- Torso shows a slight backward lean throughout the gait cycle
- Head position is forward of the shoulders
- Noticeable anterior pelvic tilt in mid-stance

Priority Improvements:
1. Forward lean should initiate from the ankles, not the waist
2. Pelvic position needs stabilization to reduce excessive tilt

Actionable Drills:
- Wall lean drill: Practice forward lean from ankles against a wall
- Dead bug exercise: 3 sets of 10 reps daily to strengthen core and stabilize pelvis
- Cue: "Chest up, hips forward" to align posture`;
    
    // Call OpenAI Vision API with all frames at once
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Please analyze this sequence of ${frameContents.length} video frames. The frames are in order from first to last.`
            },
            ...frameContents
          ]
        }
      ],
      max_tokens: 4000,
    });
    
    // Extract the combined analysis
    const combinedAnalysis = response.choices[0].message.content;
    
    // Update all frame analyses with the combined result
    frameAnalyses.forEach(frame => {
      if (!frame.error) {
        frame.analysis = combinedAnalysis;
        frame.status = 'Analyzed';
      }
    });
    
    // Use the combined analysis as the summary
    const summary = combinedAnalysis;
    
    return {
      success: true,
      frameCount: frames.length,
      frameAnalyses,
      summary
    };
    
  } catch (error) {
    console.error('Error in analyzeVideoFrames:', error);
    throw error;
  }
}

// Helper function to generate a summary of video analysis
async function generateVideoSummary(frameAnalyses) {
  try {
    // Extract just the analysis text from each frame
    const analysisTexts = frameAnalyses
      .filter(f => f.analysis)
      .map(f => `[${f.timestamp}] ${f.analysis}`)
      .join('\n\n');
    
    if (!analysisTexts) return "No analysis available for the video frames.";
    
    // Use GPT to generate a summary
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that summarizes video frame analyses into a coherent summary. Focus on the main events and changes over time."
        },
        {
          role: "user",
          content: `Please provide a detailed summary of this video based on the following frame analyses. Focus on the main events and how they progress over time.\n\n${analysisTexts}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    
    return response.choices[0].message.content;
    
  } catch (error) {
    console.error('Error generating video summary:', error);
    return "Could not generate a summary due to an error: " + error.message;
  }
}

// Routes
// New endpoint for video frame analysis
app.post('/api/analyze-video', upload.array('frames'), async (req, res) => {
  console.log('Received request to /api/analyze-video');
  console.log(`Files received: ${req.files?.length || 0}`);
  
  try {
    const frames = req.files || [];
    const originalVideo = req.files?.find(f => f.fieldname === 'originalVideo');
    
    console.log(`Processing ${frames.length} frames`);
    
    if (!frames.length) {
      console.error('No frames provided for analysis');
      return res.status(400).json({ 
        success: false, 
        error: 'No frames provided for analysis' 
      });
    }
    
    console.log(`Received ${frames.length} frames for analysis`);
    
    // Log frame details for debugging
    console.log('Frame details:', frames.map(f => ({
      fieldname: f.fieldname,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      path: f.path
    })));
    
    try {
      // Analyze the frames
      console.log('Starting frame analysis...');
      const analysis = await analyzeVideoFrames(frames, originalVideo);
      console.log('Frame analysis completed successfully');
      
      // Clean up uploaded files
      frames.forEach(file => cleanupFile(file));
      if (originalVideo) cleanupFile(originalVideo);
      
      res.json({
        success: true,
        message: `Analyzed ${frames.length} video frames`,
        analysis: {
          type: 'video',
          frameCount: frames.length,
          summary: analysis.summary,
          frames: analysis.frameAnalyses
        }
      });
    } catch (analysisError) {
      console.error('Error during frame analysis:', analysisError);
      console.error('Stack trace:', analysisError.stack);
      
      // Check for OpenAI API errors specifically
      if (analysisError.response) {
        console.error('OpenAI API Error:', {
          status: analysisError.response.status,
          statusText: analysisError.response.statusText,
          headers: analysisError.response.headers,
          data: analysisError.response.data
        });
      }
      
      // Clean up any uploaded files on error
      if (req.files) {
        req.files.forEach(file => cleanupFile(file));
      }
      
      const errorMessage = analysisError.message || 'Failed to analyze video frames';
      console.error('Sending error response:', errorMessage);
      
      res.status(500).json({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? analysisError.stack : undefined
      });
    }
  } catch (error) {
    console.error('Error in /api/analyze-video:', error);
    
    // Clean up any uploaded files on error
    if (req.files) {
      req.files.forEach(file => cleanupFile(file));
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze video frames'
    });
  }
});

// Endpoint for analyzing regular files
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  console.log('=== /api/analyze request received ===');
  console.log('Headers:', req.headers);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  console.log('Request body keys:', Object.keys(req.body));
  console.log('Request files:', req.files);
  console.log('Request file:', req.file);
  
  if (!req.file) {
    console.error('No file found in request');
    console.log('Request body:', req.body);
    return res.status(400).json({ 
      success: false, 
      error: 'No file provided for analysis',
      details: {
        headers: Object.keys(req.headers),
        body: Object.keys(req.body),
        files: req.files || 'No files',
        file: req.file ? 'Present' : 'Missing'
      }
    });
  }

  console.log(`Received file for analysis: ${req.file.originalname} (${req.file.size} bytes)`);
  console.log('File details:', {
    fieldname: req.file.fieldname,
    originalname: req.file.originalname,
    encoding: req.file.encoding,
    mimetype: req.file.mimetype,
    size: req.file.size,
    destination: req.file.destination,
    filename: req.file.filename,
    path: req.file.path
  });
  
  try {
    // For text files, read and analyze the content
    if (req.file.mimetype === 'text/plain' || req.file.mimetype === 'application/pdf') {
      const text = fs.readFileSync(req.file.path, 'utf-8');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes uploaded files. Provide a detailed analysis of the content.'
          },
          {
            role: 'user',
            content: `Analyze this ${req.file.mimetype} file named "${req.file.originalname}":\n\n${text.substring(0, 10000)}`
          }
        ]
      });
      
      // Clean up the uploaded file
      cleanupFile(req.file);
      
      return res.json({
        success: true,
        message: 'File analyzed successfully',
        analysis: {
          type: 'file',
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          content: response.choices[0].message.content
        }
      });
    } 
    // For images
    else if (req.file.mimetype.startsWith('image/')) {
      const maxSize = 20 * 1024 * 1024; // 20MB
      
      if (req.file.size > maxSize) {
        cleanupFile(req.file);
        return res.status(400).json({
          success: false,
          error: 'Image is too large. Maximum size is 20MB.'
        });
      }
      
      // Read the image file
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString('base64');
      const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;
      
      // Analyze with OpenAI
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: 'Analyze this image in detail. Include any visible text, objects, colors, and context. Be thorough in your description.' 
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                  detail: 'high'
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });
      
      // Clean up the uploaded file
      cleanupFile(req.file);
      
      return res.json({
        success: true,
        message: 'Image analyzed successfully',
        analysis: {
          type: 'image',
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          content: response.choices[0].message.content
        }
      });
    }
    
  } catch (error) {
    console.error('Error in /api/analyze:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      cleanupFile(req.file);
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze file'
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file was uploaded'
    });
  }

  try {
    console.log('File uploaded successfully:', req.file.originalname);

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      throw new Error('OpenAI API key is not configured. Please check your .env file');
    }

    console.log('Starting file analysis...');
    const analysis = await analyzeFile(req.file);
    
    // Clean up the uploaded file after successful analysis
    cleanupFile(req.file);
    
    return res.json({
      success: true,
      message: 'File uploaded and analyzed successfully',
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      },
      analysis: analysis || 'No analysis available'
    });
  } catch (error) {
    console.error('Error in /api/upload:', error);
    
    // Clean up the uploaded file in case of error
    if (req.file) {
      cleanupFile(req.file);
    }
    
    // Send error response
    const statusCode = error.message.includes('OpenAI API key') ? 500 : 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Error processing file',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Helper function to extract frames from video using system FFmpeg
async function extractVideoFrames(videoPath, outputDir, frameCount = 10) {
  const framePaths = [];
  const tempDir = path.join(outputDir, `frames-${Date.now()}`);
  
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create temporary directory for frames
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Get video duration and validate
    const duration = await getVideoDuration(videoPath);
    if (!duration || isNaN(duration) || duration <= 0) {
      throw new Error(`Invalid video duration: ${duration}`);
    }
    
    console.log(`Extracting ${frameCount} frames from ${path.basename(videoPath)} (${duration.toFixed(2)}s)`);

    // Calculate frame extraction times
    const interval = duration / (frameCount + 1);
    const timestamps = [];
    
    // Generate timestamps
    for (let i = 1; i <= frameCount; i++) {
      timestamps.push(Math.min(Math.floor(interval * i), duration - 0.1));
    }

    // Extract frames in parallel
    await Promise.all(timestamps.map(async (timestamp, index) => {
      const outputPath = path.join(tempDir, `frame-${index + 1}.jpg`);
      
      try {
        // Use -ss before -i for faster seeking
        await execPromise(
          `ffmpeg -y -ss ${timestamp} -i "${videoPath}" ` +
          `-vframes 1 -q:v 2 -vf "scale='min(1280,iw)':-1" ` +
          `-f image2 "${outputPath}"`
        );
        
        // Verify the frame was created and has content
        const stats = await fs.promises.stat(outputPath);
        if (stats.size > 0) {
          framePaths.push({
            path: outputPath,
            time: timestamp,
            size: stats.size
          });
        } else {
          console.warn(`Empty frame at ${timestamp}s`);
          await fs.promises.unlink(outputPath).catch(console.error);
        }
      } catch (error) {
        console.error(`Error extracting frame at ${timestamp}s:`, error);
        // Continue with other frames even if one fails
      }
    }));

    if (framePaths.length === 0) {
      throw new Error('No valid frames could be extracted from the video');
    }

    console.log(`Successfully extracted ${framePaths.length} frames`);
    return framePaths;
  } catch (error) {
    // Clean up any created files on error
    try {
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Error cleaning up temporary files:', cleanupError);
    }
    
    console.error('Error extracting video frames:', error);
    throw new Error(`Failed to extract frames: ${error.message}`);
  }
}

// Helper function to get video duration using system FFmpeg
async function getVideoDuration(videoPath) {
  try {
    // First try fast method
    try {
      const { stdout } = await execPromise(
        `ffprobe -v error -show_entries format=duration ` +
        `-of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      );
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration) && duration > 0) {
        return duration;
      }
    } catch (fastError) {
      console.warn('Fast duration detection failed, trying fallback:', fastError.message);
    }
    
    // Fallback method
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration ` +
      `-show_entries stream=codec_type,duration ` +
      `-of default=noprint_wrappers=1 "${videoPath}"`
    );
    
    // Try to find duration from output
    const durationMatch = stdout.match(/duration=([0-9.]+)/);
    if (durationMatch && durationMatch[1]) {
      return parseFloat(durationMatch[1]);
    }
    
    console.error('Could not determine video duration from:', stdout);
    return null;
  } catch (error) {
    console.error('Error getting video duration:', error);
    return null;
    throw error;
  }
}

// Helper function to encode image to base64
function encodeImageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

// Helper function to resize image if needed
async function resizeImageIfNeeded(filePath, maxDimension = 2048) {
  try {
    // Skip if sharp is not available
    const sharp = await import('sharp');
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // Check if resizing is needed
    if (metadata.width <= maxDimension && metadata.height <= maxDimension) {
      const buffer = await image.toBuffer();
      return { buffer, resized: false };
    }
    
    // Resize the image maintaining aspect ratio
    const resizedBuffer = await image
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toBuffer();
    
    return { buffer: resizedBuffer, resized: true };
    
  } catch (error) {
    console.error('Error in resizeImageIfNeeded:', error);
    // If sharp fails, try to return the original file
    return { buffer: fs.readFileSync(filePath), resized: false };
  }
}

// AI Analysis function
async function analyzeFile(file) {
  const fileType = file.mimetype.split('/')[0];
  let analysis = '';
  
  // Get file stats first
  const stats = fs.statSync(file.path);
  
  // Initialize file details
  const fileDetails = {
    originalSize: stats.size,
    processedSize: null,
    dimensions: null,
    resized: false
  };

  try {
    // For text files and PDFs
    if (file.mimetype === 'text/plain' || file.mimetype === 'application/pdf') {
      const text = fs.readFileSync(file.path, 'utf-8');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes uploaded files. Provide a detailed analysis of the content.'
          },
          {
            role: 'user',
            content: `Analyze this ${file.mimetype} file:\n\n${text.substring(0, 10000)}`
          }
        ]
      });
      analysis = response.choices[0].message.content;
    }
    // For images
    else if (fileType === 'image') {
      // Check file size (max 20MB for images)
      const maxSize = 20 * 1024 * 1024; // 20MB
      
      if (fileDetails.originalSize > maxSize) {
        throw new Error('Image is too large. Maximum size is 20MB. Please use a smaller image.');
      }
      
      console.log('Processing image for analysis...');
      console.log('Original file size:', (fileDetails.originalSize / 1024 / 1024).toFixed(2), 'MB');
      
      // Resize image if needed and get base64
      const { buffer: imageBuffer, resized } = await resizeImageIfNeeded(file.path);
      fileDetails.resized = resized;
      fileDetails.processedSize = imageBuffer.length;
      
      console.log('Processed file size:', (fileDetails.processedSize / 1024 / 1024).toFixed(2), 'MB', resized ? '(resized)' : '(original)');
      
      // Get image dimensions for logging
      try {
        const sharp = require('sharp');
        const metadata = await sharp(imageBuffer).metadata();
        fileDetails.dimensions = { width: metadata.width, height: metadata.height };
        console.log('Image dimensions:', fileDetails.dimensions);
      } catch (e) {
        console.warn('Could not get image dimensions:', e.message);
      }
      
      const imageBase64 = imageBuffer.toString('base64');
      
      console.log('Sending image to OpenAI for analysis...');
      const startTime = Date.now();
      
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                { 
                  type: 'text', 
                  text: 'Analyze this image in detail. Include any visible text, objects, colors, and context. Be concise but thorough.' 
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${file.mimetype};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1500,
        }, {
          // Add timeout for the API call
          timeout: 60000, // 60 seconds
        });
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log(`Analysis completed in ${duration.toFixed(2)} seconds`);
        
        analysis = response.choices[0].message.content;
        console.log('Analysis successful, response length:', analysis.length);
      } catch (error) {
        console.error('OpenAI API Error:', {
          name: error.name,
          message: error.message,
          code: error.code,
          status: error.status,
          response: error.response?.status,
          stack: error.stack
        });
        
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          throw new Error('The analysis took too long to complete. Please try again with a smaller image or different file.');
        } else if (error.status === 400) {
          throw new Error('The image format is not supported. Please try with a different image (JPEG, PNG, GIF).');
        } else if (error.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        } else {
          throw new Error('Failed to analyze image. The image might be corrupted or in an unsupported format.');
        }
      } finally {
        // Clean up the image buffer to free memory
        if (imageBuffer) {
          imageBuffer.fill(0);
        }
      }
    }
    // For videos
    else if (fileType === 'video') {
      // For videos, we'll analyze the first few frames
      // In a production app, you would extract multiple frames and analyze them
      analysis = 'Video analysis is currently limited. For best results, please upload images or text files. ';
      analysis += 'We recommend extracting key frames and uploading them as images for detailed analysis.';
    }
    // For unsupported file types
    else {
      throw new Error(`Unsupported file type: ${file.mimetype}. Please upload images, videos, or text files.`);
    }
    
    return analysis;
  } catch (error) {
    console.error('Error in analyzeFile:', error);
    throw new Error(`Failed to analyze file: ${error.message}`);
  }
}

// Error handling middleware - must be last!
app.use(errorHandler);

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Upload directory: ${path.resolve(UPLOAD_DIR)}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
