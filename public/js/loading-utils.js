/**
 * LoadingOverlay - Manages the loading overlay UI during file processing
 */
class LoadingOverlay {
  constructor() {
    this.overlay = document.getElementById('loadingOverlay');
    this.title = document.getElementById('loadingTitle');
    this.message = document.getElementById('loadingMessage');
    this.progress = document.getElementById('loadingProgress');
    this.progressText = document.getElementById('loadingProgressText');
    this.status = document.getElementById('loadingStatus');
    this.cancelButton = document.getElementById('cancelProcessing');
    this.onCancel = null;
    this.isVisible = false;

    // Initialize event listeners
    this.cancelButton?.addEventListener('click', () => this.handleCancel());
  }

  /**
   * Show the loading overlay
   * @param {string} title - Title to display
   * @param {string} message - Initial message
   * @param {function} onCancel - Callback when cancel is clicked
   */
  show(title = 'Processing', message = 'Please wait...', onCancel = null) {
    if (this.isVisible) return;
    
    this.title.textContent = title;
    this.message.textContent = message;
    this.onCancel = onCancel;
    this.overlay.classList.remove('hidden');
    this.cancelButton.style.display = onCancel ? 'block' : 'none';
    this.isVisible = true;
    
    // Reset progress
    this.updateProgress(0, 'Starting...');
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  /**
   * Hide the loading overlay
   */
  hide() {
    if (!this.isVisible) return;
    
    this.overlay.classList.add('hidden');
    this.isVisible = false;
    
    // Re-enable body scroll
    document.body.style.overflow = '';
  }

  /**
   * Update progress
   * @param {number} percent - Progress percentage (0-100)
   * @param {string} status - Status message
   */
  updateProgress(percent, status = '') {
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    
    if (this.progress) {
      this.progress.style.width = `${clampedPercent}%`;
      this.progress.setAttribute('aria-valuenow', clampedPercent);
    }
    
    if (this.progressText) {
      this.progressText.textContent = `${clampedPercent}%`;
    }
    
    if (status && this.status) {
      this.status.textContent = status;
    }
  }

  /**
   * Update the loading message
   * @param {string} message - New message to display
   */
  updateMessage(message) {
    if (this.message) {
      this.message.textContent = message;
    }
  }

  /**
   * Handle cancel button click
   */
  handleCancel() {
    if (typeof this.onCancel === 'function') {
      this.onCancel();
    }
    this.hide();
  }
}

// Create a singleton instance
const loadingOverlay = new LoadingOverlay();

export default loadingOverlay;
