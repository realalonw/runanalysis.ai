/**
 * Simple and reliable video frame extractor
 * Extracts frames from videos for preview and analysis
 */
class VideoFrameExtractor {
  constructor() {
    this.frames = [];
    this.previewFrames = [];
    this.frameRate = 2; // 2fps for preview
    this.maxDuration = 30; // 30 seconds max
    this.isProcessing = false;
    this.currentVideo = null;
    this.currentCanvas = null;
    this.currentCtx = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.isProcessing = false;
    
    if (this.currentVideo) {
      this.currentVideo.pause();
      this.currentVideo.src = '';
      this.currentVideo.load();
      this.currentVideo = null;
    }
    
    if (this.currentCanvas) {
      this.currentCanvas.width = 0;
      this.currentCanvas.height = 0;
      this.currentCanvas = null;
      this.currentCtx = null;
    }
    
    this.frames = [];
    this.previewFrames = [];
  }

  /**
   * Format seconds to MM:SS format
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Load video and get metadata
   */
  loadVideo(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        const duration = Math.min(video.duration, this.maxDuration);
        const totalFrames = Math.min(
          Math.ceil(duration * this.frameRate),
          this.frameRate * this.maxDuration
        );
        
        if (totalFrames <= 0) {
          reject(new Error('Invalid video duration or frame count'));
          return;
        }
        
        // Set up canvas for frame extraction
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const aspectRatio = video.videoWidth / video.videoHeight;
        
        // Use reasonable dimensions for thumbnails
        const targetWidth = 320;
        canvas.width = targetWidth;
        canvas.height = Math.round(targetWidth / aspectRatio);
        
        resolve({ 
          video, 
          canvas, 
          ctx, 
          duration, 
          totalFrames,
          aspectRatio
        });
      };
      
      video.onerror = () => {
        reject(new Error('Failed to load video'));
      };
      
      video.src = URL.createObjectURL(file);
    });
  }

  /**
   * Seek video to a specific time
   */
  seekVideo(video, time) {
    return new Promise((resolve) => {
      if (video.currentTime === time || Math.abs(video.currentTime - time) < 0.1) {
        resolve();
        return;
      }
      
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = time;
    });
  }

  /**
   * Extract frames from video
   */
  async extractFrames(file) {
    if (this.isProcessing) {
      throw new Error('Extraction already in progress');
    }

    this.isProcessing = true;
    this.frames = [];
    this.previewFrames = [];
    
    try {
      // Load video and get metadata
      const { video, canvas, ctx, duration, totalFrames } = await this.loadVideo(file);
      
      // Store references for cleanup
      this.currentVideo = video;
      this.currentCanvas = canvas;
      this.currentCtx = ctx;
      
      const timeBetweenFrames = duration / totalFrames;
      
      // Process each frame
      for (let i = 0; i < totalFrames; i++) {
        if (!this.isProcessing) break;
        
        const time = Math.min(i * timeBetweenFrames, duration - 0.1);
        console.log(`Extracting frame ${i + 1}/${totalFrames} at ${time.toFixed(2)}s`);
        
        try {
          // Seek to the target time
          await this.seekVideo(video, time);
          
          // Draw frame to canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Skip empty frames
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const isEmpty = !imageData.some(channel => channel !== 0);
          
          if (isEmpty) {
            console.warn(`Empty frame at ${time.toFixed(2)}s, skipping...`);
            continue;
          }
          
          // Get the image data URL for preview
          const imageUrl = canvas.toDataURL('image/jpeg', 0.8);
          const frameData = {
            url: imageUrl,
            time: time,
            timestamp: this.formatTime(time)
          };
          
          // Add to preview frames
          this.previewFrames.push(frameData);
          
          // Convert canvas to blob for upload
          const blob = await new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.9);
          });
          
          if (blob) {
            const frameFile = new File(
              [blob],
              `frame_${i.toString().padStart(4, '0')}.jpg`,
              { type: 'image/jpeg' }
            );
            this.frames.push(frameFile);
          }
          
          // Update progress
          if (this.onProgress) {
            this.onProgress({
              current: i + 1,
              total: totalFrames,
              time: time.toFixed(2)
            });
          }
          
          // Small delay to prevent UI freeze
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          console.error(`Error extracting frame ${i}:`, error);
          continue; // Skip to next frame on error
        }
      }
      
      // Notify completion
      if (this.onComplete) {
        this.onComplete(this.previewFrames);
      }
      
      return this.previewFrames;
      
    } catch (error) {
      console.error('Error in extractFrames:', error);
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    } finally {
      this.cleanup();
    }
  }
  
  /**
   * Set progress callback
   */
  setProgressCallback(callback) {
    this.onProgress = callback;
    return this; // Enable method chaining
  }
  
  /**
   * Set completion callback
   */
  setCompleteCallback(callback) {
    this.onComplete = callback;
    return this; // Enable method chaining
  }
  
  /**
   * Set error callback
   */
  setErrorCallback(callback) {
    this.onError = callback;
    return this; // Enable method chaining
  }
}

export default VideoFrameExtractor;
