/**
 * Main Application Entry Point
 * Initializes and coordinates all components of the dice roller application
 */

class DiceRollerApp {
  constructor() {
    this.sceneManager = null;
    this.physicsEngine = null;
    this.settingsManager = null;
    this.uiController = null;
    this.isInitialized = false;
    this.lastTime = performance.now();
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Check WebGL support
      if (!this.checkWebGLSupport()) {
        this.showError('お使いのブラウザはWebGLをサポートしていません。Chrome、Firefox、Safari、またはEdgeの最新版をご使用ください。');
        return;
      }

      // Initialize settings manager
      this.settingsManager = new SettingsManager();

      // Initialize scene manager
      const container = document.getElementById('canvas-container');
      if (!container) {
        throw new Error('Canvas container not found');
      }

      this.sceneManager = new SceneManager(container);
      this.sceneManager.init();

      // Initialize physics engine
      this.physicsEngine = new PhysicsEngine();
      this.physicsEngine.init();

      // Initialize UI controller
      this.uiController = new UIController(
        this.sceneManager,
        this.physicsEngine,
        this.settingsManager
      );
      this.uiController.init();

      // Register physics update in animation loop
      this.sceneManager.onAnimationFrame(() => {
        this.updatePhysics();
      });

      this.isInitialized = true;
      console.log('Dice Roller Application initialized successfully');

    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.showError('アプリケーションの初期化に失敗しました: ' + error.message);
    }
  }

  /**
   * Check if WebGL is supported by the browser
   * @returns {boolean} True if WebGL is supported
   */
  checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }

  /**
   * Update physics simulation
   */
  updatePhysics() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;

    // Update physics with delta time
    if (this.physicsEngine) {
      this.physicsEngine.update(deltaTime);
    }
  }

  /**
   * Show error message to user
   * @param {string} message - Error message to display
   */
  showError(message) {
    const container = document.getElementById('canvas-container');
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 20px;
          text-align: center;
          color: #fff;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        ">
          <div>
            <h2 style="margin-bottom: 20px;">エラー</h2>
            <p style="font-size: 18px; line-height: 1.6;">${message}</p>
          </div>
        </div>
      `;
    } else {
      alert(message);
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.sceneManager) {
      this.sceneManager.dispose();
    }

    if (this.physicsEngine) {
      this.physicsEngine.dispose();
    }

    this.isInitialized = false;
  }
}

// Global error handler for rendering errors
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error);
  
  // Check if it's a rendering-related error
  if (event.error && (
    event.error.message.includes('WebGL') ||
    event.error.message.includes('THREE') ||
    event.error.message.includes('render')
  )) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 20px;
      border-radius: 10px;
      z-index: 10000;
      max-width: 500px;
      text-align: center;
    `;
    errorDiv.innerHTML = `
      <h3>レンダリングエラー</h3>
      <p>3Dレンダリング中にエラーが発生しました。ページを再読み込みしてください。</p>
      <button onclick="location.reload()" style="
        margin-top: 10px;
        padding: 10px 20px;
        background: white;
        color: #333;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 16px;
      ">再読み込み</button>
    `;
    document.body.appendChild(errorDiv);
  }
});

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new DiceRollerApp();
    app.init();
  });
} else {
  // DOM already loaded
  const app = new DiceRollerApp();
  app.init();
}
