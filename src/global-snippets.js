/**
 * Squarespace Global Snippets
 * A powerful system for creating reusable, synchronized content snippets
 * @version 1.0.0
 * @author Your Name
 * @license MIT
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    version: '1.0.0',
    apiBase: '/api/content',
    storageKey: 'globalSnippetsData',
    snippetAttribute: 'data-global-snippet-id',
    snippetVersionAttribute: 'data-global-snippet-version',
    debugMode: false,
    autoSave: true,
    autoSaveDelay: 2000,
    maxVersionHistory: 10
  };

  // Utility functions
  const Utils = {
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    generateId() {
      return 'snippet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    formatDate(date) {
      return new Date(date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    sanitizeSnippetId(id) {
      return id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    },

    log(...args) {
      if (CONFIG.debugMode) {
        console.log('[Global Snippets]', ...args);
      }
    },

    error(...args) {
      console.error('[Global Snippets Error]', ...args);
    }
  };

  // Storage Manager - handles both localStorage and API
  class StorageManager {
    constructor() {
      this.cache = null;
      this.syncInProgress = false;
    }

    async getAllSnippets() {
      if (this.cache) {
        return this.cache;
      }

      try {
        // Try to get from API first
        const apiData = await this.fetchFromAPI();
        if (apiData) {
          this.cache = apiData;
          this.saveToLocalStorage(apiData);
          return apiData;
        }
      } catch (e) {
        Utils.log('API fetch failed, using localStorage', e);
      }

      // Fallback to localStorage
      const localData = this.loadFromLocalStorage();
      this.cache = localData;
      return localData;
    }

    async saveSnippet(snippetId, data) {
      const allSnippets = await this.getAllSnippets();
      
      if (!allSnippets[snippetId]) {
        allSnippets[snippetId] = {
          id: snippetId,
          versions: [],
          currentVersion: 0
        };
      }

      const snippet = allSnippets[snippetId];
      const newVersion = {
        version: snippet.versions.length,
        html: data.html,
        timestamp: new Date().toISOString(),
        author: data.author || 'unknown'
      };

      snippet.versions.push(newVersion);
      snippet.currentVersion = newVersion.version;

      // Keep only last N versions
      if (snippet.versions.length > CONFIG.maxVersionHistory) {
        snippet.versions = snippet.versions.slice(-CONFIG.maxVersionHistory);
      }

      this.cache = allSnippets;
      this.saveToLocalStorage(allSnippets);

      // Async save to API
      this.saveToAPI(allSnippets).catch(e => {
        Utils.error('Failed to save to API', e);
      });

      return newVersion;
    }

    async deleteSnippet(snippetId) {
      const allSnippets = await this.getAllSnippets();
      delete allSnippets[snippetId];
      
      this.cache = allSnippets;
      this.saveToLocalStorage(allSnippets);
      
      await this.saveToAPI(allSnippets);
    }

    async restoreVersion(snippetId, versionNumber) {
      const allSnippets = await this.getAllSnippets();
      const snippet = allSnippets[snippetId];
      
      if (!snippet || !snippet.versions[versionNumber]) {
        throw new Error('Version not found');
      }

      snippet.currentVersion = versionNumber;
      
      this.cache = allSnippets;
      this.saveToLocalStorage(allSnippets);
      await this.saveToAPI(allSnippets);

      return snippet.versions[versionNumber];
    }

    loadFromLocalStorage() {
      try {
        const data = localStorage.getItem(CONFIG.storageKey);
        return data ? JSON.parse(data) : {};
      } catch (e) {
        Utils.error('Failed to load from localStorage', e);
        return {};
      }
    }

    saveToLocalStorage(data) {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
        Utils.log('Saved to localStorage');
      } catch (e) {
        Utils.error('Failed to save to localStorage', e);
      }
    }

    async fetchFromAPI() {
      try {
        // Get CSRF token
        const csrfToken = this.getCsrfToken();
        
        // Fetch from Squarespace collection
        const response = await fetch(`${CONFIG.apiBase}/global-snippets?format=json`, {
          headers: {
            'Accept': 'application/json',
            'X-CSRF-Token': csrfToken
          }
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        Utils.log('Fetched from API', data);
        
        // Parse the data structure from Squarespace
        return this.parseAPIResponse(data);
      } catch (e) {
        Utils.log('API fetch error', e);
        return null;
      }
    }

    async saveToAPI(data) {
      if (this.syncInProgress) {
        Utils.log('Sync already in progress, skipping');
        return;
      }

      this.syncInProgress = true;

      try {
        const csrfToken = this.getCsrfToken();
        
        const response = await fetch(`${CONFIG.apiBase}/global-snippets`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({
            snippets: data,
            timestamp: new Date().toISOString()
          })
        });

        if (!response.ok) {
          throw new Error(`API save failed: ${response.status}`);
        }

        Utils.log('Saved to API successfully');
      } catch (e) {
        Utils.error('Failed to save to API', e);
        throw e;
      } finally {
        this.syncInProgress = false;
      }
    }

    parseAPIResponse(data) {
      // Parse Squarespace API response into our format
      if (data && data.items) {
        const snippets = {};
        data.items.forEach(item => {
          if (item.customContent) {
            try {
              const parsed = JSON.parse(item.customContent);
              snippets[item.id] = parsed;
            } catch (e) {
              Utils.error('Failed to parse snippet data', e);
            }
          }
        });
        return snippets;
      }
      return data || {};
    }

    getCsrfToken() {
      const name = 'crumb=';
      const decodedCookie = decodeURIComponent(document.cookie);
      const ca = decodedCookie.split(';');
      
      for (let c of ca) {
        c = c.trim();
        if (c.indexOf(name) === 0) {
          return c.substring(name.length);
        }
      }
      return '';
    }
  }

  // UI Manager - handles all UI components
  class UIManager {
    constructor(snippetManager) {
      this.snippetManager = snippetManager;
      this.controlPanel = null;
      this.selectedElement = null;
    }

    init() {
      this.injectStyles();
      this.createControlPanel();
      this.setupSelectionHandler();
      this.markExistingSnippets();
    }

    injectStyles() {
      const style = document.createElement('style');
      style.id = 'global-snippets-styles';
      style.textContent = `
        /* Global Snippet Indicators */
        [${CONFIG.snippetAttribute}] {
          position: relative;
          outline: 2px dashed #FF6B6B !important;
          outline-offset: 4px;
        }
        
        [${CONFIG.snippetAttribute}]::before {
          content: '✂️ GLOBAL: ' attr(${CONFIG.snippetAttribute});
          position: absolute;
          top: -24px;
          left: 0;
          background: #FF6B6B;
          color: white;
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 4px 4px 0 0;
          z-index: 1000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        [${CONFIG.snippetAttribute}]:hover::before {
          background: #EE5A52;
        }
        
    /* Control Panel */
    .global-snippets-panel {
      position: fixed;
      top: 80px;
      right: 20px;
      width: 380px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-height: calc(100vh - 100px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .global-snippets-panel.minimized {
      width: 60px;
      height: 60px;
      cursor: pointer;
    }

    .global-snippets-panel.minimized .panel-content {
      display: none;
    }

    .panel-header {
      background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
      user-select: none;
    }

    .global-snippets-panel.minimized .panel-header {
      padding: 18px;
      justify-content: center;
      cursor: pointer;
    }

    /* Make minimize button more visible when minimized */
    .global-snippets-panel.minimized .panel-btn {
      width: 100%;
      height: 100%;
      font-size: 24px;
      background: transparent;
    }

    .panel-title {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .global-snippets-panel.minimized .panel-title {
      display: none;
    }

    .panel-actions {
      display: flex;
      gap: 8px;
    }

    .global-snippets-panel.minimized .panel-actions {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      gap: 0;
    }

        .panel-btn {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .panel-btn:hover {
          background: rgba(255,255,255,0.3);
          transform: scale(1.05);
        }

        .panel-content {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
        }

        /* Form Elements */
        .form-group {
          margin-bottom: 16px;
        }

        .form-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
        }

        .form-input {
          width: 100%;
          padding: 10px 12px;
          border: 1.5px solid #e5e7eb;
          border-radius: 8px;
          font-size: 14px;
          transition: all 0.2s;
          box-sizing: border-box;
        }

        .form-input:focus {
          outline: none;
          border-color: #FF6B6B;
          box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.1);
        }

        .form-textarea {
          min-height: 100px;
          resize: vertical;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
        }

        /* Buttons */
        .btn {
          width: 100%;
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-primary {
          background: linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%);
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
        }

        .btn-secondary {
          background: #f3f4f6;
          color: #374151;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #e5e7eb;
        }

        .btn-danger {
          background: #ef4444;
          color: white;
        }

        .btn-danger:hover:not(:disabled) {
          background: #dc2626;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }

        .btn-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 12px;
        }

        /* Snippet List */
        .snippets-list {
          margin-top: 20px;
        }

        .snippets-list-header {
          font-size: 13px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .snippet-count {
          background: #FF6B6B;
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }

        .snippet-item {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
          transition: all 0.2s;
        }

        .snippet-item:hover {
          border-color: #FF6B6B;
          box-shadow: 0 2px 8px rgba(255, 107, 107, 0.1);
        }

        .snippet-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .snippet-item-id {
          font-size: 13px;
          font-weight: 600;
          color: #111827;
          font-family: 'Monaco', monospace;
        }

        .snippet-item-meta {
          font-size: 11px;
          color: #6b7280;
        }

        .snippet-item-actions {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }

        .snippet-item-btn {
          flex: 1;
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: 500;
        }

        .snippet-item-btn.view {
          background: #fee2e2;
          color: #dc2626;
        }

        .snippet-item-btn.view:hover {
          background: #fecaca;
        }

        .snippet-item-btn.delete {
          background: #fee2e2;
          color: #dc2626;
        }

        .snippet-item-btn.delete:hover {
          background: #fecaca;
        }

        /* Version History */
        .version-history {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e5e7eb;
        }

        .version-history-title {
          font-size: 12px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 8px;
        }

        .version-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          margin-bottom: 4px;
          font-size: 11px;
        }

        .version-item.current {
          background: #ecfdf5;
          border-color: #10b981;
        }

        .version-item-info {
          color: #6b7280;
        }

        .version-item-btn {
          padding: 4px 10px;
          background: #FF6B6B;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
          font-weight: 500;
        }

        .version-item-btn:hover {
          background: #EE5A52;
        }

        /* Empty State */
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #9ca3af;
        }

        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }

        .empty-state-text {
          font-size: 14px;
          line-height: 1.6;
        }

        /* Status Messages */
        .status-message {
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .status-message.success {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #10b981;
        }

        .status-message.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #ef4444;
        }

        .status-message.info {
          background: #eff6ff;
          color: #1e40af;
          border: 1px solid #3b82f6;
        }

        /* Selection Indicator */
        .selection-indicator {
          position: absolute;
          pointer-events: none;
          border: 3px solid #FF6B6B;
          background: rgba(255, 107, 107, 0.1);
          z-index: 9999;
          transition: all 0.15s ease;
          box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.2);
        }

        /* Tabs */
        .tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
          border-bottom: 2px solid #e5e7eb;
        }

        .tab {
          padding: 10px 16px;
          border: none;
          background: none;
          color: #6b7280;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          transition: all 0.2s;
        }

        .tab:hover {
          color: #374151;
        }

        .tab.active {
          color: #FF6B6B;
          border-bottom-color: #FF6B6B;
        }

        .tab-content {
          display: none;
        }

        .tab-content.active {
          display: block;
        }

        /* Scrollbar */
        .panel-content::-webkit-scrollbar {
          width: 6px;
        }

        .panel-content::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        .panel-content::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }

        .panel-content::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `;
      document.head.appendChild(style);
    }

    createControlPanel() {
      const panel = document.createElement('div');
      panel.className = 'global-snippets-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <div class="panel-title">
            <span>✂️</span>
            <span>Global Snippets</span>
          </div>
          <div class="panel-actions">
            <button class="panel-btn" id="minimize-panel" title="Minimize">−</button>
            <button class="panel-btn" id="help-panel" title="Help">?</button>
          </div>
        </div>
        <div class="panel-content">
          <div class="tabs">
            <button class="tab active" data-tab="create">Create</button>
            <button class="tab" data-tab="manage">Manage</button>
            <button class="tab" data-tab="settings">Settings</button>
          </div>

          <!-- Create Tab -->
          <div class="tab-content active" data-tab="create">
            <div id="status-message"></div>
            
            <div class="form-group">
              <label class="form-label">Snippet ID</label>
              <input type="text" class="form-input" id="snippet-id-input" placeholder="e.g., site-header">
              <small style="color: #6b7280; font-size: 11px; margin-top: 4px; display: block;">
                Use lowercase letters, numbers, and hyphens
              </small>
            </div>

            <div class="form-group">
              <label class="form-label">Selected Element</label>
              <div style="padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; color: #6b7280;">
                <span id="selected-element-info">Click on any block to select it</span>
              </div>
            </div>

            <button class="btn btn-primary" id="create-global-snippet">
              <span>✨</span>
              Create Global Snippet
            </button>

            <div class="btn-group">
              <button class="btn btn-secondary" id="sync-all-snippets">
                🔄 Sync All
              </button>
              <button class="btn btn-secondary" id="import-export">
                📦 Import/Export
              </button>
            </div>
          </div>

          <!-- Manage Tab -->
          <div class="tab-content" data-tab="manage">
            <div class="snippets-list" id="snippets-list">
              <div class="empty-state">
                <div class="empty-state-icon">✂️</div>
                <div class="empty-state-text">
                  No global snippets yet.<br>
                  Create your first snippet in the Create tab.
                </div>
              </div>
            </div>
          </div>

          <!-- Settings Tab -->
          <div class="tab-content" data-tab="settings">
            <div class="form-group">
              <label class="form-label">
                <input type="checkbox" id="auto-save-toggle" ${CONFIG.autoSave ? 'checked' : ''}>
                Auto-save changes
              </label>
            </div>

            <div class="form-group">
              <label class="form-label">
                <input type="checkbox" id="debug-mode-toggle" ${CONFIG.debugMode ? 'checked' : ''}>
                Debug mode
              </label>
            </div>

            <div class="form-group">
              <label class="form-label">Version History Limit</label>
              <input type="number" class="form-input" id="version-limit" value="${CONFIG.maxVersionHistory}" min="1" max="50">
            </div>

            <button class="btn btn-danger" id="clear-all-data">
              🗑️ Clear All Data
            </button>

            <div style="margin-top: 20px; padding: 12px; background: #f9fafb; border-radius: 8px; font-size: 11px; color: #6b7280;">
              <strong>Version:</strong> ${CONFIG.version}<br>
              <strong>Storage:</strong> <span id="storage-info">Loading...</span>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(panel);
      this.controlPanel = panel;

      this.attachEventListeners();
      this.makePanelDraggable();
      this.updateStorageInfo();
    }

    attachEventListeners() {
      // Tab switching
      this.controlPanel.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tabName = e.target.dataset.tab;
          this.switchTab(tabName);
        });
      });
    
      // Minimize/Maximize toggle
      const minimizeBtn = document.getElementById('minimize-panel');
      minimizeBtn.addEventListener('click', () => {
        this.controlPanel.classList.toggle('minimized');
        // Update button text
        if (this.controlPanel.classList.contains('minimized')) {
          minimizeBtn.textContent = '+';
          minimizeBtn.title = 'Maximize';
        } else {
          minimizeBtn.textContent = '−';
          minimizeBtn.title = 'Minimize';
        }
      });
      
      // Help
      document.getElementById('help-panel').addEventListener('click', () => {
        this.showHelp();
      });

      // Create global snippet
      document.getElementById('create-global-snippet').addEventListener('click', () => {
        this.createGlobalSnippet();
      });

      // Sync all
      document.getElementById('sync-all-snippets').addEventListener('click', () => {
        this.syncAllSnippets();
      });

      // Import/Export
      document.getElementById('import-export').addEventListener('click', () => {
        this.showImportExport();
      });

      // Settings
      document.getElementById('auto-save-toggle').addEventListener('change', (e) => {
        CONFIG.autoSave = e.target.checked;
        this.showStatus('Settings saved', 'success');
      });

      document.getElementById('debug-mode-toggle').addEventListener('change', (e) => {
        CONFIG.debugMode = e.target.checked;
        this.showStatus('Debug mode ' + (CONFIG.debugMode ? 'enabled' : 'disabled'), 'info');
      });

      document.getElementById('version-limit').addEventListener('change', (e) => {
        CONFIG.maxVersionHistory = parseInt(e.target.value);
        this.showStatus('Version limit updated', 'success');
      });

      // Clear all data
      document.getElementById('clear-all-data').addEventListener('click', () => {
        this.clearAllData();
      });
    }

    setupSelectionHandler() {
      let indicator = null;

      document.addEventListener('mouseover', (e) => {
        if (this.controlPanel.contains(e.target)) return;

        const element = e.target;
        
        // Check if it's a valid block
        if (!this.isValidBlock(element)) {
          if (indicator) {
            indicator.remove();
            indicator = null;
          }
          return;
        }

        // Create or update indicator
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'selection-indicator';
          document.body.appendChild(indicator);
        }

        const rect = element.getBoundingClientRect();
        indicator.style.left = rect.left + 'px';
        indicator.style.top = rect.top + 'px';
        indicator.style.width = rect.width + 'px';
        indicator.style.height = rect.height + 'px';
      });

      document.addEventListener('click', (e) => {
        if (this.controlPanel.contains(e.target)) return;

        const element = e.target;
        
        if (this.isValidBlock(element)) {
          this.selectedElement = element;
          this.updateSelectedElementInfo(element);
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }

    isValidBlock(element) {
      return element.classList.contains('sqs-block') ||
             element.classList.contains('code-block') ||
             element.classList.contains('html-block') ||
             element.classList.contains('markdown-block') ||
             element.classList.contains('summary-block');
    }

    updateSelectedElementInfo(element) {
      const info = document.getElementById('selected-element-info');
      const blockType = Array.from(element.classList)
        .find(c => c.includes('block'))
        ?.replace('sqs-block-', '')
        ?.replace('-', ' ') || 'unknown';
      
      info.innerHTML = `
        <strong>Selected:</strong> ${blockType}<br>
        <small style="font-family: monospace;">${element.className.split(' ').slice(0, 3).join(' ')}</small>
      `;
    }

    async createGlobalSnippet() {
      const snippetIdInput = document.getElementById('snippet-id-input');
      const snippetId = Utils.sanitizeSnippetId(snippetIdInput.value.trim());

      if (!snippetId) {
        this.showStatus('Please enter a snippet ID', 'error');
        return;
      }

      if (!this.selectedElement) {
        this.showStatus('Please select a block first', 'error');
        return;
      }

      try {
        // Mark the element
        this.selectedElement.setAttribute(CONFIG.snippetAttribute, snippetId);

        // Save to storage
        await this.snippetManager.storage.saveSnippet(snippetId, {
          html: this.selectedElement.innerHTML,
          author: 'current-user'
        });

        this.showStatus(`Global snippet "${snippetId}" created successfully!`, 'success');
        snippetIdInput.value = '';
        this.selectedElement = null;
        document.getElementById('selected-element-info').textContent = 'Click on any block to select it';
        
        // Refresh the manage tab
        this.updateSnippetsList();
      } catch (error) {
        this.showStatus('Failed to create global snippet: ' + error.message, 'error');
        Utils.error('Create snippet error', error);
      }
    }

    async syncAllSnippets() {
      try {
        const elements = document.querySelectorAll(`[${CONFIG.snippetAttribute}]`);
        let count = 0;

        for (const element of elements) {
          const snippetId = element.getAttribute(CONFIG.snippetAttribute);
          await this.snippetManager.storage.saveSnippet(snippetId, {
            html: element.innerHTML,
            author: 'current-user'
          });
          count++;
        }

        this.showStatus(`Synced ${count} snippets successfully!`, 'success');
        this.updateSnippetsList();
      } catch (error) {
        this.showStatus('Failed to sync snippets: ' + error.message, 'error');
      }
    }

    async updateSnippetsList() {
      const listContainer = document.getElementById('snippets-list');
      const snippets = await this.snippetManager.storage.getAllSnippets();
      const snippetIds = Object.keys(snippets);

      if (snippetIds.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">✂️</div>
            <div class="empty-state-text">
              No global snippets yet.<br>
              Create your first snippet in the Create tab.
            </div>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = `
        <div class="snippets-list-header">
          Global Snippets
          <span class="snippet-count">${snippetIds.length}</span>
        </div>
        ${snippetIds.map(snippetId => this.renderSnippetItem(snippetId, snippets[snippetId])).join('')}
      `;

      // Attach event listeners for snippet actions
      snippetIds.forEach(snippetId => {
        const viewBtn = listContainer.querySelector(`[data-action="view"][data-snippet="${snippetId}"]`);
        const deleteBtn = listContainer.querySelector(`[data-action="delete"][data-snippet="${snippetId}"]`);

        if (viewBtn) {
          viewBtn.addEventListener('click', () => this.viewSnippetVersions(snippetId));
        }

        if (deleteBtn) {
          deleteBtn.addEventListener('click', () => this.deleteSnippet(snippetId));
        }
      });
    }

    renderSnippetItem(snippetId, snippetData) {
      const currentVersion = snippetData.versions[snippetData.currentVersion];
      const timestamp = currentVersion ? Utils.formatDate(currentVersion.timestamp) : 'Unknown';
      const versionCount = snippetData.versions.length;

      return `
        <div class="snippet-item">
          <div class="snippet-item-header">
            <div class="snippet-item-id">${snippetId}</div>
          </div>
          <div class="snippet-item-meta">
            ${versionCount} version${versionCount !== 1 ? 's' : ''} · Last updated: ${timestamp}
          </div>
          <div class="snippet-item-actions">
            <button class="snippet-item-btn view" data-action="view" data-snippet="${snippetId}">
              👁️ View Versions
            </button>
            <button class="snippet-item-btn delete" data-action="delete" data-snippet="${snippetId}">
              🗑️ Delete
            </button>
          </div>
        </div>
      `;
    }

    async viewSnippetVersions(snippetId) {
      const snippets = await this.snippetManager.storage.getAllSnippets();
      const snippetData = snippets[snippetId];

      if (!snippetData) return;

      const versionsHtml = snippetData.versions.map((version, index) => {
        const isCurrent = index === snippetData.currentVersion;
        return `
          <div class="version-item ${isCurrent ? 'current' : ''}">
            <div class="version-item-info">
              v${version.version} · ${Utils.formatDate(version.timestamp)}
              ${isCurrent ? ' (current)' : ''}
            </div>
            ${!isCurrent ? `
              <button class="version-item-btn" onclick="window.globalSnippetsUI.restoreVersion('${snippetId}', ${index})">
                Restore
              </button>
            ` : ''}
          </div>
        `;
      }).reverse().join('');

      const listContainer = document.getElementById('snippets-list');
      listContainer.innerHTML = `
        <button class="btn btn-secondary" onclick="window.globalSnippetsUI.updateSnippetsList()" style="margin-bottom: 16px;">
          ← Back to List
        </button>
        <div class="snippet-item">
          <div class="snippet-item-header">
            <div class="snippet-item-id">${snippetId}</div>
          </div>
          <div class="version-history">
            <div class="version-history-title">Version History</div>
            ${versionsHtml}
          </div>
        </div>
      `;
    }

    async restoreVersion(snippetId, versionNumber) {
      if (!confirm('Restore this version? This will create a new version based on the selected one.')) {
        return;
      }

      try {
        await this.snippetManager.storage.restoreVersion(snippetId, versionNumber);
        this.showStatus('Version restored successfully!', 'success');
        this.viewSnippetVersions(snippetId);
        
        // Update all instances on the page
        this.snippetManager.renderSnippet(snippetId);
      } catch (error) {
        this.showStatus('Failed to restore version: ' + error.message, 'error');
      }
    }

    async deleteSnippet(snippetId) {
      if (!confirm(`Delete global snippet "${snippetId}"? This cannot be undone.`)) {
        return;
      }

      try {
        await this.snippetManager.storage.deleteSnippet(snippetId);
        
        // Remove attribute from elements
        document.querySelectorAll(`[${CONFIG.snippetAttribute}="${snippetId}"]`).forEach(el => {
          el.removeAttribute(CONFIG.snippetAttribute);
        });

        this.showStatus(`Snippet "${snippetId}" deleted successfully!`, 'success');
        this.updateSnippetsList();
      } catch (error) {
        this.showStatus('Failed to delete snippet: ' + error.message, 'error');
      }
    }

    async clearAllData() {
      if (!confirm('Clear ALL global snippets and data? This cannot be undone!')) {
        return;
      }

      if (!confirm('Are you absolutely sure? This will delete everything.')) {
        return;
      }

      try {
        localStorage.removeItem(CONFIG.storageKey);
        
        document.querySelectorAll(`[${CONFIG.snippetAttribute}]`).forEach(el => {
          el.removeAttribute(CONFIG.snippetAttribute);
        });

        this.snippetManager.storage.cache = {};
        
        this.showStatus('All data cleared', 'success');
        this.updateSnippetsList();
        this.updateStorageInfo();
      } catch (error) {
        this.showStatus('Failed to clear data: ' + error.message, 'error');
      }
    }

    showImportExport() {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000000;
      `;

      modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 600px; width: 90%;">
          <h3 style="margin: 0 0 20px 0; font-size: 18px;">Import/Export Data</h3>
          
          <div style="margin-bottom: 20px;">
            <button class="btn btn-secondary" id="export-btn" style="margin-bottom: 10px;">
              📥 Export All Snippets
            </button>
            <div id="export-output" style="display: none; margin-top: 10px;">
              <textarea class="form-textarea" id="export-data" readonly style="height: 200px;"></textarea>
              <button class="btn btn-secondary" id="copy-export" style="margin-top: 10px;">
                📋 Copy to Clipboard
              </button>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <label class="form-label">Import Data (paste JSON)</label>
            <textarea class="form-textarea" id="import-data" placeholder="Paste exported data here..." style="height: 200px;"></textarea>
            <button class="btn btn-primary" id="import-btn" style="margin-top: 10px;">
              📤 Import Snippets
            </button>
          </div>

          <button class="btn btn-secondary" id="close-modal">Close</button>
        </div>
      `;

      document.body.appendChild(modal);

      // Export
      document.getElementById('export-btn').addEventListener('click', async () => {
        const snippets = await this.snippetManager.storage.getAllSnippets();
        const exportData = JSON.stringify(snippets, null, 2);
        document.getElementById('export-data').value = exportData;
        document.getElementById('export-output').style.display = 'block';
      });

      document.getElementById('copy-export').addEventListener('click', () => {
        const textarea = document.getElementById('export-data');
        textarea.select();
        document.execCommand('copy');
        this.showStatus('Copied to clipboard!', 'success');
      });

      // Import
      document.getElementById('import-btn').addEventListener('click', async () => {
        const importData = document.getElementById('import-data').value;
        
        try {
          const snippets = JSON.parse(importData);
          
          if (!confirm('This will merge imported snippets with existing ones. Continue?')) {
            return;
          }

          const currentSnippets = await this.snippetManager.storage.getAllSnippets();
          const mergedSnippets = { ...currentSnippets, ...snippets };
          
          this.snippetManager.storage.cache = mergedSnippets;
          this.snippetManager.storage.saveToLocalStorage(mergedSnippets);
          await this.snippetManager.storage.saveToAPI(mergedSnippets);

          this.showStatus('Import successful!', 'success');
          this.updateSnippetsList();
          modal.remove();
        } catch (error) {
          this.showStatus('Invalid import data: ' + error.message, 'error');
        }
      });

      // Close
      document.getElementById('close-modal').addEventListener('click', () => {
        modal.remove();
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }

    showHelp() {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000000;
        overflow-y: auto;
      `;

      modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 700px; width: 90%; max-height: 90vh; overflow-y: auto;">
          <h2 style="margin: 0 0 20px 0;">📚 Global Snippets Help</h2>
          
          <h3>🎯 How to Create a Global Snippet</h3>
          <ol style="line-height: 1.8;">
            <li>Click on any content block in your editor</li>
            <li>Enter a unique ID (e.g., "site-header")</li>
            <li>Click "Create Global Snippet"</li>
          </ol>

          <h3>🔄 How to Use Global Snippets</h3>
          <p>On any page where you want the global content to appear:</p>
          <ol style="line-height: 1.8;">
            <li>Add a Code Block</li>
            <li>Paste: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">&lt;div data-global-snippet-id="your-snippet-id"&gt;&lt;/div&gt;</code></li>
            <li>The content will automatically sync!</li>
          </ol>

          <h3>📝 Version History</h3>
          <p>Every time you save changes, a new version is created. You can:</p>
          <ul style="line-height: 1.8;">
            <li>View all versions in the Manage tab</li>
            <li>Restore previous versions</li>
            <li>Keep up to ${CONFIG.maxVersionHistory} versions per snippet</li>
          </ul>

          <h3>💾 Data Storage</h3>
          <p>Your global snippets are stored in:</p>
          <ul style="line-height: 1.8;">
            <li>Browser localStorage (instant access)</li>
            <li>Squarespace API (synced across devices)</li>
          </ul>

          <h3>🔗 GitHub Repository</h3>
          <p>For updates, documentation, and support:</p>
          <p><a href="https://github.com/yourusername/squarespace-global-snippets" target="_blank" style="color: #FF6B6B;">github.com/yourusername/squarespace-global-snippets</a></p>

          <button class="btn btn-primary" onclick="this.closest('div').parentElement.remove()" style="margin-top: 20px;">
            Got it!
          </button>
        </div>
      `;

      document.body.appendChild(modal);
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }

    switchTab(tabName) {
      // Update tabs
      this.controlPanel.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });

      // Update content
      this.controlPanel.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.dataset.tab === tabName);
      });

      // Refresh content if switching to manage tab
      if (tabName === 'manage') {
        this.updateSnippetsList();
      }
    }

    showStatus(message, type = 'info') {
      const statusEl = document.getElementById('status-message');
      const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️'
      };

      statusEl.className = `status-message ${type}`;
      statusEl.innerHTML = `${icons[type]} ${message}`;

      setTimeout(() => {
        statusEl.className = '';
        statusEl.innerHTML = '';
      }, 5000);
    }

    async updateStorageInfo() {
      const infoEl = document.getElementById('storage-info');
      if (!infoEl) return;

      try {
        const snippets = await this.snippetManager.storage.getAllSnippets();
        const dataSize = new Blob([JSON.stringify(snippets)]).size;
        const sizeKB = (dataSize / 1024).toFixed(2);
        
        infoEl.textContent = `${sizeKB} KB · ${Object.keys(snippets).length} snippets`;
      } catch (e) {
        infoEl.textContent = 'Error loading info';
      }
    }

    markExistingSnippets() {
      this.snippetManager.storage.getAllSnippets().then(snippets => {
        Object.keys(snippets).forEach(snippetId => {
          const elements = document.querySelectorAll(`[${CONFIG.snippetAttribute}="${snippetId}"]`);
          Utils.log(`Found ${elements.length} instances of snippet: ${snippetId}`);
        });
      });
    }

    makePanelDraggable() {
      const panel = this.controlPanel;
      const header = panel.querySelector('.panel-header');
      
      let isDragging = false;
      let currentX;
      let currentY;
      let initialX;
      let initialY;
      let xOffset = 0;
      let yOffset = 0;

      header.addEventListener('mousedown', dragStart);
      document.addEventListener('mousemove', drag);
      document.addEventListener('mouseup', dragEnd);

      function dragStart(e) {
        if (e.target.closest('.panel-btn')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
          isDragging = true;
        }
      }

      function drag(e) {
        if (isDragging) {
          e.preventDefault();
          
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;

          xOffset = currentX;
          yOffset = currentY;

          setTranslate(currentX, currentY, panel);
        }
      }

      function dragEnd() {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
      }

      function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(${xPos}px, ${yPos}px)`;
      }
    }
  }

  // Snippet Manager - main controller
  class SnippetManager {
    constructor() {
      this.storage = new StorageManager();
      this.ui = null;
      this.isEditor = window.location !== window.parent.location;
      this.autoSaveTimeout = null;
    }

    async init() {
      Utils.log('Initializing Global Snippets Manager');

      if (this.isEditor) {
        // Wait for Squarespace editor to load
        await this.waitForEditor();
        
        // Initialize UI
        this.ui = new UIManager(this);
        this.ui.init();

        // Make UI accessible globally for inline event handlers
        window.globalSnippetsUI = this.ui;

        // Setup auto-save
        if (CONFIG.autoSave) {
          this.setupAutoSave();
        }

        Utils.log('Editor mode initialized');
      } else {
        // Render snippets on live site
        await this.renderAllSnippets();
        Utils.log('Live site mode initialized');
      }
    }

    async waitForEditor() {
      return new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve);
        }
      });
    }

    async renderAllSnippets() {
      const snippets = await this.storage.getAllSnippets();
      
      Object.keys(snippets).forEach(snippetId => {
        this.renderSnippet(snippetId);
      });
    }

    async renderSnippet(snippetId) {
      const snippets = await this.storage.getAllSnippets();
      const snippetData = snippets[snippetId];
      
      if (!snippetData) {
        Utils.error(`Snippet not found: ${snippetId}`);
        return;
      }

      const currentVersion = snippetData.versions[snippetData.currentVersion];
      
      if (!currentVersion) {
        Utils.error(`No version data for snippet: ${snippetId}`);
        return;
      }

      const elements = document.querySelectorAll(`[${CONFIG.snippetAttribute}="${snippetId}"]`);
      
      elements.forEach(element => {
        element.innerHTML = currentVersion.html;
        element.setAttribute(CONFIG.snippetVersionAttribute, currentVersion.version);
        Utils.log(`Rendered snippet: ${snippetId} v${currentVersion.version}`);
      });
    }

    setupAutoSave() {
      const debouncedSave = Utils.debounce(async (snippetId, element) => {
        try {
          await this.storage.saveSnippet(snippetId, {
            html: element.innerHTML,
            author: 'auto-save'
          });
          Utils.log(`Auto-saved: ${snippetId}`);
        } catch (e) {
          Utils.error('Auto-save failed', e);
        }
      }, CONFIG.autoSaveDelay);

      // Observe changes to global snippets
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          const element = mutation.target;
          const snippetId = element.getAttribute?.(CONFIG.snippetAttribute);
          
          if (snippetId) {
            debouncedSave(snippetId, element);
          }
        });
      });

      // Start observing
      setTimeout(() => {
        document.querySelectorAll(`[${CONFIG.snippetAttribute}]`).forEach(element => {
          observer.observe(element, {
            childList: true,
            subtree: true,
            characterData: true
          });
        });
      }, 1000);
    }
  }

  // Initialize
  function initGlobalSnippets() {
    const manager = new SnippetManager();
    manager.init().catch(error => {
      Utils.error('Initialization failed', error);
    });

    // Make manager accessible globally for debugging
    if (CONFIG.debugMode) {
      window.globalSnippetsManager = manager;
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalSnippets);
  } else {
    initGlobalSnippets();
  }

})();
