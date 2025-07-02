// Video frame extraction utility
class VideoFrameExtractor {
  constructor() {
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.frames = [];
    this.previewFrames = [];
    this.frameRate = 2; // 2 FPS for analysis
    this.maxDuration = 30; // Maximum video duration in seconds to process
    this.maxWidth = 640; // Maximum width for scaled frames
    this.quality = 0.7; // JPEG quality (0.7 = 70%)
    this.isProcessing = false;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onFrameExtracted = null;
    this.videoUrl = null;
    this.currentExtraction = {
      promise: null,
      resolve: null,
      reject: null,
      cancelled: false
    };
    
    // Bind methods
    this.cleanup = this.cleanup.bind(this);
    this.cancel = this.cancel.bind(this);
    this.extractFrames = this.extractFrames.bind(this);
    this.extractFrameSequence = this.extractFrameSequence.bind(this);
    this.seekToTime = this.seekToTime.bind(this);
    this.calculateAspectRatio = this.calculateAspectRatio.bind(this);
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Cancel any in-progress extraction
    this.cancel();
    
    // Store references for cleanup
    const videoToCleanup = this.video;
    const videoUrlToRevoke = this.videoUrl;
    
    // Clear references immediately to prevent race conditions
    this.video = null;
    this.videoUrl = null;
    this.isProcessing = false;
    
    // Clean up video element if it exists
    if (videoToCleanup) {
      try {
        // Remove all event listeners by cloning and replacing
        const newVideo = videoToCleanup.cloneNode(false);
        if (videoToCleanup.parentNode) {
          videoToCleanup.parentNode.replaceChild(newVideo, videoToCleanup);
        }
        
        // Stop and clean up the video element
        videoToCleanup.pause();
        videoToCleanup.removeAttribute('src');
        videoToCleanup.load();
        
        // Force garbage collection by removing references
        setTimeout(() => {
          try {
            videoToCleanup.remove();
          } catch (e) {
            console.warn('Error removing video element:', e);
          }
        }, 0);
      } catch (e) {
        console.warn('Error cleaning up video element:', e);
      }
    }
    
    // Clean up canvas
    if (this.canvas) {
      try {
        if (this.ctx) {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx = null;
        }
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas = null;
      } catch (e) {
        console.warn('Error cleaning up canvas:', e);
      }
    }
    
    // Revoke object URL if it exists
    if (videoUrlToRevoke) {
      try {
        // Use a timeout to ensure any pending operations complete
        setTimeout(() => {
          try {
            URL.revokeObjectURL(videoUrlToRevoke);
          } catch (e) {
            console.warn('Failed to revoke video URL:', e);
          }
        }, 100);
      } catch (e) {
        console.warn('Error during URL cleanup:', e);
      }
    }
    
    // Clear frame data
    this.frames = [];
    this.previewFrames = [];
  }

  /**
   * Reset the extractor state
   */
  reset() {
    try {
      // Clear any pending operations
      this.cancel();
      
      // Clear frame arrays
      this.frames = [];
      this.previewFrames = [];
      
      // Reset state
      this.isProcessing = false;
      
      // Reset current extraction state
      this.currentExtraction = {
        promise: null,
        resolve: null,
        reject: null,
        cancelled: false
      };
      
      // Clean up resources
      this.cleanup();
      
      // Create new video and canvas elements for next use
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('crossorigin', 'anonymous');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.preload = 'auto';
      
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      
      // Ensure the elements are in the DOM but hidden
      this.video.style.display = 'none';
      this.canvas.style.display = 'none';
      document.body.appendChild(this.video);
      document.body.appendChild(this.canvas);
      
    } catch (error) {
      console.error('Error during reset:', error);
      // Ensure we still clean up even if reset fails
      this.cleanup();
      throw error;
    }
  }

  /**
   * Cancel the current extraction
   */
  cancel() {
    if (this.currentExtraction) {
      this.currentExtraction.cancelled = true;
      if (this.currentExtraction.reject) {
        this.currentExtraction.reject(new Error('Frame extraction cancelled'));
      }
    }
    this.isProcessing = false;
  }

  /**
   * Calculate the scaled dimensions while maintaining aspect ratio
   * @param {number} width - Original width
   * @param {number} height - Original height
   * @param {number} maxWidth - Maximum width
   * @returns {Object} Scaled dimensions {width, height}
   */
  calculateScaledDimensions(width, height, maxWidth) {
    const aspectRatio = width / height;
    if (width > maxWidth) {
      return {
        width: maxWidth,
        height: Math.round(maxWidth / aspectRatio)
      };
    }
    return { width, height };
  }

  /**
   * Calculate aspect ratio while maintaining dimensions
   * @param {number} width - Original width
   * @param {number} height - Original height
   * @param {number} maxWidth - Maximum width for scaling
   * @returns {Object} - Scaled width and height
   */
  calculateAspectRatio(width, height, maxWidth) {
    if (!width || !height) {
      return { width: maxWidth, height: Math.round(maxWidth * 9 / 16) };
    }
    
    const aspectRatio = width / height;
    let newWidth = Math.min(width, maxWidth);
    let newHeight = Math.round(newWidth / aspectRatio);
    
    return { width: newWidth, height: newHeight };
  }

  /**
   * Extract frames from the video at the specified frame rate
   * @param {File} file - Video file to extract frames from
   * @param {Object} options - Extraction options
   * @param {number} [options.frameRate] - Frames per second to extract
   * @param {number} [options.maxDuration] - Maximum duration in seconds to process
   * @returns {Promise<Array<string>>} - Array of base64 encoded frames
   */
  async extractFrames(file, options = {}) {
    if (this.isProcessing) {
      throw new Error('Extraction already in progress');
    }

    this.isProcessing = true;
    this.frames = [];
    this.previewFrames = [];
    this.currentExtraction = { cancelled: false };

    // Apply options
    this.frameRate = options.frameRate || this.frameRate;
    this.maxDuration = options.maxDuration || this.maxDuration;
    this.quality = options.quality || this.quality;

    return new Promise((resolve, reject) => {
      // Create video element if it doesn't exist
      if (!this.video) {
        this.video = document.createElement('video');
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('crossorigin', 'anonymous');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.preload = 'auto';
      } else {
        // Ensure crossOrigin is set even if video element is reused
        this.video.setAttribute('crossorigin', 'anonymous');
      }

      // Create canvas if it doesn't exist
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
      }

      // Create object URL for the video file
      if (this.videoUrl) {
        URL.revokeObjectURL(this.videoUrl);
      }
      this.videoUrl = URL.createObjectURL(file);

      const onCanPlay = () => {
        // Set canvas dimensions to match video aspect ratio
        const aspectRatio = this.video.videoWidth / this.video.videoHeight;
        this.canvas.width = 640; // Fixed width for consistency
        this.canvas.height = Math.round(this.canvas.width / aspectRatio);
        
        // Calculate frame interval and total frames
        const duration = Math.min(this.video.duration, this.maxDuration);
        const frameInterval = 1 / this.frameRate;
        const totalFrames = Math.ceil(duration * this.frameRate);
        
        console.log(`Extracting ${totalFrames} frames from ${duration.toFixed(2)}s video`);
        
        // Reset video to beginning
        this.video.currentTime = 0;
        
        // Small delay to ensure video is reset
        setTimeout(() => {
          // Extract frames at specified intervals
          this.extractFrameSequence(0, totalFrames, frameInterval, duration)
            .then(() => {
              if (!this.currentExtraction.cancelled) {
                this.isProcessing = false;
                console.log(`Successfully extracted ${this.frames.length} frames`);
                if (this.onComplete) {
                  this.onComplete(this.frames);
                }
                resolve(this.frames);
              }
            })
            .catch(err => {
              this.isProcessing = false;
              console.error('Frame extraction error:', err);
              if (!this.currentExtraction.cancelled) {
                if (this.onError) {
                  this.onError(err);
                }
                reject(err);
              }
            });
        }, 100);
      };

      const onError = (e) => {
        console.error('Video loading error:', e);
        this.isProcessing = false;
        const error = new Error(`Failed to load video: ${e.message || 'Unknown error'}`);
        if (this.onError) {
          this.onError(error);
        }
        reject(error);
      };
      
      // Set up event listeners
      this.video.addEventListener('canplay', onCanPlay, { once: true });
      this.video.addEventListener('error', onError, { once: true });
      
      // Configure video element
      this.video.preload = 'auto';
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.src = this.videoUrl;
      
      // Add a timeout for initial video load
      const loadTimeout = setTimeout(() => {
        if (this.video.readyState < 2) {
          console.warn('Video load taking too long, trying to continue...');
          onCanPlay();
        }
      }, 5000); // 5 second timeout for initial load
      
      // Clear timeout if video loads before timeout
      this.video.addEventListener('canplay', () => {
        clearTimeout(loadTimeout);
      }, { once: true });
      
      // Start loading the video
      this.video.load();
    });
  }

  /**
   * Extract a sequence of frames from the video
   * @param {number} startFrame - Starting frame index
   * @param {number} totalFrames - Total number of frames to extract
   * @param {number} frameInterval - Time between frames in seconds
   * @param {number} duration - Total video duration in seconds
   * @returns {Promise<void>}
   */
  async extractFrameSequence(startFrame, totalFrames, frameInterval, duration) {
    if (startFrame >= totalFrames) {
      return Promise.resolve();
    }
    
    const targetTime = Math.min(startFrame * frameInterval, duration);
    
    try {
      // Extract current frame
      const frameData = await this.extractFrame(targetTime);
      this.frames.push(frameData);
      
      // Create a preview frame (lower resolution)
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 160;
      previewCanvas.height = Math.round(160 * (this.canvas.height / this.canvas.width));
      const previewCtx = previewCanvas.getContext('2d');
      
      // Draw the current frame to the preview canvas
      const img = new Image();
      img.src = frameData;
      await new Promise((resolve) => {
        img.onload = () => {
          previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
          resolve();
        };
      });
      
      this.previewFrames.push(previewCanvas.toDataURL('image/jpeg', 0.5));
      
      // Report progress
      if (this.onProgress) {
        this.onProgress({
          current: startFrame + 1,
          total: totalFrames,
          time: targetTime,
          frame: frameData,
          preview: this.previewFrames[startFrame]
        });
      }
      
      // Process next frame if not cancelled
      if (!this.currentExtraction.cancelled && startFrame < totalFrames - 1) {
        // Small delay to prevent UI freeze
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.extractFrameSequence(startFrame + 1, totalFrames, frameInterval, duration);
      }
    } catch (error) {
      console.error(`Error in frame sequence at frame ${startFrame}:`, error);
      throw error;
    }
  }

  /**
   * Get the nearest seekable time from the video
   * @param {number} targetTime - Desired time in seconds
   * @returns {number} - Nearest seekable time
   */
  getNearestSeekableTime(targetTime) {
    // Create canvas if it doesn't exist
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }

    if (!this.video || !this.video.seekable || this.video.seekable.length === 0) {
      return targetTime;
    }
    
    // Get all seekable ranges
    const seekableRanges = [];
    for (let i = 0; i < this.video.seekable.length; i++) {
      seekableRanges.push({
        start: this.video.seekable.start(i),
        end: this.video.seekable.end(i)
      });
    }
    
    // Find the range that contains our target time
    const containingRange = seekableRanges.find(range => 
      targetTime >= range.start && targetTime <= range.end
    );
    
    if (containingRange) {
      return targetTime; // We can seek directly to this time
    }
    
    // If we can't seek directly, find the nearest seekable point
    let nearestTime = null;
    let minDistance = Infinity;
    
    for (const range of seekableRanges) {
      // Check start of range
      const startDist = Math.abs(range.start - targetTime);
      if (startDist < minDistance) {
        minDistance = startDist;
        nearestTime = range.start;
      }
      
      // Check end of range
      const endDist = Math.abs(range.end - targetTime);
      if (endDist < minDistance) {
        minDistance = endDist;
        nearestTime = range.end;
      }
    }
    
    return nearestTime !== null ? nearestTime : targetTime;
  }
  
  /**
   * Extract a frame at a specific time
   * @param {number} targetTime - Time in seconds to extract the frame
   * @returns {Promise<string>} - Base64 encoded frame
   */
  async extractFrame(targetTime) {
    if (!this.video) {
      throw new Error('No video element available');
    }
    
    console.log(`Capturing frame at ${targetTime.toFixed(2)}s`);
    
    // Get the nearest seekable time
    const seekTime = this.getNearestSeekableTime(targetTime);
    
    // Seek to the target time
    await this.seekToTime(seekTime);
    
    // Small delay to ensure the video frame is ready
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    let frameData;
    const actualTime = this.video.currentTime;
    
    try {
      // Draw the current video frame to canvas
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      
      // Convert canvas to base64 JPEG
      frameData = this.canvas.toDataURL('image/jpeg', this.quality);
      
      const timeDiff = Math.abs(actualTime - targetTime);
      if (timeDiff > 0.1) {
        console.warn(`Frame at ${targetTime.toFixed(2)}s was captured at ${actualTime.toFixed(2)}s (Δ${timeDiff.toFixed(3)}s)`);
      } else {
        console.log(`Successfully captured frame at ${targetTime.toFixed(2)}s`);
      }
    } catch (error) {
      if (error.name === 'SecurityError') {
        // If we get a security error, try with a fallback method
        console.warn('Canvas export blocked by CORS, using fallback method');
        frameData = await this.fallbackFrameCapture(targetTime);
      } else {
        throw error;
      }
    }
    
    // Notify frame extracted
    if (this.onFrameExtracted) {
      this.onFrameExtracted(frameData, targetTime, this.frames.length);
    }
    
    return frameData;
  }

  /**
   * Seek to a specific time in the video and wait for seek to complete
   * @param {number} targetTime - Time in seconds to seek to
   * @param {number} [attempt=1] - Current attempt number (for retries)
   * @returns {Promise<void>}
   */
  async seekToTime(targetTime) {
    if (!this.video) {
      throw new Error('Video element not available');
    }
    
    // If already at the target time, resolve immediately
    if (Math.abs(this.video.currentTime - targetTime) < 0.01) {
      return Promise.resolve();
    }
    
    // Create a new promise for this seek operation
    return new Promise((resolve, reject) => {
      if (this.currentExtraction?.cancelled) {
        return reject(new Error('Frame extraction cancelled'));
      }
      
      // If video is not ready, wait for it
      if (this.video.readyState < 2) { // HAVE_CURRENT_DATA
        const onLoadedData = () => {
          this.video.removeEventListener('loadeddata', onLoadedData);
          this.seekToTime(targetTime).then(resolve).catch(reject);
        };
        this.video.addEventListener('loadeddata', onLoadedData, { once: true });
        return;
      }
      
      let timeoutId;
      let seekResolved = false;
      
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        // Use a try-catch to ensure we don't throw if video is gone
        try {
          if (this.video) {
            this.video.removeEventListener('seeked', onSeeked);
            this.video.removeEventListener('error', onError);
          }
        } catch (e) {
          console.warn('Error during seek cleanup:', e);
        }
      };
      
      const onSeeked = () => {
        if (seekResolved) return;
        cleanup();
        seekResolved = true;
        // Small delay to ensure frame is ready
        requestAnimationFrame(() => resolve());
      };
      
      const onError = (error) => {
        if (seekResolved) return;
        cleanup();
        seekResolved = true;
        console.error('Seek error:', error);
        reject(new Error(`Failed to seek to ${targetTime.toFixed(2)}s`));
      };
      
      try {
        // Add event listeners first
        this.video.addEventListener('seeked', onSeeked, { once: true });
        this.video.addEventListener('error', onError, { once: true });
        
        // Set a timeout in case the seeked event never fires
        timeoutId = setTimeout(() => {
          if (!seekResolved) {
            cleanup();
            seekResolved = true;
            console.warn(`Seek to ${targetTime.toFixed(2)}s timed out`);
            // Resolve anyway to continue processing, but log a warning
            resolve();
          }
        }, 2000);
        
        // Perform the seek
        this.video.currentTime = targetTime;
      } catch (error) {
        cleanup();
        if (!seekResolved) {
          seekResolved = true;
          reject(error);
        }
      }
    });
  }

  /**
   * Format time in seconds to MM:SS format
   * @param {number} seconds - Time in seconds
   * @returns {string} - Formatted time string
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Set the progress callback
   * @param {Function} callback - Callback function for progress updates
   * @returns {VideoFrameExtractor} - Returns this for method chaining
   */
  setProgressCallback(callback) {
    this.onProgress = callback;
    return this;
  }
  
  /**
   * Set the frame extracted callback
   * @param {Function} callback - Callback function when a frame is extracted
   * @returns {VideoFrameExtractor} - Returns this for method chaining
   */
  setFrameExtractedCallback(callback) {
    this.onFrameExtracted = callback;
    return this;
  }
  
  /**
   * Set the completion callback
   * @param {Function} callback - Callback function when extraction is complete
   * @returns {VideoFrameExtractor} - Returns this for method chaining
   */
  setCompleteCallback(callback) {
    this.onComplete = callback;
    return this;
  }
  
  /**
   * Fallback method to capture frame when CORS blocks canvas export
   * @param {number} targetTime - Time in seconds to capture
   * @returns {Promise<string>} - Base64 encoded frame
   */
  async fallbackFrameCapture(targetTime) {
    console.log(`Using fallback frame capture at ${targetTime}s`);
    
    // Create a new video element for the fallback
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.style.display = 'none';
    
    // Create a new canvas for the fallback
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        try {
          // Seek to the target time
          tempVideo.currentTime = targetTime;
          
          const onSeeked = () => {
            try {
              // Draw the frame to the canvas
              tempCtx.drawImage(tempVideo, 0, 0, tempCanvas.width, tempCanvas.height);
              
              // Get the data URL
              const frameData = tempCanvas.toDataURL('image/jpeg', this.quality);
              
              // Clean up
              tempVideo.removeEventListener('seeked', onSeeked);
              tempVideo.pause();
              tempVideo.removeAttribute('src');
              tempVideo.load();
              
              resolve(frameData);
            } catch (e) {
              reject(e);
            }
          };
          
          tempVideo.addEventListener('seeked', onSeeked, { once: true });
          
          // Set a timeout in case the seek never completes
          const timeout = setTimeout(() => {
            reject(new Error('Fallback frame capture timed out'));
          }, 5000);
          
          // Clear timeout if seek completes
          tempVideo.addEventListener('seeked', () => clearTimeout(timeout), { once: true });
          
        } catch (e) {
          reject(e);
        }
      };
      
      tempVideo.addEventListener('canplay', onCanPlay, { once: true });
      tempVideo.addEventListener('error', (e) => {
        reject(new Error(`Fallback video error: ${e.message || 'Unknown error'}`));
      }, { once: true });
      
      // Set the video source to the same as the original video
      tempVideo.src = this.video.src;
    });
  }
}

// Create and export a single instance of VideoFrameExtractor
const videoFrameExtractor = new VideoFrameExtractor();

export default videoFrameExtractor;
