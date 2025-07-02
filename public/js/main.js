// ==============================================
// Global Variables
// ==============================================
import loadingOverlay from './loading-utils.js';
import frameExtractor from './video-utils.js'; // Import the pre-initialized instance
let isProcessing = false; // Track if we're currently processing a file
let currentProcessing = {
  promise: null,
  controller: null,
  type: null // 'upload' or 'analysis'
};

// ==============================================
// Utility Functions
// ==============================================

/**
 * Shows a notification message to the user
 * @param {string} type - Type of notification ('success', 'error', or default 'info')
 * @param {string} title - Title of the notification
 * @param {string} message - Message content
 * @param {number} [duration=5000] - How long to show the notification in ms
 * @returns {HTMLElement} The created notification element
 */
function showNotification(type, title, message, duration = 5000) {
  const container = document.getElementById('notificationContainer');
  if (!container) return null;
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  // Set icon based on type
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  
  notification.innerHTML = `
    <span class="notification-icon">${icon}</span>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
  `;
  
  container.appendChild(notification);
  
  // Trigger animation
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Auto-remove notification after duration
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => container.removeChild(notification), 300);
  }, duration);
  
  return notification;
}

/**
 * Checks if user has provided an email
 * @returns {boolean} True if email exists in localStorage
 */
function hasProvidedEmail() {
  return localStorage.getItem('userEmail') !== null;
}

/**
 * Shows or hides the email modal
 * @param {boolean} [show=true] - Whether to show or hide the modal
 */
function showEmailModal(show = true) {
  const modal = document.getElementById('emailModal');
  if (!modal) return;
  
  if (show) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // Focus the email input when modal is shown
    const emailInput = modal.querySelector('input[type="email"]');
    if (emailInput) setTimeout(() => emailInput.focus(), 100);
  } else {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

/**
 * Validates an email address format
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

/**
 * Handles email form submission
 * @param {Event} event - Form submission event
 */
function handleEmailSubmit(event) {
  event.preventDefault();
  
  const emailInput = document.getElementById('email');
  const emailError = document.getElementById('emailError');
  const email = emailInput.value.trim();
  
  // Validate email
  if (!isValidEmail(email)) {
    emailError.textContent = 'Please enter a valid email address';
    emailError.classList.remove('hidden');
    emailInput.focus();
    return;
  }
  
  // Store email in localStorage
  localStorage.setItem('userEmail', email);
  
  // Hide modal
  showEmailModal(false);
  
  // Show success message
  showNotification('success', 'Welcome!', `You're logged in as ${email}`);
}

/**
 * Initializes the email form with event listeners
 */
function initEmailForm() {
  const emailForm = document.getElementById('emailForm');
  if (!emailForm) return;
  
  emailForm.addEventListener('submit', handleEmailSubmit);
  
  // Also handle the submit button click for better compatibility
  const submitButton = emailForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.onclick = (e) => {
      e.preventDefault();
      handleEmailSubmit(e);
    };
  }
}

// ==============================================
// Utility Functions
// ==============================================

/**
 * Converts a base64 data URL to a Blob
 * @param {string} dataURL - The base64 data URL to convert
 * @returns {Blob} The converted Blob
 */
function dataURLtoBlob(dataURL) {
  try {
    // Extract the base64 data from the data URL
    const byteString = atob(dataURL.split(',')[1]);
    
    // Get the MIME type from the data URL
    const mimeType = dataURL.split(',')[0].split(':')[1].split(';')[0];
    
    // Convert the base64 data to an ArrayBuffer
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    // Create and return a Blob from the ArrayBuffer
    return new Blob([ab], { type: mimeType });
  } catch (error) {
    console.error('Error converting data URL to Blob:', error);
    // Fallback: Create a Blob with empty data
    return new Blob([], { type: 'image/jpeg' });
  }
}

/**
 * Formats file size in bytes to a human-readable string
 * @param {number} bytes - File size in bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted file size (e.g., "1.5 MB")
 */
function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ==============================================
// Progress Tracking
// ==============================================

// Global variables for tracking upload progress and speed
const uploadState = {
  startTime: 0,
  lastUploaded: 0,
  lastTime: 0,
  speedSamples: [],
  MAX_SAMPLES: 5,
  reset: function() {
    this.startTime = 0;
    this.lastUploaded = 0;
    this.lastTime = 0;
    this.speedSamples = [];
  }
};

/**
 * Formats bytes into a human-readable string
 * @param {number} bytes - Number of bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted string with unit (e.g., "1.5 MB")
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Calculates the current upload speed in Mbps
 * @param {number} loaded - Bytes loaded so far
 * @param {number} total - Total bytes to load
 * @param {number} currentTime - Current timestamp
 * @returns {number} Speed in Mbps
 */
function calculateSpeed(loaded, total, currentTime) {
  // Initialize timing on first call
  if (!uploadState.startTime) uploadState.startTime = currentTime;
  if (!uploadState.lastTime) uploadState.lastTime = currentTime;
  
  const timeDiff = (currentTime - uploadState.lastTime) / 1000; // Convert to seconds
  if (timeDiff <= 0) return 0;
  
  // Calculate current speed
  const bytesPerSecond = (loaded - uploadState.lastUploaded) / timeDiff;
  const mbps = (bytesPerSecond * 8) / (1024 * 1024); // Convert to Mbps
  
  // Store speed sample for averaging
  uploadState.speedSamples.push(mbps);
  if (uploadState.speedSamples.length > uploadState.MAX_SAMPLES) {
    uploadState.speedSamples.shift();
  }
  
  // Calculate average speed from samples
  const avgSpeed = uploadState.speedSamples.length > 0
    ? uploadState.speedSamples.reduce((a, b) => a + b, 0) / uploadState.speedSamples.length
    : 0;
  
  // Update state for next calculation
  uploadState.lastUploaded = loaded;
  uploadState.lastTime = currentTime;
  
  return Math.max(0, avgSpeed); // Ensure non-negative speed
}

// ==============================================
// Error Handling
// ==============================================

/**
 * Shows an error preview in the UI
 * @param {string} message - The error message to display
 */
function showErrorPreview(message) {
  if (!previewContainer) return;
  
  // Create error message element
  const errorDiv = document.createElement('div');
  errorDiv.className = 'p-4 bg-red-50 border border-red-200 rounded-lg text-red-700';
  errorDiv.innerHTML = `
    <div class="flex items-center">
      <svg class="w-5 h-5 mr-2 text-red-500" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
      </svg>
      <span>${message}</span>
    </div>
  `;
  
  // Clear and show error
  previewContainer.innerHTML = '';
  previewContainer.appendChild(errorDiv);
  previewContainer.classList.remove('hidden');
}

// ==============================================
// Preview Functions
// ==============================================

/**
 * Shows a preview of the selected image file
 * @param {File} file - The image file to preview
 */
function showImagePreview(file) {
  try {
    const url = URL.createObjectURL(file);
    // Ensure preview container exists
    let container = document.getElementById('previewContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'previewContainer';
      document.getElementById('uploadSection').appendChild(container);
    }

    container.innerHTML = `
      <div class="mt-4">
        <img src="${url}" alt="Image preview" class="max-w-full h-auto rounded-lg shadow" />
      </div>
    `;

    // Revoke URL once image is loaded to free memory
    const img = container.querySelector('img');
    if (img) {
      img.onload = () => {
        URL.revokeObjectURL(url);
      };
    }
  } catch (err) {
    console.error('Error showing image preview:', err);
  }
}



/**
 * Shows a preview of the selected video file
 * @param {File} file - The video file to preview
 */
function showVideoPreview(file) {
  console.log('showVideoPreview called with file:', {
    name: file.name,
    type: file.type,
    size: file.size
  });
  
  if (!previewContainer) {
    console.error('Preview container not found');
    return;
  }

  // Clear any existing previews
  previewContainer.innerHTML = '';
  
  // Create a container for the video
  const container = document.createElement('div');
  container.className = 'video-preview-container';
  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.maxWidth = '800px';
  container.style.margin = '0 auto';
  container.style.backgroundColor = '#000';
  container.style.borderRadius = '8px';
  container.style.overflow = 'hidden';
  
  // Create the video element
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.style.width = '100%';
  video.style.display = 'block';
  
  // Create object URL for the video file
  const videoUrl = URL.createObjectURL(file);
  console.log('Created video URL:', videoUrl);
  
  // Set up error handling
  video.onerror = function(e) {
    console.error('Video error:', {
      code: video.error ? video.error.code : 'unknown',
      message: video.error ? video.error.message : 'No error message',
      networkState: video.networkState,
      readyState: video.readyState,
      currentSrc: video.currentSrc
    });
    showErrorPreview('This video format is not supported for preview');
  };
  
  // Set the video source
  video.src = videoUrl;
  
  // Add a source element with proper MIME type
  const source = document.createElement('source');
  source.src = videoUrl;
  
  // Try to determine the MIME type from the file extension
  const ext = file.name.split('.').pop().toLowerCase();
  const mimeTypes = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogg': 'video/ogg',
    'mov': 'video/quicktime',
    'm4v': 'video/x-m4v',
    'avi': 'video/x-msvideo',
    'wmv': 'video/x-ms-wmv'
  };
  
  if (mimeTypes[ext]) {
    source.type = mimeTypes[ext];
  } else if (file.type && file.type !== 'application/octet-stream') {
    source.type = file.type;
  }
  
  // Clear any existing sources and add the new one
  while (video.firstChild) {
    video.removeChild(video.firstChild);
  }
  video.appendChild(source);
  
  // Add video to the container
  container.appendChild(video);
  previewContainer.appendChild(container);
  previewContainer.classList.remove('hidden');
  
  // Handle cleanup when the video is closed or the page is unloaded
  const cleanup = () => {
    if (videoUrl) {
      console.log('Cleaning up video URL');
      URL.revokeObjectURL(videoUrl);
    }
  };
  
  // Clean up when the video is removed from the DOM
  const observer = new MutationObserver(() => {
    if (!document.body.contains(video)) {
      cleanup();
      observer.disconnect();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Also clean up when the page is unloaded
  window.addEventListener('beforeunload', cleanup);
  
  console.log('Video preview setup complete');
  
  // Set a timeout to check if the video loaded correctly
  const errorTimeout = setTimeout(() => {
    // Only log if there's actually an issue
    if (video.readyState === 0 && document.body.contains(video) && !video.error) {
      console.log('Video is still loading...');
      
      // Try one more time with a direct source set if still not loaded
      if (video.readyState === 0) {
        console.log('Attempting direct source set...');
        const tempUrl = URL.createObjectURL(file);
        video.src = tempUrl;
        video.load();
        
        // Clean up the temporary URL after a delay
        setTimeout(() => {
          if (video.readyState > 0) {
            console.log('Direct source set successful, cleaning up temp URL');
            URL.revokeObjectURL(tempUrl);
          } else {
            console.log('Video still not loaded after direct source set');
          }
        }, 1000);
      }
    }
  }, 3000); // Wait 3 seconds before checking
  
  // Clear the timeout if the video loads successfully
  video.addEventListener('loadeddata', () => {
    clearTimeout(errorTimeout);
  }, { once: true });
  
  // Set the video source and let the browser handle loading
  console.log('Video element setup complete, waiting for browser to load metadata...');
}

// ==============================================
// UI Update Functions
// ==============================================

/**
 * Updates the progress bar with smooth animations and status message
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} [message=''] - Status message to display
 */
function updateProgress(percent, message = '') {
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressContainer = document.getElementById('progressContainer');
  
  // Validate elements exist
  if (!progressBar || !progressText || !progressPercent || !progressContainer) {
    console.error('Progress elements not found');
    return;
  }
  
  // Clamp progress between 0 and 100
  const progress = Math.min(100, Math.max(0, percent));

  // Hide the progress container when progress is 0 or below to avoid misleading UI
  if (progress <= 0) {
    // Ensure bar is reset visually
    progressBar.style.transform = 'translateX(-100%)';
    progressBar.classList.remove('animate-pulse');

    // Clear any existing text
    if (progressText && progressText.children[0]) {
      progressText.children[0].textContent = '';
    }
    if (progressPercent) {
      progressPercent.textContent = '';
    }

    // Hide the container and exit early
    if (!progressContainer.classList.contains('hidden')) {
      progressContainer.classList.add('hidden');
    }
    return;
  }

  // Show the progress container if it's hidden
  if (progressContainer.classList.contains('hidden')) {
    progressContainer.classList.remove('hidden');
  }
  const translateX = 100 - progress;
  
  // Update progress bar with smooth animation
  progressBar.style.transform = `translateX(-${translateX}%)`;
  progressBar.setAttribute('data-progress', progress);
  
  // Update progress bar color based on percentage
  progressBar.className = 'absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out transform';
  
  if (progress < 30) {
    progressBar.classList.add('bg-gradient-to-r', 'from-blue-500', 'via-blue-600', 'to-blue-500');
  } else if (progress < 70) {
    progressBar.className = 'absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out transform';
    progressBar.classList.add('bg-gradient-to-r', 'from-yellow-500', 'via-yellow-600', 'to-yellow-500');
  } else {
    progressBar.className = 'absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out transform';
    progressBar.classList.add('bg-gradient-to-r', 'from-green-500', 'via-green-600', 'to-green-500');
  }
  
  // Add pulse animation when complete
  if (progress >= 100) {
    progressBar.classList.add('animate-pulse');
  } else {
    progressBar.classList.remove('animate-pulse');
  }
  
  // Update progress text
  if (progressText && progressText.children[0]) {
    if (percent < 100) {
      progressText.children[0].textContent = message || 'Uploading...';
    } else {
      progressText.children[0].textContent = message || 'Upload complete!';
    }
  }
  
  // Update percentage
  if (progressPercent) {
    progressPercent.textContent = `${Math.round(percent)}%`;
  }
}

/**
 * Resets all progress tracking state
 */
function resetProgressTracking() {
  uploadState.reset();
  
  // Reset UI elements
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressContainer = document.getElementById('progressContainer');
  
  if (progressBar) {
    progressBar.style.transform = 'translateX(-100%)';
    progressBar.className = 'absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out transform';
    progressBar.classList.add('bg-gradient-to-r', 'from-blue-500', 'via-blue-600', 'to-blue-500');
  }
  
  if (progressText && progressText.children[0]) {
    progressText.children[0].textContent = 'Ready to upload';
  }
  
  if (progressPercent) {
    progressPercent.textContent = '0%';
  }
  
  if (progressContainer) {
    progressContainer.classList.add('hidden');
  }
}

// Global references to DOM elements
let analyzeBtn;
let previewContainer;
let preview;
let fileInput;
let fileInfo;
let fileName;
let fileSize;

document.addEventListener('DOMContentLoaded', async () => {
  // VideoFrameExtractor is already imported and initialized
  // Initialize email form
  initEmailForm();

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  fileInput = document.getElementById('fileInput');
  fileInfo = document.getElementById('fileInfo');
  fileName = document.getElementById('fileName');
  fileSize = document.getElementById('fileSize');
  const removeFileBtn = document.getElementById('removeFile');
  previewContainer = document.getElementById('previewContainer');
  preview = document.getElementById('preview');
  analyzeBtn = document.getElementById('analyzeBtn');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const resultsSection = document.getElementById('resultsSection');
  const analysisResults = document.getElementById('analysisResults');
  const uploadSection = document.getElementById('uploadSection');
  const newAnalysisBtn = document.getElementById('newAnalysisBtn');

  let currentFile = null;

  /**
   * Clears file-related state and UI
   */
  function clearFileState() {
    console.log('Clearing file state');
    // Clear any existing previews
    if (preview) {
      preview.src = '';
      preview.alt = '';
    }
    
    // Reset file info display
    if (fileInfo) {
      fileInfo.classList.add('hidden');
    }
    
    // Reset any progress indicators
    updateProgress(0, 'Ready to analyze');
    
    // Clear any existing frames
    const frameContainer = document.getElementById('frameThumbnails');
    if (frameContainer) {
      frameContainer.innerHTML = '';
    }
    
    // Reset any file-related state
    currentFile = null;
    fileToAnalyze = null;
    framesToAnalyze = [];
    
    console.log('File state cleared');
  }

  /**
   * Resets the file input and clears the file selection
   */
  function resetFileInput() {
    console.log('Resetting file input and UI state');
    
    // Clear the file input
    if (fileInput) {
      try {
        fileInput.value = '';
      } catch (e) {
        console.warn('Error resetting file input:', e);
      }
    }
    
    // Reset file tracking variables
    currentFile = null;
    extractedFrames = [];
    currentFrameIndex = 0;
    isUploading = false;
    
    // Reset UI elements
    if (fileInfo) fileInfo.classList.add('hidden');
    if (previewContainer) {
      previewContainer.classList.add('hidden');
      previewContainer.innerHTML = '';
    }
    
    // Reset analyze button state
    updateAnalyzeButton(false, 'Select a file to analyze');
    
    // Reset dropzone styling
    if (dropzone) {
      dropzone.classList.remove('border-red-500', 'bg-red-50');
      dropzone.classList.add('border-gray-300', 'hover:border-blue-500');
    }
    
    console.log('File input reset complete');
  }
  
  // Event Listeners
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);
  removeFileBtn.addEventListener('click', resetFileInput);
  
  // Store file references at module level
  let fileToAnalyze = null;
  let framesToAnalyze = [];
  
  /**
   * Updates the analyze button state
   * @param {boolean} isEnabled - Whether the button should be enabled
   * @param {string} [text] - Optional button text to set
   */
  function updateAnalyzeButton(isEnabled, text) {
    if (analyzeBtn) {
      analyzeBtn.disabled = !isEnabled;
      if (text !== undefined) {
        analyzeBtn.textContent = text;
      }
      analyzeBtn.classList.toggle('opacity-50', !isEnabled);
      analyzeBtn.classList.toggle('cursor-not-allowed', !isEnabled);
      analyzeBtn.classList.toggle('hover:bg-blue-600', isEnabled);
    }
  }

  // Handle analyze button click
  analyzeBtn.addEventListener('click', async () => {
    if (isUploading) {
      console.log('Upload in progress, ignoring analyze click');
      return;
    }
    
    console.log('=== Analyze button clicked ===');
    console.log('Current file reference:', currentFile);
    
    // Debug: Log the current state of the file input
    console.log('File input files:', fileInput.files);
    
    // Verify the file still exists in the input
    if (fileInput.files && fileInput.files.length > 0) {
      console.log('File still exists in input:', fileInput.files[0]);
    } else {
      console.warn('No files in file input!');
    }
    
    // First check if we have a file selected
    if (!currentFile && (!extractedFrames || extractedFrames.length === 0)) {
      const errorMsg = 'No file selected for analysis';
      console.error(errorMsg);
      showNotification('error', 'No File', 'Please select a file to analyze');
      return;
    }
    
    // Store current file references
    fileToAnalyze = currentFile;
    framesToAnalyze = [...(extractedFrames || [])];
    
    console.log('=== Stored file references for analysis ===');
    console.log('File:', fileToAnalyze ? {
      name: fileToAnalyze.name,
      type: fileToAnalyze.type,
      size: fileToAnalyze.size,
      lastModified: fileToAnalyze.lastModified,
      isFile: fileToAnalyze instanceof File,
      isBlob: fileToAnalyze instanceof Blob,
      constructor: fileToAnalyze.constructor.name
    } : 'No file');
    console.log('Frames:', framesToAnalyze.length);
    
    // Verify the file is still accessible
    if (fileToAnalyze) {
      try {
        const fileSize = fileToAnalyze.size;
        console.log('File size verified:', fileSize, 'bytes');
      } catch (e) {
        console.error('Error accessing file properties:', e);
      }
    }
    
    // Then check if we need to collect email
    if (!hasProvidedEmail()) {
      console.log('Email required, showing modal');
      showEmailModal();
      
      // Set up email form submission
      const modalForm = document.getElementById('emailForm');
      
      // Override the default form submission
      if (modalForm) {
        modalForm.onsubmit = async (e) => {
          e.preventDefault();
          const emailInput = document.getElementById('email');
          const emailError = document.getElementById('emailError');
          const email = emailInput.value.trim();
          
          if (!isValidEmail(email)) {
            emailError.textContent = 'Please enter a valid email address';
            emailError.classList.remove('hidden');
            return false;
          }
          
          // Store email
          localStorage.setItem('userEmail', email);
          showEmailModal(false);
          
          // Restore file references and start analysis
          console.log('Email submitted, restoring file references');
          currentFile = fileToAnalyze;
          extractedFrames = framesToAnalyze;
          
          if (!currentFile && (!extractedFrames || extractedFrames.length === 0)) {
            showNotification('error', 'File Error', 'No file selected for analysis');
            return false;
          }
          
          try {
            await analyzeFile();
          } catch (error) {
            console.error('Error in analyzeFile:', error);
            showNotification('error', 'Analysis Error', error.message || 'An error occurred during analysis');
          }
          return false;
        };
      }
    } else {
      // We have email and file, proceed with analysis
      console.log('Email already provided, starting analysis');
      try {
        await analyzeFile();
      } catch (error) {
        console.error('Error in analyzeFile:', error);
        showNotification('error', 'Analysis Error', error.message || 'An error occurred during analysis');
      }
    }
  });
  
  newAnalysisBtn.addEventListener('click', resetAnalysis);

  // Functions
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }

  /**
   * Handles the selected file and prepares it for analysis
   * @param {File} file - The file to handle
   */
  async function handleFile(file) {
    try {
      // Clear any previous file state
      clearFileState();
      
      // Set the new current file
      currentFile = file;
      console.log('File selected:', file.name, 'Type:', file.type, 'Size:', file.size);
      
      // Update UI to show file info
      fileName.textContent = file.name;
      fileSize.textContent = formatFileSize(file.size);
      fileInfo.classList.remove('hidden');
      
      // Enable analyze button once file is ready
      updateAnalyzeButton(true, 'Analyze File');
      
      // Show preview based on file type
      if (file.type.startsWith('image/')) {
        showImagePreview(file);
      } else if (file.type.startsWith('video/')) {
        showVideoPreview(file);
        // Process video to extract frames
        try {
          await processVideoFile(file);
        } catch (error) {
          console.error('Error processing video:', error);
          showNotification('error', 'Video Processing Error', 'Could not process video. Please try another file.');
          resetFileInput();
          return;
        }
      } else {
        // For non-previewable files, show a file icon
        previewContainer.classList.remove('hidden');
        preview.innerHTML = `
          <div class="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg">
            <svg class="h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p class="mt-2 text-sm text-gray-600">Preview not available for ${file.name.split('.').pop().toUpperCase()} files</p>
          </div>
        `;
      }
      
      // Enable analyze button
      analyzeBtn.disabled = false;
      
      // Show success notification
      showNotification('success', 'File Ready', `${file.name} is ready for analysis`, 3000);
      
    } catch (error) {
      console.error('Error handling file:', error);
      showNotification('error', 'Error', 'Could not process the selected file. Please try again.');
      resetFileInput();
    }
  }

  // Track extracted frames and video state
  let extractedFrames = [];
  let currentVideoFile = null;
  let currentFrameIndex = 0;
  
  // Track upload state
  let isUploading = false;
  // frameExtractor is already declared at the top level
  let totalFrames = 0;
  let videoDuration = 0;
  let frameThumbnails = [];
  
  /**
   * Process a video file by extracting frames for analysis
   * @param {File} file - The video file to process
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<Array<Blob>>} Array of extracted frame blobs
   */
  async function processVideoFile(file, signal) {
    console.log('Processing video file:', file.name, 'Size:', file.size, 'Type:', file.type);
    
    // Set uploading state
    isUploading = true;
    updateAnalyzeButton(false, 'Processing Video...');
    
    try {
      // Reset frame extractor
      frameExtractor.cleanup();
      frameExtractor.reset();
      
      // Reset frame tracking
      extractedFrames = [];
      currentFrameIndex = 0;
      
      // Create a promise that resolves when frame extraction is complete
      return new Promise((resolve, reject) => {
        // Set up progress handler
        frameExtractor.onProgress = (progress) => {
          const percent = Math.round((progress.current / progress.total) * 100);
          const status = `Extracting frames: ${progress.current} of ${progress.total} (${percent}%)`;
          console.log(status);
          loadingOverlay.updateProgress(percent * 0.6, status); // First 60% of progress is for extraction
        };
        
        // Set up error handler
        frameExtractor.onError = (error) => {
          console.error('Frame extraction error:', error);
          isUploading = false;
          loadingOverlay.hide();
          updateAnalyzeButton(true, 'Analyze File');
          reject(new Error(`Frame extraction failed: ${error.message}`));
        };
        
        // Set up completion handler
        frameExtractor.onComplete = (frames) => {
          console.log(`Extracted ${frames.length} frames`);
          isUploading = false;
          loadingOverlay.updateProgress(60, 'Frame extraction complete!');
          updateAnalyzeButton(true, 'Analyze File'); // Re-enable the button
          resolve(frames);
        };
        
        if (signal) {
          signal.addEventListener('abort', () => {
            frameExtractor.cancel();
            isUploading = false;
            loadingOverlay.hide();
            updateAnalyzeButton(true, 'Analyze File');
            reject(new Error('Frame extraction cancelled'));
          }, { once: true });
        }
        
        // Start the frame extraction at 2 FPS with 30s cap
        console.log('Starting frame extraction at 2 FPS (max 30s)...');
        loadingOverlay.updateProgress(0, 'Starting frame extraction...');
        
        frameExtractor.extractFrames(file).catch(error => {
          if (error.message !== 'Frame extraction cancelled') {
            console.error('Frame extraction error:', error);
            isUploading = false;
            loadingOverlay.hide();
            updateAnalyzeButton(true, 'Analyze File');
            reject(error);
          }
        });
      });
    } catch (error) {
      isUploading = false;
      updateAnalyzeButton(true, 'Analyze File');
      throw error;
    }
  }

  /**
   * Analyze the currently selected file or extracted video frames
   * Sends the file (or first selected frame) to the server and displays results
   */
  async function analyzeFile() {
    // If already processing, don't start another analysis
    if (isProcessing) {
      console.log('Analysis already in progress');
      return;
    }

    // Create a new AbortController for this analysis
    const controller = new AbortController();
    const signal = controller.signal;
    
    try {
      isProcessing = true;
      currentProcessing = {
        promise: null,
        controller,
        type: 'analysis'
      };

      if (!currentFile) {
        throw new Error('No file selected for analysis');
      }

      // Show loading overlay
      loadingOverlay.show(
        'Analyzing File',
        'Preparing your file for analysis...',
        () => {
          // Cancel handler
          controller.abort('Analysis cancelled by user');
          loadingOverlay.hide();
          isProcessing = false;
          setAnalysisState('empty');
        }
      );

      // Determine endpoint based on file type
      const isVideo = currentFile.type && currentFile.type.startsWith('video');
      const endpoint = isVideo ? '/api/analyze-video' : '/api/analyze';
      let formData;
      
      // Process file (extract frames if video) and upload
      if (isVideo) {
        loadingOverlay.updateMessage('Extracting frames from video...');
        
        // Process video and get frames
        const frames = await processVideoFile(currentFile);
        
        // Build form data with frames
        formData = new FormData();
        const totalFrames = frames.length;
        let uploadedFrames = 0;
        const uploadStartTime = Date.now();
        const uploadPhaseWeight = 0.3; // 30% of total progress for upload
        const extractionPhaseWeight = 0.6; // 60% of total progress for extraction
        
        // Add each frame to form data with progress updates
        for (let i = 0; i < frames.length; i++) {
          if (signal.aborted) throw new Error('Analysis cancelled');
          
          let frameBlob;
          if (typeof frames[i] === 'string' && frames[i].startsWith('data:')) {
            // Convert base64 data URL to Blob
            frameBlob = dataURLtoBlob(frames[i]);
          } else if (frames[i] instanceof Blob) {
            // Already a Blob, use as is
            frameBlob = frames[i];
          } else {
            console.warn('Unknown frame format at index', i, 'skipping');
            continue;
          }
          
          formData.append('frames', frameBlob, `frame_${i}.jpg`);
          uploadedFrames++;
          
          // Calculate upload progress (60-90% of total progress)
          const uploadProgress = Math.round((uploadedFrames / totalFrames) * 100 * uploadPhaseWeight);
          const totalProgress = Math.min(90, extractionPhaseWeight * 100 + uploadProgress);
          
          // Calculate ETA
          const elapsed = (Date.now() - uploadStartTime) / 1000; // seconds
          const framesPerSecond = uploadedFrames / Math.max(0.1, elapsed);
          const remainingFrames = totalFrames - uploadedFrames;
          const remainingTime = Math.ceil(remainingFrames / framesPerSecond);
          const minutes = Math.floor(remainingTime / 60);
          const seconds = remainingTime % 60;
          
          // Update progress with ETA
          const message = `Uploading frame ${uploadedFrames} of ${totalFrames} ` +
                         `(${minutes > 0 ? `${minutes}m ` : ''}${seconds}s remaining)`;
          
          loadingOverlay.updateProgress(totalProgress, message);
          
          // Small delay to allow UI to update
          if (i % 3 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      } else {
        // For non-video files, just add the file directly
        formData = new FormData();
        formData.append('file', currentFile, currentFile.name || 'file');
        loadingOverlay.updateProgress(30, 'Uploading file...');
      }

      // Upload for analysis (final 10% of progress)
      loadingOverlay.updateProgress(90, 'Sending to AI for analysis...');
      
      // Add a small delay to ensure the progress updates are visible
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal // Pass the abort signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Server responded with ${response.status}`);
      }

      const resultJson = await response.json();
      console.log('Analysis Result:', resultJson);

      // Update UI with results
      loadingOverlay.updateProgress(100, 'Analysis complete!');
      await new Promise(resolve => setTimeout(resolve, 500)); // Show 100% briefly
      
      // Display results in UI
      showResults(resultJson.analysis || JSON.stringify(resultJson));
      setAnalysisState('results');
      loadingOverlay.hide();
      
      showNotification('success', 'Analysis Complete', 'Your analysis results are ready.');
      
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'Analysis cancelled') {
        console.log('Analysis was cancelled');
        showNotification('info', 'Analysis Cancelled', 'The analysis was cancelled.');
      } else {
        console.error('Error analyzing file:', error);
        showErrorPreview(error.message || 'Error analyzing file');
        showNotification('error', 'Analysis Error', error.message || 'Error analyzing file');
      }
      setAnalysisState('empty');
      loadingOverlay.hide();
      throw error; // Re-throw for upstream handlers if needed
    } finally {
      isProcessing = false;
      currentProcessing = { promise: null, controller: null, type: null };
    }
  }

  /**
   * Resets the analysis state and UI
   */
  function resetAnalysis() {
    console.log('Resetting analysis state');

    // Reset progress tracking
    resetProgressTracking();

    // Clean up frame extractor if it exists
    if (frameExtractor) {
      frameExtractor.cleanup();
    }

    // Clear any existing previews
    const previewSection = document.getElementById('previewSection');
    if (previewSection) {
      previewSection.innerHTML = '';
    }

    // Reset file input
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
      fileInput.value = '';
    }

    // Reset extracted frames
    extractedFrames = [];
    currentFrameIndex = 0;

    // Reset analysis state
    setAnalysisState('idle');

    // Hide results section if visible
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
      resultsSection.classList.add('hidden');
    }
    
    // Clear any notifications safely
    const notifications = document.querySelectorAll('.notification');
    notifications.forEach(notification => {
      try {
        if (notification && notification.parentNode) {
          notification.remove();
        }
      } catch (e) {
        console.error('Error removing notification:', e);
      }
    });
    
    console.log('Analysis reset complete');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setAnalysisState(state, progress = 0, message = '') {
    const loadingEl = document.getElementById('analysisLoading');
    const resultsEl = document.getElementById('analysisResults');
    const emptyEl = document.getElementById('analysisEmpty');
    const progressBar = document.getElementById('analysisProgressBar');
    const progressText = document.getElementById('analysisProgressText');
    const tips = [
      'Processing may take a few moments depending on file size',
      'Our AI is carefully analyzing your content',
      'Almost there! Finalizing your analysis',
      'This usually takes about 10-30 seconds',
      'Sit back while we work our magic'
    ];
    
    // Update progress bar and text if provided
    if (progress > 0) {
      progressBar.style.width = `${Math.min(progress, 100)}%`;
      
      // Update progress text with percentage
      if (progress < 30) {
        progressText.textContent = 'Uploading file...';
      } else if (progress < 70) {
        progressText.textContent = 'Processing with AI...';
      } else {
        progressText.textContent = 'Finalizing analysis...';
      }
      
      // Show a random tip every 10% progress
      if (progress % 10 === 0) {
        const tipElement = document.getElementById('analysisTip');
        if (tipElement) {
          tipElement.textContent = tips[Math.floor(Math.random() * tips.length)];
        }
      }
    }
    
    // Update message if provided
    if (message) {
      progressText.textContent = message;
    }
    
    // Hide all states first
    loadingEl.classList.add('hidden');
    resultsEl.classList.add('hidden');
    emptyEl.classList.add('hidden');
    
    // Show the appropriate state
    if (state === 'loading') {
      loadingEl.classList.remove('hidden');
      // Reset progress when starting new analysis
      if (progress === 0) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Starting analysis...';
      }
    } else if (state === 'results') {
      resultsEl.classList.remove('hidden');
    } else {
      emptyEl.classList.remove('hidden');
    }
  }
  
  function showResults(analysis) {
    // Hide upload section and show results section
    uploadSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    document.getElementById('newAnalysisBtn').classList.remove('hidden');
    
    // Show loading state initially
    setAnalysisState('loading');
    
    // Simulate analysis delay for better UX
    setTimeout(() => {
      const analysisContent = document.getElementById('analysisContent');
      analysisContent.innerHTML = '';
      
      if (analysis) {
        let displayText = '';
        if (typeof analysis === 'string') {
          displayText = analysis;
        } else if (typeof analysis === 'object') {
          // Pretty-print JSON result
          displayText = JSON.stringify(analysis, null, 2);
        } else {
          displayText = String(analysis);
        }

        // Split by double newline for paragraph formatting if text, else show in pre tag
        if (displayText.includes('\n')) {
          const paragraphs = displayText.split(/\n\n+/);
          paragraphs.forEach(para => {
            if (para.trim()) {
              const p = document.createElement('p');
              p.className = 'mb-4 text-gray-700 whitespace-pre-wrap';
              p.textContent = para.trim();
              analysisContent.appendChild(p);
            }
          });
        } else {
          const pre = document.createElement('pre');
          pre.className = 'whitespace-pre-wrap text-gray-700';
          pre.textContent = displayText;
          analysisContent.appendChild(pre);
        }

        // Show results
        setAnalysisState('results');
      } else {
        // No analysis available
        setAnalysisState('empty');
      }
      
      // Scroll to results
      resultsSection.scrollIntoView({ behavior: 'smooth' });
    }, 1000); // Simulated delay for analysis visualization
  }
});
