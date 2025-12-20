/**
 * Settings Manager
 * Manages user settings and LocalStorage persistence for dice configurations
 */

class SettingsManager {
  constructor() {
    this.storageKey = 'd6FaceValues';
  }

  /**
   * Save face values
   * @param {string[]} values - Array of face values
   */
  saveFaceValues(values) {
    try {
      if (!Array.isArray(values) || values.length !== 6) {
        console.warn('Invalid face values array. Expected length 6.');
        return;
      }

      localStorage.setItem(this.storageKey, JSON.stringify(values));
    } catch (error) {
      console.error('Failed to save face values to LocalStorage:', error);
    }
  }

  /**
   * Load face values
   * @returns {string[]} - Array of face values, or default values if not found
   */
  loadFaceValues() {
    try {
      const stored = localStorage.getItem(this.storageKey);

      if (stored) {
        const values = JSON.parse(stored);
        
        if (Array.isArray(values) && values.length === 6) {
          return values;
        }
      }

      // Return default if not found or invalid
      return this.getDefaultFaceValues();
    } catch (error) {
      console.error('Failed to load face values from LocalStorage:', error);
      return this.getDefaultFaceValues();
    }
  }

  /**
   * Get default face values
   * @returns {string[]} - Array of default face values (numeric indices)
   */
  getDefaultFaceValues() {
    return ['1', '2', '3', '4', '5', '6'];
  }

  /**
   * Clear all settings from LocalStorage
   */
  clearAllSettings() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('Failed to clear settings from LocalStorage:', error);
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsManager;
}
