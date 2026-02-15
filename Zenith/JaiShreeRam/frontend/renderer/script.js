// CodeEditor initialized at the end of file
// document.addEventListener('DOMContentLoaded', () => {
//     window.codeEditor = new CodeEditor();
// });

class CodeEditor {
    constructor() {
        this.editor = null;
        this.currentFile = null;
        this.workspacePath = null;
        this.fileTree = {};
        this.tabs = new Map();
        this.activeTab = null;
        this.aiPanelVisible = true;
        this.terminalVisible = false;
        this.aiChatHistory = [];
        this.renameContext = null;
        this.fileWatchers = new Map();
        this.fileSystemWatchers = new Map();
        this.autoSaveEnabled = true;
        this.isWindows = navigator.platform.indexOf('Win') > -1;

        this.isWindows = navigator.platform.indexOf('Win') > -1;
        this.pendingEdits = []; // Store edits for review
        this.diffEditor = null; // Monaco Diff Editor instance

        this.currentMode = 'chat'; // 'chat' or 'agent'
        this.init();
    }

    async init() {
        await this.loadMonacoEditor();
        this.setupEventListeners();
        this.setupActivityBar();
        this.setupElectronHandlers();
        this.setupDefaultWorkspace();
        this.checkBackendHealth();
        this.setupAutoSave();
        this.setupFileSystemWatchers();
        this.setupExtensionsSearch();
        this.setupLivePreview();
        this.setupResizers();
        this.setupTerminal();
    }

    setupResizers() {
        // Sidebar Resizer (Drag right edge of sidebar)
        this.initResizer('resizer-sidebar', (dx, dy) => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                const newWidth = Math.max(150, Math.min(600, sidebar.offsetWidth + dx));
                sidebar.style.width = `${newWidth}px`;
                sidebar.style.flex = `0 0 ${newWidth}px`; // Important for flex container
            }
        });

        // AI Panel Resizer (Drag left edge of AI panel)
        this.initResizer('resizer-ai', (dx, dy) => {
            const aiPanel = document.getElementById('ai-panel');
            if (aiPanel) {
                // Dragging left means dx is negative, so width increases
                const newWidth = Math.max(250, Math.min(600, aiPanel.offsetWidth - dx));
                aiPanel.style.width = `${newWidth}px`;
                aiPanel.style.flex = `0 0 ${newWidth}px`;
            }
        });

        // Terminal Resizer (Drag top edge of terminal)
        this.initResizer('resizer-terminal', (dx, dy) => {
            const terminal = document.getElementById('terminal-panel');
            if (terminal) {
                // Dragging up means dy is negative, so height increases
                const newHeight = Math.max(100, Math.min(600, terminal.offsetHeight - dy));
                terminal.style.height = `${newHeight}px`;
                // Terminal might be flex-grow, so we might need to set explicit height
            }
        });

        // Live Preview Resizer (Drag between editor and preview)
        this.initResizer('resizer-preview', (dx, dy) => {
            const editorContainer = document.getElementById('editor-container-inner');
            if (editorContainer) {
                // Dragging right increases editor width
                const newWidth = Math.max(200, editorContainer.offsetWidth + dx);
                editorContainer.style.flex = `0 0 ${newWidth}px`;
            }
        });
    }

    initResizer(id, callback) {
        const resizer = document.getElementById(id);
        if (!resizer) return;

        let startX, startY;
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            document.body.style.userSelect = 'none'; // Prevent text selection
            resizer.classList.add('active');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            // Calculate delta
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Update start position for next frame
            startX = e.clientX;
            startY = e.clientY;

            // Perform resize
            callback(dx, dy);

            // Layout editor if needed
            if (this.editor) this.editor.layout();
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.userSelect = '';
                resizer.classList.remove('active');
                if (this.editor) this.editor.layout();
            }
        });
    }

    setupTerminal() {
        const terminalContainer = document.getElementById('terminal-content');
        if (!terminalContainer) return;

        // Clear existing content (remove mock HTML)
        terminalContainer.innerHTML = '';
        terminalContainer.style.background = '#1e1e1e';
        terminalContainer.style.padding = '0'; // Remove padding for xterm

        if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
            console.error('xterm.js or xterm-addon-fit not loaded');
            terminalContainer.innerHTML = '<div style="padding: 20px; color: #f88;">Error: Terminal libraries not loaded. Please check internet connection.</div>';
            return;
        }

        // Initialize xterm
        this.term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#1e1e1e',
                foreground: '#cccccc',
                cursor: '#cccccc',
                selection: '#264f78'
            },
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 1.2,
            convertEol: true // Treat \n as \r\n
        });

        const fitAddon = new FitAddon.FitAddon();
        this.term.loadAddon(fitAddon);

        this.term.open(terminalContainer);

        // Initial fit and create
        setTimeout(async () => {
            fitAddon.fit();
            if (this.term && this.term.cols) {
                try {
                    const result = await window.electronAPI.terminalCreate({
                        cols: this.term.cols,
                        rows: this.term.rows,
                        cwd: this.workspacePath
                    });
                    if (result && !result.success) {
                        this.term.write(`\r\n\x1b[31mFailed to start shell: ${result.error}\x1b[0m\r\n`);
                        this.term.write('\x1b[33mEnsure node-pty is installed or Visual Studio Build Tools are available.\x1b[0m\r\n');
                    }
                } catch (e) {
                    this.term.write(`\r\n\x1b[31mError connecting to terminal: ${e.message}\x1b[0m\r\n`);
                }
            }
        }, 100);

        // Connect to backend
        this.term.onData(data => {
            window.electronAPI.terminalWrite(data);
        });

        window.electronAPI.onTerminalIncoming(data => {
            this.term.write(data);
        });

        // Resize handler
        window.addEventListener('resize', () => {
            fitAddon.fit();
            if (this.term) window.electronAPI.terminalResize(this.term.cols, this.term.rows);
        });

        // Also fit on terminal panel resize
        const terminalPanel = document.getElementById('terminal-panel');
        if (terminalPanel) {
            const observer = new ResizeObserver(() => {
                fitAddon.fit();
                if (this.term) window.electronAPI.terminalResize(this.term.cols, this.term.rows);
            });
            observer.observe(terminalPanel);
        }

        // Run Button
        const runBtn = document.getElementById('run-code-btn');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runCurrentFile());
        }

        // Expose term for other methods
        this.fitAddon = fitAddon;
    }

    async runCurrentFile() {
        if (!this.currentFile) {
            this.term.write('\r\n\x1b[33mPlease save the file before running.\x1b[0m\r\n');
            return;
        }

        // Save file first
        await window.electronAPI.saveFile({
            filePath: this.currentFile,
            content: this.editor.getValue()
        });

        const isWindows = navigator.platform.indexOf('Win') > -1;
        // Paths are normalized to use '/' in this app
        const parts = this.currentFile.split('/');
        const fileName = parts.pop();
        const dir = parts.join('/');

        // Change to file directory first
        const cdCmd = `cd "${dir}"`;
        window.electronAPI.terminalWrite(cdCmd + '\r');

        const ext = fileName.split('.').pop().toLowerCase();
        let cmd = '';

        if (ext === 'py') {
            cmd = isWindows ? `python "${fileName}"` : `python3 "${fileName}"`;
        } else if (ext === 'js') {
            cmd = `node "${fileName}"`;
        } else if (ext === 'java') {
            const className = fileName.substring(0, fileName.lastIndexOf('.'));
            if (isWindows) {
                cmd = `javac "${fileName}"; if ($?) { java "${className}" }`;
            } else {
                cmd = `javac "${fileName}" && java "${className}"`;
            }
        } else if (ext === 'html') {
            this.toggleLivePreview();
            this.updateLivePreview();
            return;
        } else if (ext === 'c') {
            const outFile = isWindows ? 'a.exe' : './a.out';
            if (isWindows) {
                cmd = `gcc "${fileName}" -o ${outFile}; if ($?) { .\\${outFile} }`;
            } else {
                cmd = `gcc "${fileName}" -o ${outFile} && ${outFile}`;
            }
        } else if (ext === 'cpp') {
            const outFile = isWindows ? 'a.exe' : './a.out';
            if (isWindows) {
                cmd = `g++ "${fileName}" -o ${outFile}; if ($?) { .\\${outFile} }`;
            } else {
                cmd = `g++ "${fileName}" -o ${outFile} && ${outFile}`;
            }
        } else {
            this.term.write(`\r\n\x1b[33mRunning files of type .${ext} is not explicitly supported. send command manually.\x1b[0m\r\n`);
            return;
        }

        // Show terminal if hidden
        const terminalPanel = document.getElementById('terminal-panel');
        if (terminalPanel && terminalPanel.offsetHeight < 50) {
            terminalPanel.style.height = '200px';
            terminalPanel.classList.add('visible');
            if (this.fitAddon) this.fitAddon.fit();
        }

        // Send command with a slight delay to ensure cd executes
        setTimeout(() => {
            this.term.write(`\r\n\x1b[32m> Executing: ${cmd}\x1b[0m\r\n`);
            window.electronAPI.terminalWrite(cmd + '\r');
        }, 50);
    }

    async loadMonacoEditor() {
        return new Promise((resolve) => {
            if (typeof monaco === 'undefined') {
                console.error('Monaco Editor not loaded');
                setTimeout(() => this.loadMonacoEditor().then(resolve), 100);
                return;
            }

            try {
                this.editor = monaco.editor.create(document.getElementById('editor'), {
                    value: '',
                    language: 'javascript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: {
                        enabled: true,
                        size: 'proportional'
                    },
                    fontSize: 14,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    scrollBeyondLastLine: false,
                    readOnly: false,
                    wordWrap: 'on',
                    folding: true,
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    glyphMargin: true,
                    scrollbar: {
                        vertical: 'visible',
                        horizontal: 'visible',
                        useShadows: false,
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10
                    }
                });

                // Add editor event listeners
                this.editor.onDidChangeModelContent(() => {
                    this.updateOutline();
                    this.updateTabStatus();
                    this.updateLivePreview();
                });

                this.editor.onDidChangeCursorPosition((e) => {
                    const position = e.position;
                    document.getElementById('cursor-position').textContent =
                        `Ln ${position.lineNumber}, Col ${position.column}`;
                });

                resolve();
            } catch (error) {
                console.error('Failed to initialize Monaco Editor:', error);
                setTimeout(() => this.loadMonacoEditor().then(resolve), 100);
            }
        });
    }

    setupAutoSave() {
        if (this.editor) {
            this.editor.onDidChangeModelContent(() => {
                if (this.autoSaveEnabled && this.currentFile && !this.currentFile.startsWith('/')) {
                    this.debouncedSave();
                }
            });
        }

        this.debouncedSave = this.debounce(() => {
            if (this.currentFile && !this.currentFile.startsWith('/')) {
                this.saveCurrentFile();
            }
        }, 2000);
    }

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
    }

    setupFileSystemWatchers() {
        window.electronAPI.onFileChanged((data) => {
            if (data.eventType === 'change' && this.currentFile && this.currentFile.includes(data.filename)) {
                this.handleExternalFileChange(this.currentFile);
            }
        });

        window.electronAPI.onFileChangedExternally((data) => {
            this.handleExternalFileChange(data.filePath);
        });
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');

        document.getElementById('window-close').addEventListener('click', () => {
            window.electronAPI.windowControl('close');
        });

        document.getElementById('window-minimize').addEventListener('click', () => {
            window.electronAPI.windowControl('minimize');
        });

        document.getElementById('window-maximize').addEventListener('click', () => {
            window.electronAPI.windowControl('maximize');
        });

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const menu = e.target.dataset.menu;
                this.showMenu(menu, e.target);
            });
        });

        document.getElementById('run-btn').addEventListener('click', () => {
            this.runCurrentFile();
        });

        // AI Toggle Button
        document.getElementById('ai-toggle-btn').addEventListener('click', () => {
            this.toggleAIPanel();
        });

        // Sidebar Actions
        document.getElementById('new-file-btn').addEventListener('click', () => {
            this.createNewFile();
        });

        document.getElementById('new-folder-btn').addEventListener('click', () => {
            this.createNewFolder();
        });

        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.refreshFileTree();
        });

        // Tab Actions
        document.getElementById('split-editor-btn').addEventListener('click', () => {
            this.splitEditor();
        });

        document.getElementById('close-all-tabs-btn').addEventListener('click', () => {
            this.closeAllTabs();
        });

        // Terminal
        document.getElementById('close-terminal-btn').addEventListener('click', () => {
            this.toggleTerminal();
        });

        document.getElementById('clear-terminal-btn').addEventListener('click', () => {
            this.clearTerminal();
        });

        document.getElementById('new-terminal-btn').addEventListener('click', () => {
            this.newTerminal();
        });

        const terminalInput = document.getElementById('terminal-input');
        if (terminalInput) {
            terminalInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.executeTerminalCommand(e.target.value);
                    e.target.value = '';
                }
            });
        }

        // AI Panel
        document.getElementById('close-ai-panel').addEventListener('click', () => {
            this.toggleAIPanel();
        });

        document.getElementById('ai-settings-btn').addEventListener('click', () => {
            this.showAISettings();
        });



        // AI Quick Actions
        document.querySelectorAll('.ai-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleAIAction(action);
            });
        });

        // AI Chat
        document.getElementById('send-ai-message').addEventListener('click', () => {
            this.sendAIMessage();
        });

        document.getElementById('clear-chat-btn').addEventListener('click', () => {
            this.clearAIChat();
        });

        document.getElementById('attach-file-btn').addEventListener('click', () => {
            this.attachFileToChat();
        });

        const aiInput = document.getElementById('ai-input');
        if (aiInput) {
            aiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendAIMessage();
                }
            });
        }

        // Context Menu
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.file-item, .folder-item')) {
                e.preventDefault();
                this.showFileContextMenu(e);
            } else if (e.target.closest('#editor')) {
                e.preventDefault();
                this.showEditorContextMenu(e);
            }
        });

        // Close context menus on click
        document.addEventListener('click', () => {
            this.hideContextMenus();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // Initialize tabs container
        this.setupTabListeners();

        // Rename dialog
        document.getElementById('rename-cancel').addEventListener('click', () => {
            this.hideRenameDialog();
        });

        document.getElementById('rename-confirm').addEventListener('click', () => {
            this.confirmRename();
        });

        // New file dialog
        document.getElementById('new-file-cancel').addEventListener('click', () => {
            this.hideNewFileDialog();
        });

        document.getElementById('new-file-confirm').addEventListener('click', () => {
            this.confirmNewFile();
        });

        // Handle Enter key in new file input
        document.getElementById('new-file-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.confirmNewFile();
            }
        });

        // New folder dialog
        document.getElementById('new-folder-cancel').addEventListener('click', () => {
            this.hideNewFolderDialog();
        });

        document.getElementById('new-folder-confirm').addEventListener('click', () => {
            this.confirmNewFolder();
        });

        // Handle Enter key in new folder input
        document.getElementById('new-folder-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.confirmNewFolder();
            }
        });

        // Open File/Folder buttons
        const openFileBtn = document.createElement('button');
        openFileBtn.className = 'action-btn btn-modern';
        openFileBtn.innerHTML = '<i class="fas fa-file"></i><span>Open File</span>';
        openFileBtn.addEventListener('click', () => this.openFileDialog());

        const openFolderBtn = document.createElement('button');
        openFolderBtn.className = 'action-btn btn-modern';
        openFolderBtn.innerHTML = '<i class="fas fa-folder-open"></i><span>Open Folder</span>';
        openFolderBtn.addEventListener('click', () => this.openFolderDialog());

        const titleBarActions = document.querySelector('.title-bar-actions');
        if (titleBarActions) {
            titleBarActions.insertBefore(openFileBtn, titleBarActions.firstChild);
            titleBarActions.insertBefore(openFolderBtn, titleBarActions.firstChild);
        }

        console.log('Event listeners setup complete');
    }

    setupActivityBar() {
        const activityItems = document.querySelectorAll('.activity-item');
        const views = document.querySelectorAll('.sidebar-view');

        activityItems.forEach(item => {
            item.addEventListener('click', (e) => {
                if (item.classList.contains('spacer')) return;

                if (item.id === 'nav-settings') {
                    this.showNotification('Settings not implemented yet', 'info');
                    return;
                }

                const id = item.id;

                // Remove active class from all items
                activityItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Switch View
                views.forEach(view => {
                    view.classList.remove('active');
                    view.style.display = 'none';
                });

                let viewId = '';
                if (id === 'nav-explorer') viewId = 'view-explorer';
                else if (id === 'nav-github') viewId = 'view-github';
                else if (id === 'nav-algo') viewId = 'view-algo';
                else if (id === 'nav-extensions') viewId = 'view-extensions';
                else if (id === 'nav-search') viewId = 'view-extensions';

                const targetView = document.getElementById(viewId);
                if (targetView) {
                    targetView.classList.add('active');
                    targetView.style.display = 'flex';

                    // Load extensions if opening that view
                    if (viewId === 'view-extensions') {
                        this.loadExtensions();
                    }
                }
            });
        });

        const ghLoginBtn = document.getElementById('gh-login-btn');
        if (ghLoginBtn) {
            ghLoginBtn.addEventListener('click', () => {
                const token = document.getElementById('gh-token').value;
                if (token) {
                    this.ghToken = token;
                    localStorage.setItem('ghToken', token);
                    this.showNotification('GitHub Authentication Successful', 'success');
                } else {
                    this.showNotification('Please enter a token', 'error');
                }
            });
            // Load saved token
            const savedToken = localStorage.getItem('ghToken');
            if (savedToken) {
                this.ghToken = savedToken;
                document.getElementById('gh-token').value = savedToken;
            }
        }

        // Clone
        const cloneBtn = document.getElementById('gh-clone-btn');
        if (cloneBtn) {
            cloneBtn.addEventListener('click', async () => {
                const repoUrl = prompt('Enter Repository URL (https):');
                if (!repoUrl) return;

                const { canceled, filePaths } = await window.electronAPI.showOpenFolderDialog();
                if (canceled || filePaths.length === 0) return;

                const targetParent = filePaths[0];
                const repoName = repoUrl.split('/').pop().replace('.git', '');
                const targetPath = await window.electronAPI.resolvePath(targetParent, repoName);

                this.showNotification(`Cloning ${repoName}...`, 'info');

                const result = await window.electronAPI.gitClone(repoUrl, targetPath, this.ghToken);

                if (result.success) {
                    this.showNotification('Cloned successfully!', 'success');
                    this.openFolder(targetPath);
                } else {
                    this.showNotification(`Clone failed: ${result.error}`, 'error');
                }
            });
        }

        // Commit and Push/Pull
        const pushBtn = document.getElementById('gh-push');
        if (pushBtn) {
            pushBtn.addEventListener('click', async () => {
                if (!this.workspacePath) return this.showNotification('No workspace open', 'warning');
                this.showNotification('Pushing changes...', 'info');
                const result = await window.electronAPI.gitPush(this.workspacePath, null, this.ghToken);
                if (result.success) {
                    this.showNotification('Pushed successfully', 'success');
                } else {
                    this.showNotification(`Push failed: ${result.error}`, 'error');
                }
            });
        }

        // Algo Visualizer Button
        const vizRunBtn = document.querySelector('#view-algo .fa-play');
        if (vizRunBtn) {
            vizRunBtn.parentElement.title = "Visualize Algorithm";
            vizRunBtn.parentElement.style.cursor = "pointer";
            vizRunBtn.parentElement.addEventListener('click', () => {
                this.visualizeAlgorithm();
            });
        }

        // Close Visualization
        const closeVizBtn = document.getElementById('close-viz-btn');
        if (closeVizBtn) {
            closeVizBtn.addEventListener('click', () => {
                document.getElementById('visualization-panel').style.display = 'none';
                document.getElementById('monaco-wrapper').style.display = 'block';
            });
        }

        const pullBtn = document.getElementById('gh-pull');
        if (pullBtn) {
            pullBtn.addEventListener('click', async () => {
                if (!this.workspacePath) return this.showNotification('No workspace open', 'warning');
                this.showNotification('Pulling changes...', 'info');
                const result = await window.electronAPI.gitPull(this.workspacePath);
                if (result.success) {
                    this.showNotification('Pulled successfully', 'success');
                    this.refreshFileTree();
                } else {
                    this.showNotification(`Pull failed: ${result.error}`, 'error');
                }
            });
        }

        // Commit logic is bound to a button? The UI shows textarea and then buttons.
        // It seems the "Push" button handles just push. But usually people commit then push.
        // Let's add a specialized Commit button if it exists or reuse one.
        // The UI has "Commit & Push" label but separate buttons. 
        // Let's make "Push" do Commit + Push if there is a message? 
        // Or adds a "Commit" button in the future.
        // For now, I'll add a separate Event Listener for the textarea to allow Ctrl+Enter to commit?
        // Or better, let's create a dedicated Commit function and a button if I can edit HTML.
        // Currently I am editing JS. The existing buttons are push, pull, fetch, branch.
        // Let's assume the user wants to Commit AND Push with the Push button if a message is present.

        if (pushBtn) {
            // Let's override the previous listener to include commit logic
            const newPushBtn = pushBtn.cloneNode(true);
            pushBtn.parentNode.replaceChild(newPushBtn, pushBtn);

            newPushBtn.addEventListener('click', async () => {
                if (!this.workspacePath) return this.showNotification('No workspace open', 'warning');

                const msg = document.getElementById('gh-commit-msg').value.trim();

                if (msg) {
                    this.showNotification('Committing...', 'info');
                    const commitResult = await window.electronAPI.gitCommit(this.workspacePath, msg);
                    if (!commitResult.success) {
                        return this.showNotification(`Commit failed: ${commitResult.error}`, 'error');
                    }
                    this.showNotification('Committed. Pushing...', 'info');
                    document.getElementById('gh-commit-msg').value = ''; // Clear message
                } else {
                    this.showNotification('No commit message. Pushing existing commits...', 'info');
                }

                const result = await window.electronAPI.gitPush(this.workspacePath, null, this.ghToken);
                if (result.success) {
                    this.showNotification('Pushed successfully', 'success');
                } else {
                    this.showNotification(`Push failed: ${result.error}`, 'error');
                }
            });
        }

        const commitBtn = document.getElementById('gh-commit-btn');
        if (commitBtn) {
            commitBtn.addEventListener('click', async () => {
                if (!this.workspacePath) return this.showNotification('No workspace open', 'warning');

                const msg = document.getElementById('gh-commit-msg').value.trim();
                if (!msg) {
                    return this.showNotification('Please enter a commit message', 'warning');
                }

                this.showNotification('Committing...', 'info');
                const commitResult = await window.electronAPI.gitCommit(this.workspacePath, msg);

                if (commitResult.success) {
                    this.showNotification('Committed successfully!', 'success');
                    document.getElementById('gh-commit-msg').value = '';
                    this.loadGitHistory();
                } else {
                    this.showNotification(`Commit failed: ${commitResult.error}`, 'error');
                }
            });
        }

        const fetchBtn = document.getElementById('gh-fetch');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', () => {
                this.showNotification('Fetch not implemented yet', 'info');
            });
        }

        // Auto-load history when switching to Github view
        const navGithub = document.getElementById('nav-github');
        if (navGithub) {
            navGithub.addEventListener('click', () => {
                if (this.workspacePath) {
                    this.loadGitHistory();
                }
            });
        }
    }

    async loadGitHistory() {
        if (!this.workspacePath) return;

        const historyList = document.getElementById('gh-history-list');
        if (!historyList) return;

        historyList.innerHTML = '<div class="history-placeholder">Loading history...</div>';

        const result = await window.electronAPI.gitHistory(this.workspacePath);

        if (result.success) {
            historyList.innerHTML = '';
            if (result.history.length === 0) {
                historyList.innerHTML = '<div class="history-placeholder">No history available</div>';
                return;
            }

            result.history.forEach(commit => {
                const item = document.createElement('div');
                item.className = 'history-item'; // Add CSS for this
                item.style.padding = '8px';
                item.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
                item.style.cursor = 'pointer';

                item.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 4px;">${commit.message}</div>
                    <div style="display: flex; justify-content: space-between; color: #888; font-size: 10px;">
                        <span>${commit.author}</span>
                        <span>${new Date(commit.date).toLocaleDateString()}</span>
                    </div>
                    <div style="color: #666; font-size: 10px; margin-top: 2px;">${commit.short_hash}</div>
                `;

                item.addEventListener('click', () => {
                    // TODO: Show commit details/diff
                    this.showNotification(`Commit ${commit.short_hash} selected (Diff view not implemented)`, 'info');
                });

                historyList.appendChild(item);
            });
        } else {
            historyList.innerHTML = `<div class="history-placeholder" style="color: #ff5f56;">Error: ${result.error}</div>`;
        }
    }

    setupExtensionsSearch() {
        const searchInput = document.querySelector('#view-extensions .input-dark');
        if (searchInput) {
            let timeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this.loadExtensions(e.target.value);
                }, 500);
            });
        }
    }

    async loadExtensions(query = '') {
        const list = document.querySelector('.extensions-list');
        if (!list) return;

        list.innerHTML = '<div class="extension-item" style="justify-content:center; align-items:center; opacity:0.7; padding: 20px;"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';

        try {
            const response = await fetch(`http://127.0.0.1:5000/api/extensions?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            // Check if we have results
            if (data.results && data.results[0] && data.results[0].extensions) {
                this.renderExtensions(data.results[0].extensions);
            } else {
                list.innerHTML = '<div class="extension-item" style="justify-content:center; padding: 20px;">No extensions found</div>';
            }
        } catch (error) {
            console.error('Error loading extensions:', error);
            list.innerHTML = `<div class="extension-item" style="color:#ff5f56; padding: 20px;">Error: ${error.message}</div>`;
        }
    }

    renderExtensions(extensions) {
        const list = document.querySelector('.extensions-list');
        if (!list) return;

        list.innerHTML = '';

        extensions.forEach(ext => {
            const item = document.createElement('div');
            item.className = 'extension-item';

            // Find icon
            const version = ext.versions[0];
            const iconFile = version.files.find(f => f.assetType === 'Microsoft.VisualStudio.Services.Icons.Default') ||
                version.files.find(f => f.assetType === 'Microsoft.VisualStudio.Services.Icons.Small');

            const iconUrl = iconFile ? iconFile.source : '';

            // Fallback icon
            const iconHtml = iconUrl
                ? `<img src="${iconUrl}" class="ext-icon" style="object-fit: contain; width: 42px; height: 42px;">`
                : `<div class="ext-icon"><i class="fas fa-puzzle-piece"></i></div>`;

            // Meta
            const publisher = ext.publisher.displayName;
            // Try to find install count in statistics
            let installCount = 0;
            if (ext.statistics) {
                const stat = ext.statistics.find(s => s.statisticName === 'install');
                if (stat) installCount = stat.value;
            }

            item.innerHTML = `
                <div class="ext-header">
                    ${iconHtml}
                    <div class="ext-info">
                        <div class="ext-name">${ext.displayName}</div>
                        <div class="ext-desc" title="${ext.shortDescription || ''}">${ext.shortDescription || ''}</div>
                        <div class="ext-meta">
                            <span><i class="fas fa-check-circle" style="font-size: 8px;"></i> ${publisher}</span>
                            <span style="margin-left:8px;"><i class="fas fa-download" style="font-size: 8px;"></i> ${this.formatNumber(installCount)}</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:5px; margin-top:5px;">
                    <button class="btn-xs btn-install" onclick="window.codeEditor.installExtension('${ext.extensionId}')">Install</button>
                    ${version.properties?.find(p => p.key === 'Microsoft.VisualStudio.Services.Links.Learn')
                    ? `<button class="btn-xs btn-secondary" onclick="window.electronAPI.openExternal('${version.properties.find(p => p.key === 'Microsoft.VisualStudio.Services.Links.Learn').value}')">Docs</button>`
                    : ''}
                </div>
            `;
            list.appendChild(item);
        });
    }

    // Helper for large numbers
    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    installExtension(id) {
        this.showNotification(`Installing extension ${id}... (Mock)`, 'info');
        setTimeout(() => {
            this.showNotification(`Extension ${id} installed!`, 'success');
        }, 1500);
    }

    setupLivePreview() {
        const btn = document.getElementById('live-preview-btn');
        if (btn) {
            btn.addEventListener('click', () => this.toggleLivePreview());
        }

        const closeBtn = document.getElementById('close-preview-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.toggleLivePreview());
        }
    }

    toggleLivePreview() {
        const pane = document.getElementById('live-preview-pane');
        const editorContainer = document.getElementById('editor-container-inner');

        if (!pane || !editorContainer) return;

        if (pane.style.display === 'none') {
            pane.style.display = 'flex';
            this.updateLivePreview();
        } else {
            pane.style.display = 'none';
        }

        // Resize editor to fit new layout
        if (this.editor) {
            this.editor.layout();
        }
    }

    updateLivePreview() {
        const pane = document.getElementById('live-preview-pane');
        if (!pane || pane.style.display === 'none') return;

        const frame = document.getElementById('preview-frame');
        if (!frame || !this.editor) return;

        const content = this.editor.getValue();
        // Basic HTML structure if missing
        let html = content;
        if (!content.trim().toLowerCase().startsWith('<!doctype html') && !content.trim().toLowerCase().startsWith('<html')) {
            // If it's just a fragment or CSS/JS, maybe wrap it? 
            // For now, assume user writes full HTML or pieces. 
            // If file type is not HTML, we could warn or wrap.
        }

        frame.srcdoc = html;
    }

    setupTabListeners() {
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            tabsContainer.addEventListener('click', (e) => {
                const tab = e.target.closest('.tab');
                if (tab) {
                    if (e.target.classList.contains('tab-close')) {
                        e.stopPropagation();
                        const filePath = tab.dataset.file;
                        this.closeTab(filePath);
                    } else {
                        const filePath = tab.dataset.file;
                        this.setActiveTab(filePath);
                    }
                }
            });
        }
    }

    async visualizeAlgorithm() {
        const scratchpad = document.querySelector('.scratchpad-area');
        if (!scratchpad) return;

        const code = scratchpad.value.trim();
        if (!code) {
            this.showNotification('Please enter some algorithm code first', 'warning');
            return;
        }

        this.showNotification('Generating visualization... This may take a moment.', 'info');

        // Show panel with loading
        const panel = document.getElementById('visualization-panel');
        const wrapper = document.getElementById('monaco-wrapper');
        const iframe = document.getElementById('viz-frame');

        wrapper.style.display = 'none';
        panel.style.display = 'flex';

        // Set loading state in iframe
        const loadingHtml = `
            <style>
                body { background: #1e1e1e; color: #ccc; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .loader { border: 4px solid #333; border-top: 4px solid #007acc; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
            <div style="text-align: center;">
                <div class="loader" style="margin: 0 auto 20px;"></div>
                <div>Generating AI Visualization...</div>
            </div>
        `;
        iframe.srcdoc = loadingHtml;

        try {
            const response = await fetch('http://127.0.0.1:5000/api/visualize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code, language: 'javascript' }) // Assume JS for scratchpad or detect
            });

            const data = await response.json();

            if (data.success) {
                // Inject the visualization HTML
                // We use srcdoc to safely isolate it (somewhat) and ensure it renders as a document
                iframe.srcdoc = data.visualization;
                this.showNotification('Visualization generated!', 'success');
            } else {
                iframe.srcdoc = `<div style="color: #ff5f56; padding: 20px;">Error: ${data.error}</div>`;
                this.showNotification('Failed to generate visualization', 'error');
            }
        } catch (error) {
            console.error('Visualization error:', error);
            iframe.srcdoc = `<div style="color: #ff5f56; padding: 20px;">Connection Error: ${error.message}</div>`;
            this.showNotification('Error connecting to backend', 'error');
        }
    }

    setupElectronHandlers() {
        console.log('Setting up Electron handlers...');

        if (!window.electronAPI) {
            console.error('electronAPI is not available');
            this.showNotification('Electron API not available', 'error');
            return;
        }

        // File operations
        window.electronAPI.onFileOpened((data) => {
            console.log('File opened:', data);
            this.openFile(data.filePath, data.content, data.fileName);
        });

        window.electronAPI.onFolderOpened((data) => {
            console.log('Folder opened:', data);
            this.openFolder(data.folderPath, data.files, data.folderStructure);

            // Auto-Index Codebase for RAG
            this.addAIMessage('ai', `📂 New folder detected. Indexing codebase for RAG context...`);
            this.indexCodebase(); // Uses current workspacePath set by openFolder
        });

        window.electronAPI.onFileSaved((data) => {
            console.log('File saved:', data);
            this.showNotification(`File saved: ${data.filePath}`, 'success');
            this.refreshFileTree();
        });

        window.electronAPI.onFileCreated((data) => {
            console.log('File created:', data);
            this.showNotification(`File created: ${data.fileName}`, 'success');
            this.refreshFileTree();
        });

        window.electronAPI.onFolderCreated((data) => {
            console.log('Folder created:', data);
            this.showNotification(`Folder created: ${data.folderName}`, 'success');
            this.refreshFileTree();
        });

        window.electronAPI.onFileRenamed((data) => {
            console.log('File renamed:', data);
            this.showNotification(`Renamed to: ${data.newName}`, 'success');
            this.refreshFileTree();

            // Update tab if it exists
            if (this.tabs.has(data.oldPath)) {
                const tab = this.tabs.get(data.oldPath);
                this.tabs.delete(data.oldPath);
                this.tabs.set(data.newPath, tab);

                // Update tab element
                const tabElement = document.querySelector(`.tab[data-file="${data.oldPath}"]`);
                if (tabElement) {
                    tabElement.dataset.file = data.newPath;
                    const span = tabElement.querySelector('span');
                    if (span) {
                        span.textContent = data.newName;
                    }
                }

                // Update current file if it was renamed
                if (this.currentFile === data.oldPath) {
                    this.currentFile = data.newPath;
                    document.getElementById('file-path').textContent = data.newName;
                }
            }
        });

        window.electronAPI.onFileDeleted((data) => {
            console.log('File deleted:', data);
            this.showNotification(`Deleted: ${data.filePath}`, 'success');
            this.refreshFileTree();

            // Close tab if it exists
            this.closeTab(data.filePath);
        });

        window.electronAPI.onFileChanged((data) => {
            console.log('File changed:', data);
            this.refreshFileTree();
        });

        // Menu actions
        window.electronAPI.onMenuAction((action) => {
            console.log('Menu action received:', action);
            this.handleMenuAction(action);
        });

        window.electronAPI.onAIAction((action) => {
            console.log('AI action received:', action);
            this.handleAIAction(action);
        });

        window.electronAPI.onWindowAction((action) => {
            console.log('Window action received:', action);
            this.handleWindowAction(action);
        });

        window.electronAPI.onTerminalAction((action) => {
            console.log('Terminal action received:', action);
            this.handleTerminalAction(action);
        });

        // Custom file change event
        window.electronAPI.onFileChangedExternally((data) => {
            this.handleExternalFileChange(data.filePath);
        });
    }

    async checkBackendHealth() {
        try {
            const health = await window.electronAPI.checkBackendHealth();
            this.updateBackendStatus(health);
        } catch (error) {
            console.error('Error checking backend health:', error);
            this.updateBackendStatus({
                success: false,
                status: 'error',
                message: 'Failed to check backend'
            });
        }
    }

    updateBackendStatus(health) {
        const statusElement = document.getElementById('backend-status');
        if (!statusElement) return;

        statusElement.style.display = 'block';
        const indicator = statusElement.querySelector('.status-indicator');
        const text = statusElement.querySelector('.status-text');

        if (health.success && health.status === 'healthy') {
            indicator.style.background = '#27ca3f';
            text.textContent = 'Backend: Connected';
            statusElement.style.background = '#2d2d2d';
            statusElement.classList.add('glass');
        } else {
            indicator.style.background = '#ff5f56';
            text.textContent = 'Backend: Disconnected';
            statusElement.style.background = '#ff5f5620';
            statusElement.classList.add('glass');

            // Show notification for first-time users
            if (!localStorage.getItem('backend-warning-shown')) {
                this.showNotification(
                    'AI Backend is not running. AI features will not work.\n\nStart the Flask backend:\n1. cd backend\n2. python app.py',
                    'warning'
                );
                localStorage.setItem('backend-warning-shown', 'true');
            }
        }
    }

    setupDefaultWorkspace() {
        console.log('Setting up default workspace...');
        this.fileTree = {
            name: 'Workspace',
            path: '/',
            type: 'folder',
            open: true,
            children: []
        };
        this.renderFileTree();
    }

    renderFileTree(node = this.fileTree, parentElement = document.getElementById('workspace'), depth = 0) {
        if (!parentElement) {
            console.error('Workspace element not found');
            return;
        }

        // Only clear if we are rendering the root
        if (depth === 0) {
            parentElement.innerHTML = '';

            // Add workspace info if we have a workspace
            if (this.workspacePath) {
                this.updateWorkspaceInfo(this.workspacePath);
            }
        }

        if (!node.children || node.children.length === 0) {
            if (depth === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'empty-folder';
                emptyMsg.innerHTML = `
                    <i class="fas fa-folder-open" style="font-size: 48px; margin-bottom: 10px; opacity: 0.3;"></i>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 15px;">No files or folders</div>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn-modern" style="padding: 6px 12px; font-size: 11px;" 
                                onclick="codeEditor.openFileDialog()">
                            <i class="fas fa-file"></i> Open File
                        </button>
                        <button class="btn-modern" style="padding: 6px 12px; font-size: 11px;" 
                                onclick="codeEditor.openFolderDialog()">
                            <i class="fas fa-folder-plus"></i> Open Folder
                        </button>
                    </div>
                `;
                parentElement.appendChild(emptyMsg);
            }
            return;
        }

        // Sort: folders first, then files
        const sortedChildren = [...node.children].sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });

        const frag = document.createDocumentFragment();

        sortedChildren.forEach(child => {
            const element = document.createElement('div');
            // Use common class 'file-tree-row'? No, keeping existing classes but styled differently in CSS
            element.className = child.type === 'folder' ? 'folder-item' : 'file-item';
            element.dataset.path = child.path;

            // Highlight active file
            if (child.type === 'file' && this.currentFile === child.path) {
                element.classList.add('active');
            }

            const icon = child.type === 'folder' ?
                (child.open ? 'fa-folder-open' : 'fa-folder') :
                this.getFileIcon(child.name);

            // Indentation
            const paddingLeft = 10 + (depth * 15);

            element.innerHTML = `
                <div class="file-item-content" style="padding-left: ${paddingLeft}px;">
                    ${child.type === 'folder' ?
                    `<i class="fas fa-chevron-right folder-chevron" style="transform: ${child.open ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.2s;"></i>`
                    : '<span style="width:16px; margin-right:2px; display:inline-block;"></span>'}
                    
                    <i class="fas ${icon}" style="margin-right: 6px; width: 16px; text-align: center; color: ${child.type === 'folder' ? '#dcb67a' : 'inherit'}"></i>
                    <span class="file-name">${child.name}</span>
                </div>
                <div class="quick-file-actions">
                    <div class="quick-action-btn" onclick="event.stopPropagation(); codeEditor.showFileContextMenu('${child.path}', event)">
                        <i class="fas fa-ellipsis-h"></i>
                    </div>
                </div>
            `;

            const itemContainer = document.createElement('div');
            itemContainer.appendChild(element);

            // Append container to fragment first
            frag.appendChild(itemContainer);

            // Handle Folder Click
            element.addEventListener('click', (e) => {
                if (e.target.closest('.quick-file-actions')) return;

                if (child.type === 'folder') {
                    child.open = !child.open;
                    this.renderFileTree(); // Full re-render is simplest for consistency
                } else {
                    // Check if file is virtual (starts with /) or has stored content
                    if (child.path.startsWith('/')) {
                        // Virtual file - use stored content from tabs or empty
                        const tabInfo = this.tabs.get(child.path);
                        const content = tabInfo ? tabInfo.content : '';
                        this.openFile(child.path, content, child.name);
                    } else if (child.content !== undefined) {
                        // Has inline content
                        this.openFile(child.path, child.content, child.name);
                    } else if (this.tabs.has(child.path)) {
                        // Already open in a tab - use stored content
                        const tabInfo = this.tabs.get(child.path);
                        this.openFile(child.path, tabInfo.content || '', child.name);
                    } else {
                        // Normal file read
                        window.electronAPI.readFile(child.path).then(result => {
                            if (result.success) {
                                this.openFile(child.path, result.content, child.name);
                            } else {
                                this.showNotification(`Error opening file: ${result.error}`, 'error');
                            }
                        });
                    }

                    // Highlight active
                    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
                    element.classList.add('active');
                }
            });

            // Recursive Children
            if (child.type === 'folder' && child.open) {
                // We create a container for children to keep DOM organized, though flattened is also fine.
                // But wait, if we use full re-render, we just need to append them here?
                // NO, we need to append them to itemContainer or frag?
                // Actually, renderFileTree clears the parent. So if we pass itemContainer as parent, it works.
                // BUT, my logic above says "Only clear if depth === 0". 
                // So:
                this.renderFileTree(child, itemContainer, depth + 1);
            }
        });

        parentElement.appendChild(frag);
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            'js': 'fa-js-square',
            'jsx': 'fa-react',
            'ts': 'fa-js-square',
            'tsx': 'fa-react',
            'html': 'fa-html5',
            'htm': 'fa-html5',
            'css': 'fa-css3-alt',
            'scss': 'fa-sass',
            'sass': 'fa-sass',
            'less': 'fa-less',
            'json': 'fa-file-code',
            'md': 'fa-markdown',
            'py': 'fa-python',
            'java': 'fa-java',
            'c': 'fa-file-code',
            'cpp': 'fa-file-code',
            'h': 'fa-file-code',
            'hpp': 'fa-file-code',
            'cs': 'fa-microsoft',
            'php': 'fa-php',
            'rb': 'fa-gem',
            'go': 'fa-google',
            'rs': 'fa-rust',
            'sql': 'fa-database',
            'xml': 'fa-file-code',
            'yml': 'fa-file-code',
            'yaml': 'fa-file-code',
            'txt': 'fa-file-alt',
            'pdf': 'fa-file-pdf',
            'zip': 'fa-file-archive',
            'png': 'fa-file-image',
            'jpg': 'fa-file-image',
            'jpeg': 'fa-file-image',
            'gif': 'fa-file-image',
            'svg': 'fa-file-image',
            'vue': 'fa-vuejs',
            'svelte': 'fa-code'
        };

        return iconMap[ext] || 'fa-file';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async openFile(filePath, content, fileName) {
        // Normalize path for consistent tab keys
        const originalPath = filePath;
        filePath = this.normalizePath(filePath);

        console.log(`Opening file: ${fileName} (${filePath})`);

        // IMPORTANT: Save current tab content BEFORE switching
        // Only save if we are actually SWITCHING tabs
        if (this.activeTab && this.activeTab !== filePath && this.tabs.has(this.activeTab) && this.editor) {
            const currentTabInfo = this.tabs.get(this.activeTab);
            currentTabInfo.content = this.editor.getValue();
            console.log(`Saved content for current tab: ${this.activeTab}`);
        }

        // Stop watching previous file (if switching)
        if (this.currentFile && this.currentFile !== filePath && this.fileSystemWatchers.has(this.currentFile)) {
            // Optional: Keep watchers alive for open tabs? 
            // Current logic closes watcher on switch? That's probably efficient but means background tabs don't update.
            // For now, keep existing behavior but use normalized check
            this.fileSystemWatchers.get(this.currentFile).close();
            this.fileSystemWatchers.delete(this.currentFile);
        }

        this.currentFile = filePath;

        // Add to explorer pane using ORIGINAL path for display compatibility if needed, 
        // but normalized for verification
        if (originalPath) {
            this.addToExplorer(originalPath, fileName || this.getFileNameFromPath(originalPath));
        }

        // Update or create tab
        if (!this.tabs.has(filePath)) {
            this.createTab(filePath, fileName);
        }

        // Store the content for this file
        const tabInfo = this.tabs.get(filePath);
        if (tabInfo) {
            // Only update content if provided (don't overwrite with empty if undefined)
            if (content !== undefined) {
                tabInfo.content = content;
            } else if (tabInfo.content === undefined) {
                tabInfo.content = '';
            }
            console.log(`Stored content for file: ${filePath}, length: ${tabInfo.content.length}`);
        }

        // Now activate the tab
        await this.setActiveTab(filePath);

        // Start watching the file using ORIGINAL path (fs.watch needs real path)
        if (originalPath && !originalPath.startsWith('/')) {
            this.watchFile(originalPath);
        }

        // Update UI
        document.getElementById('file-path').textContent = this.getFileNameFromPath(filePath) || fileName;
        document.getElementById('file-path').title = filePath;

        const languageStatus = document.getElementById('language-status');
        if (languageStatus) {
            const language = this.getLanguageFromExtension(fileName);
            languageStatus.querySelector('span').textContent =
                language.charAt(0).toUpperCase() + language.slice(1);
        }

        this.updateOutline();
        this.updateFileInfo(filePath);
    }

    async openFileFromPath(filePath, fileName) {
        try {
            const content = await window.electronAPI.readFileContent(filePath);
            this.openFile(filePath, content, fileName);
        } catch (error) {
            console.error('Error opening file:', error);
            this.showNotification(`Error opening file: ${error.message}`, 'error');
        }
    }

    watchFile(filePath) {
        try {
            const fs = require('fs');
            const watcher = fs.watch(filePath, (eventType, filename) => {
                if (eventType === 'change' && filename) {
                    console.log(`File changed externally: ${filePath}`);
                    this.handleExternalFileChange(filePath);
                }
            });

            this.fileSystemWatchers.set(filePath, watcher);
            console.log(`Started watching file: ${filePath}`);
        } catch (error) {
            console.error('Error setting up file watcher:', error);
        }
    }

    handleExternalFileChange(filePath) {
        // Check if we're the ones who made the change
        if (this.currentFile === filePath && this.editor) {
            const currentContent = this.editor.getValue();

            // Read file content
            try {
                const fs = require('fs');
                const fileContent = fs.readFileSync(filePath, 'utf-8');

                // Only show notification if content is different
                if (currentContent !== fileContent) {
                    this.showNotification('File changed externally. Reloading...', 'warning');

                    // Update editor content
                    setTimeout(() => {
                        if (this.editor) {
                            const model = this.editor.getModel();
                            if (model) {
                                model.setValue(fileContent);
                            }
                        }
                        this.showNotification('File reloaded from disk', 'success');
                    }, 100);
                }
            } catch (error) {
                console.error('Error reading changed file:', error);
            }
        }
    }

    createTab(filePath, fileName) {
        console.log(`Creating tab for: ${fileName}`);

        const tabsContainer = document.getElementById('tabs-container');
        if (!tabsContainer) {
            console.error('Tabs container not found');
            return;
        }

        const tab = document.createElement('div');
        tab.className = 'tab hover-lift';
        tab.dataset.file = filePath;

        const icon = this.getFileIcon(fileName);
        tab.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${fileName}</span>
            <i class="fas fa-times tab-close"></i>
        `;

        tabsContainer.appendChild(tab);
        this.tabs.set(filePath, { element: tab, fileName, saved: true });

        console.log(`Tab created: ${fileName}`);
    }

    async setActiveTab(filePath) {
        // Normalize
        filePath = this.normalizePath(filePath);
        console.log(`Setting active tab: ${filePath}`);

        // Save content of current tab ONLY if switching to a DIFFERENT tab
        // This prevents overwriting updated content when refreshing the same tab (e.g. after Apply Edit)
        if (this.activeTab && this.activeTab !== filePath && this.tabs.has(this.activeTab) && this.editor) {
            const currentTabInfo = this.tabs.get(this.activeTab);
            // CRITICAL FIX: Do NOT save content if the tab was in Diff Mode, 
            // as the editor might be empty or not reflecting the actual file content.
            if (!currentTabInfo.isDiff) {
                currentTabInfo.content = this.editor.getValue();
                console.log(`Saved content for tab: ${this.activeTab}`);
            }
        }

        // Remove active class from all tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
            tab.classList.remove('neon-glow');
        });

        if (this.tabs.has(filePath)) {
            const tabInfo = this.tabs.get(filePath);
            const tab = tabInfo.element;
            tab.classList.add('active');
            tab.classList.add('neon-glow');
            this.activeTab = filePath;
            this.currentFile = filePath;

            // Handle Diff Tabs
            if (tabInfo.isDiff && tabInfo.editData) {
                console.log('Activating Diff Tab for:', filePath);
                // Ensure Diff container exists
                let diffContainer = document.getElementById('diff-editor-container-tab');
                if (!diffContainer) {
                    diffContainer = document.createElement('div');
                    diffContainer.id = 'diff-editor-container-tab';
                    diffContainer.style.position = 'absolute';
                    diffContainer.style.top = '0';
                    diffContainer.style.left = '0';
                    diffContainer.style.width = '100%';
                    diffContainer.style.height = '100%';
                    diffContainer.style.zIndex = '9999'; // Very high z-index
                    diffContainer.style.backgroundColor = '#1e1e1e'; // Opaque background
                    document.getElementById('editor').appendChild(diffContainer);

                    this.diffEditorInstance = monaco.editor.createDiffEditor(diffContainer, {
                        theme: 'vs-dark',
                        automaticLayout: true,
                        readOnly: true,
                        originalEditable: false,
                        renderSideBySide: false // Inline Diff
                    });
                }
                diffContainer.style.display = 'block';

                const edit = tabInfo.editData;
                const originalModel = monaco.editor.createModel(edit.original_content, this.getLanguageFromExtension(edit.file_path));
                const modifiedModel = monaco.editor.createModel(edit.new_content, this.getLanguageFromExtension(edit.file_path));

                this.diffEditorInstance.setModel({
                    original: originalModel,
                    modified: modifiedModel
                });

                // Force layout update
                setTimeout(() => {
                    this.diffEditorInstance.layout();
                }, 50);

                this.renderDiffActions(diffContainer, tabInfo.editData, filePath);

            } else {
                // Standard Editor Tab
                // Hide diff container if exists
                const diffContainer = document.getElementById('diff-editor-container-tab');
                if (diffContainer) {
                    diffContainer.style.display = 'none';
                }

                // Update editor content from stored content
                if (this.editor) {
                    const contentToSet = tabInfo.content !== undefined ? tabInfo.content : '';

                    // Only setValue if it's different to prevent cursor jumping or unnecessary updates
                    // But if we are refreshing after edit, we MUST update.
                    // editor.getValue() might be stale if we just hid diff view.

                    if (this.editor.getValue() !== contentToSet) {
                        this.editor.setValue(contentToSet);
                    }
                    console.log(`Loaded content for tab: ${filePath}, length: ${contentToSet.length}`);

                    // Update language
                    const fileName = tabInfo.fileName;
                    const language = this.getLanguageFromExtension(fileName);
                    const model = this.editor.getModel();
                    if (model) {
                        monaco.editor.setModelLanguage(model, language);
                    }
                }

                // Update UI elements for standard tabs
                const fileName = tabInfo.fileName;
                document.getElementById('file-path').textContent = this.getFileNameFromPath(filePath) || fileName;
                document.getElementById('file-path').title = filePath;

                const languageStatus = document.getElementById('language-status');
                if (languageStatus) {
                    const language = this.getLanguageFromExtension(fileName);
                    languageStatus.querySelector('span').textContent =
                        language.charAt(0).toUpperCase() + language.slice(1);
                }

                this.updateOutline();
            }
        }

        // Update active file in sidebar
        document.querySelectorAll('.file-item, .folder-item').forEach(item => {
            item.classList.remove('active');
            // Normalize sidebar path to ensure match
            const itemPath = this.normalizePath(item.dataset.path);
            if (itemPath === filePath) {
                item.classList.add('active');
            }
        });

        console.log(`Active tab set: ${filePath}`);
    }

    renderDiffActions(container, edit, filePath) {
        let toolbar = document.getElementById('diff-actions-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = 'diff-actions-toolbar';
            toolbar.style.cssText = `
                position: absolute;
                top: 10px;
                right: 20px;
                z-index: 10000;
                display: flex;
                gap: 10px;
                background: rgba(30, 30, 30, 0.8);
                backdrop-filter: blur(4px);
                padding: 5px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            container.appendChild(toolbar);
        }

        toolbar.innerHTML = '';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'diff-overlay-btn btn-accept-change';
        acceptBtn.innerHTML = '<i class="fas fa-check"></i> Accept';
        acceptBtn.onclick = () => {
            const index = this.pendingEdits.indexOf(edit);
            if (index !== -1) this.acceptSingleEdit(index);
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'diff-overlay-btn btn-reject-change';
        rejectBtn.innerHTML = '<i class="fas fa-times"></i> Reject';
        rejectBtn.onclick = () => {
            const index = this.pendingEdits.indexOf(edit);
            if (index !== -1) this.rejectSingleEdit(index);
        };

        toolbar.appendChild(acceptBtn);
        toolbar.appendChild(rejectBtn);
    }

    normalizePath(filePath) {
        if (!filePath) return '';
        // Normalize slashes and casing for consistent Map keys
        // Use backend logic: lower case drive letters, standard slashes
        let normalized = filePath.replace(/\\/g, '/');
        // If on Windows (heuristic), lowercase valid drive letter
        if (normalized.match(/^[a-zA-Z]:\//)) {
            normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
        }
        return normalized; // Simple normalization for now. 
        // ideally we'd use path.resolve() but that's node-specific and we want consistent string keys
    }

    async applySingleEdit(edit) {
        try {
            // Normalize properly
            let editPath = this.normalizePath(edit.file_path);

            // Determine effective file path
            let targetPath = edit.file_path; // Keep original for FS ops

            const isNew = edit.is_new;
            if (isNew) {
                const fileName = this.getFileNameFromPath(edit.file_path);

                targetPath = await window.electronAPI.createFile({
                    folderPath: this.workspacePath,
                    fileName: fileName
                });
                console.log(`Created new file at: ${targetPath}`);
            }

            await window.electronAPI.saveFile({
                filePath: targetPath,
                content: edit.new_content
            });

            // Update Tab State
            // Try matching normalized
            let tabFilePath = editPath;
            if (!this.tabs.has(tabFilePath)) {
                // Try finding by fuzzy match or original?
                // If not found, check if we have it under original
                if (this.tabs.has(edit.file_path)) tabFilePath = edit.file_path;
            }

            if (this.tabs.has(tabFilePath)) {
                const tabInfo = this.tabs.get(tabFilePath);

                // CRITICAL SEQUENCE:
                // 1. Update state data first
                tabInfo.isDiff = false;
                tabInfo.editData = null;
                tabInfo.content = edit.new_content;

                // 2. If this is the active tab, directly update editor to prevent setActiveTab from overwriting with stale data
                if (this.activeTab === tabFilePath) {
                    if (this.editor) {
                        this.editor.setValue(edit.new_content);
                    }

                    // Hide Diff View Manually
                    const diffContainer = document.getElementById('diff-editor-container-tab');
                    if (diffContainer) diffContainer.style.display = 'none';

                    // Remove review mode class
                    tabInfo.element.classList.remove('review-mode');
                }

                // 3. Force UI Refresh without saving stale content
                // We pass a flag or just call it, but we need to ensure setActiveTab doesn't save *this* tab's stale content
                // Refactor setActiveTab to check `this.activeTab !== filePath` for saving.
                await this.setActiveTab(tabFilePath);
            }
            this.showNotification(`Changes applied to ${this.getFileNameFromPath(targetPath)}`, 'success');

            // Refresh file tree
            this.refreshFileTree();

        } catch (error) {
            this.showNotification(`Error applying edit: ${error.message}`, 'error');
        }
    }

    rejectSingleEdit(edit) {
        const filePath = edit.file_path;
        if (this.tabs.has(filePath)) {
            const tabInfo = this.tabs.get(filePath);

            if (edit.is_new) {
                // If it was a new file, just close the tab
                this.closeTab(filePath);
            } else {
                // If existing file, revert to normal view
                tabInfo.isDiff = false;
                tabInfo.editData = null;
                tabInfo.content = edit.original_content;
                
                // Update UI
                tabInfo.element.classList.remove('review-mode');
                
                // Force refresh if active
                if (this.activeTab === filePath) {
                    if (this.editor) this.editor.setValue(edit.original_content);
                    const diffContainer = document.getElementById('diff-editor-container-tab');
                    if (diffContainer) diffContainer.style.display = 'none';
                }
                
                this.setActiveTab(filePath);
            }
            this.showNotification('Edit rejected', 'info');

            // Remove from pending edits
            if (this.pendingEdits) {
                this.pendingEdits = this.pendingEdits.filter(e => e.file_path !== edit.file_path);
                
                // If no more pending edits, close panel
                if (this.pendingEdits.length === 0) {
                    const panel = document.querySelector('.review-panel');
                    if (panel) panel.remove();
                }
            }
        }
    }

    closeTab(filePath) {
        filePath = this.normalizePath(filePath);
        console.log(`Closing tab: ${filePath}`);

        // Stop watching file if no longer open
        // We use normalized keys now for watchers too in logic? 
        // Logic in openFile: fileSystemWatchers.delete(this.currentFile) -> currentFile is normalized.
        // So yes.
        if (this.fileSystemWatchers.has(filePath)) {
            this.fileSystemWatchers.get(filePath).close();
            this.fileSystemWatchers.delete(filePath);
        }

        if (this.tabs.has(filePath)) {
            const tab = this.tabs.get(filePath).element;
            tab.remove();
            this.tabs.delete(filePath);

            if (this.activeTab === filePath) {
                const remainingTabs = Array.from(this.tabs.keys());
                if (remainingTabs.length > 0) {
                    this.setActiveTab(remainingTabs[0]);
                } else {
                    // No tabs left - Clear editor
                    this.currentFile = null;
                    this.activeTab = null;
                    if (this.editor) {
                        this.editor.setValue('');
                        document.getElementById('file-path').textContent = '';
                        document.getElementById('language-status').querySelector('span').textContent = 'Plain Text';
                    }
                }
            }
        }
    }

    closeAllTabs() {
        console.log('Closing all tabs');

        // Stop all file watchers
        this.fileSystemWatchers.forEach(watcher => watcher.close());
        this.fileSystemWatchers.clear();

        this.tabs.clear();
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
            tabsContainer.innerHTML = '';
        }

        // Reset Editor State
        this.currentFile = null;
        this.activeTab = null;
        if (this.editor) {
            this.editor.setValue('');
            document.getElementById('file-path').textContent = '';
            const langStatus = document.getElementById('language-status');
            if (langStatus) langStatus.querySelector('span').textContent = 'Plain Text';
        }
    }

    createNewFile() {
        this.showNewFileDialog();
    }

    showNewFileDialog() {
        const dialog = document.getElementById('new-file-dialog');
        const input = document.getElementById('new-file-input');
        if (dialog && input) {
            input.value = 'newfile.js';
            dialog.style.display = 'flex';
            input.focus();
            input.select();
        }
    }

    hideNewFileDialog() {
        const dialog = document.getElementById('new-file-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    confirmNewFile() {
        const input = document.getElementById('new-file-input');
        const fileName = input ? input.value.trim() : '';

        if (!fileName) {
            this.showNotification('Please enter a file name', 'warning');
            return;
        }

        this.hideNewFileDialog();

        if (this.workspacePath) {
            window.electronAPI.createFile({
                folderPath: this.workspacePath,
                fileName: fileName
            }).then(filePath => {
                this.openFile(filePath, '', fileName);
            }).catch(error => {
                this.showNotification(`Failed to create file: ${error.message}`, 'error');
            });
        } else {
            // Create an untitled file that opens immediately
            // Use a virtual path prefix to indicate it's not saved yet
            const virtualPath = `/untitled/${fileName}`;
            this.openFile(virtualPath, '', fileName);
            this.showNotification('File created. Use Save As to choose a location.', 'info');
        }
    }

    createNewFolder() {
        this.showNewFolderDialog();
    }

    showNewFolderDialog() {
        const dialog = document.getElementById('new-folder-dialog');
        const input = document.getElementById('new-folder-input');
        if (dialog && input) {
            input.value = 'new_folder';
            dialog.style.display = 'flex';
            input.focus();
            input.select();
        }
    }

    hideNewFolderDialog() {
        const dialog = document.getElementById('new-folder-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    async confirmNewFolder() {
        const input = document.getElementById('new-folder-input');
        const folderName = input ? input.value.trim() : '';

        if (!folderName) {
            this.showNotification('Please enter a folder name', 'warning');
            return;
        }

        this.hideNewFolderDialog();

        try {
            await window.electronAPI.createFolder({
                folderPath: this.workspacePath || null,
                folderName: folderName
            });
            this.showNotification(`Folder "${folderName}" created successfully`, 'success');
        } catch (error) {
            if (error && error.message) {
                this.showNotification(`Failed to create folder: ${error.message}`, 'error');
            }
            // User may have cancelled the dialog, which is fine
        }
    }

    showRenameDialog(filePath, currentName) {
        const dialog = document.getElementById('rename-dialog');
        const input = document.getElementById('rename-input');

        this.renameContext = { filePath, currentName };
        input.value = currentName;
        dialog.style.display = 'flex';
        input.focus();
        input.select();
    }

    hideRenameDialog() {
        const dialog = document.getElementById('rename-dialog');
        dialog.style.display = 'none';
        this.renameContext = null;
    }

    async confirmRename() {
        if (!this.renameContext) return;

        const { filePath, currentName } = this.renameContext;
        const newName = document.getElementById('rename-input').value.trim();

        if (!newName || newName === currentName) {
            this.hideRenameDialog();
            return;
        }

        try {
            await window.electronAPI.renameFile({
                oldPath: filePath,
                newName: newName
            });
        } catch (error) {
            this.showNotification(`Failed to rename: ${error.message}`, 'error');
        }

        this.hideRenameDialog();
    }

    async saveCurrentFile() {
        if (!this.editor) return;

        const content = this.editor.getValue();
        const filePath = this.currentFile;

        if (!filePath || filePath.startsWith('/new/') || filePath.startsWith('/default/') || filePath.startsWith('/welcome/') || filePath.startsWith('/untitled/')) {
            await this.saveFileAs();
            return;
        }

        try {
            await window.electronAPI.saveFile({
                filePath: filePath,
                content: content
            });

            // Update tab status
            if (this.tabs.has(filePath)) {
                const tab = this.tabs.get(filePath);
                tab.saved = true;
                tab.element.classList.remove('unsaved');
            }

            // this.showNotification('File saved successfully', 'success');
        } catch (error) {
            this.showNotification(`Failed to save: ${error.message}`, 'error');
        }
    }

    async saveFileAs() {
        if (!this.editor) return;

        const content = this.editor.getValue();
        const currentFileName = this.currentFile ? this.getFileNameFromPath(this.currentFile) : 'untitled.js';

        this.showSaveAsDialog(content, currentFileName);
    }

    showSaveAsDialog(content, suggestedName) {
        const input = document.createElement('input');
        input.type = 'file';
        input.nwsaveas = suggestedName;
        input.accept = '.js,.ts,.jsx,.tsx,.html,.css,.py,.json,.md,.txt,.xml,.yaml,.yml,.java,.c,.cpp,.h,.cs,.php,.rb,.go,.rs,.sql';

        input.onchange = async (e) => {
            const filePath = e.target.files[0]?.path;
            if (filePath) {
                try {
                    await window.electronAPI.saveFile({
                        filePath: filePath,
                        content: content
                    });

                    const fileName = this.getFileNameFromPath(filePath);

                    // Close the old untitled tab if it exists
                    const oldPath = this.currentFile;
                    if (oldPath && oldPath.startsWith('/untitled/')) {
                        this.closeTab(oldPath);
                    }

                    this.openFile(filePath, content, fileName);
                    this.showNotification('File saved successfully', 'success');
                } catch (error) {
                    this.showNotification(`Failed to save: ${error.message}`, 'error');
                }
            }
        };

        input.click();
    }

    async deleteFile(filePath) {
        if (!filePath || filePath.startsWith('/')) {
            this.showNotification('Cannot delete default files', 'warning');
            return;
        }

        if (confirm('Are you sure you want to delete this file?')) {
            try {
                await window.electronAPI.deleteFile({ filePath });
            } catch (error) {
                this.showNotification(`Failed to delete: ${error.message}`, 'error');
            }
        }
    }

    async openFolder(folderPath, files, folderStructure) {
        console.log('Opening folder:', folderPath);

        this.workspacePath = folderPath;

        // Reset Workspace State
        this.closeAllTabs();
        this.clearAIChat();

        // Reset Chat and RAG
        const chatMessages = document.getElementById('ai-chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        this.aiChatHistory = [];

        const ragToggle = document.getElementById('rag-toggle');
        if (ragToggle) ragToggle.checked = true;

        try {
            await window.electronAPI.resetRAGIndex();
            this.indexCodebase(); // Trigger indexing (async)
        } catch (err) {
            console.error('Failed to reset RAG:', err);
        }

        // Use the folder structure if provided
        if (folderStructure) {
            this.fileTree = folderStructure;
        } else {
            // Build file tree from files
            this.fileTree = {
                name: this.getFileNameFromPath(folderPath),
                path: folderPath,
                type: 'folder',
                open: true,
                children: files || []
            };
        }

        this.renderFileTree();
        this.updateWorkspaceInfo(folderPath);

        // Sync terminal directory
        if (this.term) {
            window.electronAPI.terminalWrite(`cd "${folderPath}"\r`);
        }

        // Start watching folder
        this.watchWorkspaceFolder(folderPath);

        // this.showNotification(`Workspace opened: ${folderPath}`, 'success');
    }

    async openFolderFromPath(folderPath) {
        try {
            const structure = await window.electronAPI.getFolderStructure(folderPath);
            this.openFolder(folderPath, structure, {
                name: this.getFileNameFromPath(folderPath),
                path: folderPath,
                type: 'folder',
                open: true,
                children: structure
            });
        } catch (error) {
            console.error('Error opening folder:', error);
            this.showNotification(`Error opening folder: ${error.message}`, 'error');
        }
    }

    watchWorkspaceFolder(folderPath) {
        try {
            const fs = require('fs');
            const path = require('path');

            const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    const filePath = path.join(folderPath, filename);
                    console.log(`File system event: ${eventType} ${filename}`);

                    setTimeout(() => {
                        this.refreshFileTree();
                    }, 100);

                    if (eventType === 'change' && this.currentFile === filePath) {
                        this.handleExternalFileChange(filePath);
                    }
                }
            });

            this.fileWatchers.set(folderPath, watcher);
        } catch (error) {
            console.error('Error watching folder:', error);
        }
    }

    async refreshFileTree() {
        if (this.workspacePath) {
            try {
                const structure = await window.electronAPI.getFolderStructure(this.workspacePath);
                this.fileTree = {
                    name: this.getFileNameFromPath(this.workspacePath),
                    path: this.workspacePath,
                    type: 'folder',
                    open: true,
                    children: structure
                };
                this.renderFileTree();
            } catch (error) {
                console.error('Error refreshing file tree:', error);
            }
        }
    }

    async indexCodebase() {
        if (!this.workspacePath) {
            this.showNotification('No workspace open to index.', 'warning');
            return;
        }

        this.showNotification('Indexing codebase for RAG...', 'info');
        try {
            const result = await window.electronAPI.indexCodebase(this.workspacePath);
            if (result.success) {
                // this.showNotification(result.message || 'Codebase indexed successfully', 'success');
            } else {
                this.showNotification(`Indexing failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error during indexing: ${error.message}`, 'error');
        }
    }

    toggleAIPanel() {
        const aiPanel = document.getElementById('ai-panel');
        if (!aiPanel) {
            console.error('AI panel element not found');
            return;
        }

        this.aiPanelVisible = !this.aiPanelVisible;

        if (this.aiPanelVisible) {
            aiPanel.classList.remove('collapsed');
        } else {
            aiPanel.classList.add('collapsed');
        }
    }

    toggleTerminal() {
        const terminalPanel = document.getElementById('terminal-panel');
        if (!terminalPanel) {
            console.error('Terminal panel element not found');
            return;
        }

        this.terminalVisible = !this.terminalVisible;

        if (this.terminalVisible) {
            terminalPanel.classList.add('visible');
        } else {
            terminalPanel.classList.remove('visible');
        }
    }

    showTerminal() {
        this.terminalVisible = true;
        const terminalPanel = document.getElementById('terminal-panel');
        if (terminalPanel) {
            terminalPanel.classList.add('visible');
        }
    }

    clearTerminal() {
        const terminalOutput = document.querySelector('.terminal-output');
        if (terminalOutput) {
            terminalOutput.innerHTML = '';
        }
    }

    newTerminal() {
        this.showTerminal();
        this.addTerminalOutput('$ New terminal created');
    }

    addTerminalOutput(output, type = 'normal') {
        const terminalContent = document.getElementById('terminal-content');
        if (!terminalContent) {
            console.error('Terminal content element not found');
            return;
        }

        const outputDiv = document.createElement('div');
        outputDiv.className = `terminal-line ${type}`;
        outputDiv.textContent = output;

        const terminalOutput = terminalContent.querySelector('.terminal-output');
        if (terminalOutput) {
            terminalOutput.appendChild(outputDiv);
            terminalContent.scrollTop = terminalContent.scrollHeight;
        }
    }

    executeTerminalCommand(command) {
        this.addTerminalOutput(`$ ${command}`);

        switch (command.trim().toLowerCase()) {
            case 'help':
                this.addTerminalOutput('Available commands:');
                this.addTerminalOutput('  help - Show this help message');
                this.addTerminalOutput('  clear - Clear terminal');
                this.addTerminalOutput('  ls - List files in workspace');
                this.addTerminalOutput('  run - Run current file');
                this.addTerminalOutput('  date - Show current date and time');
                this.addTerminalOutput('  echo [text] - Echo text');
                this.addTerminalOutput('  backend - Check backend status');
                this.addTerminalOutput('  open [file] - Open a file');
                this.addTerminalOutput('  pwd - Show current directory');
                break;
            case 'clear':
                const terminalOutput = document.querySelector('.terminal-output');
                if (terminalOutput) {
                    terminalOutput.innerHTML = '';
                }
                break;
            case 'ls':
                this.addTerminalOutput('Files in workspace:');
                if (this.fileTree.children) {
                    this.fileTree.children.forEach(child => {
                        this.addTerminalOutput(`  ${child.name} (${child.type})`);
                    });
                } else {
                    this.addTerminalOutput('  No workspace open');
                }
                break;
            case 'run':
                this.runCurrentFile();
                break;
            case 'date':
                this.addTerminalOutput(new Date().toString());
                break;
            case 'backend':
                this.checkBackendHealth();
                this.addTerminalOutput('Checking backend status...');
                break;
            case 'pwd':
                this.addTerminalOutput(this.workspacePath || 'No workspace open');
                break;
            default:
                if (command.startsWith('echo ')) {
                    this.addTerminalOutput(command.substring(5));
                } else if (command.startsWith('open ')) {
                    const fileName = command.substring(5).trim();
                    this.openFileFromTerminal(fileName);
                } else {
                    this.addTerminalOutput(`Command not found: ${command}`, 'error');
                }
        }
    }

    openFileFromTerminal(fileName) {
        if (!this.workspacePath) {
            this.addTerminalOutput('Error: No workspace open', 'error');
            return;
        }

        const path = require('path');
        const filePath = path.join(this.workspacePath, fileName);

        try {
            const fs = require('fs');
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                this.openFile(filePath, content, fileName);
                this.addTerminalOutput(`Opened file: ${fileName}`);
            } else {
                this.addTerminalOutput(`File not found: ${fileName}`, 'error');
            }
        } catch (error) {
            this.addTerminalOutput(`Error opening file: ${error.message}`, 'error');
        }
    }

    async handleAIAction(action) {
        console.log(`Handling AI action: ${action}`);

        if (!this.editor) {
            this.showNotification('Editor not initialized', 'error');
            return;
        }

        const code = this.editor.getValue();
        const selection = this.editor.getSelection();
        const selectedText = selection ?
            this.editor.getModel().getValueInRange(selection) : '';

        const language = this.getLanguageFromExtension(this.currentFile || 'script.js');

        this.showNotification('Connecting to AI backend...', 'info');

        try {
            let result;

            switch (action) {
                case 'generate_docs':
                    this.showNotification('Generating documentation...', 'info');

                    let contentToDocument = code;
                    let contextInfo = `Language: ${language}\nFile: ${this.currentFile || 'untitled'}`;
                    let filename = `Docs_${this.getFileNameFromPath(this.currentFile || 'untitled')}.pdf`;

                    // If workspace is open, try to document the whole project
                    if (this.workspacePath) {
                        this.showNotification('Gathering project files...', 'info');
                        const projectContent = await window.electronAPI.getProjectContent(this.workspacePath);
                        if (projectContent && projectContent.length > 0) {
                            contentToDocument = projectContent;
                            contextInfo = `Project: ${this.workspacePath}\nContains multiple files.`;
                            filename = `Docs_Project_${this.getFileNameFromPath(this.workspacePath)}.pdf`;
                        }
                    }

                    if (!contentToDocument) {
                        this.showNotification('No code found to document.', 'warning');
                        return;
                    }

                    result = await window.electronAPI.generateDocumentation(
                        contentToDocument,
                        contextInfo
                    );

                    if (result.success) {
                        const blob = new Blob([result.data], { type: 'application/pdf' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);

                        // this.showNotification('Documentation downloaded successfully', 'success');
                        this.addAIMessage('ai', `PDF Documentation generated and downloaded.`);
                    } else {
                        this.showNotification(`Error: ${result.error}`, 'error');
                    }
                    break;

                case 'explain':
                    result = await window.electronAPI.explainCode(
                        selectedText || code,
                        language
                    );
                    if (result.success) {
                        this.addAIMessage('ai', `**Explanation:**\n\n${result.explanation}`);
                    } else {
                        this.showNotification(`Explain Error: ${result.error}`, 'error');
                    }
                    break;

                case 'debug':
                    result = await window.electronAPI.debugCode(
                        selectedText || code,
                        language
                    );
                    if (result.success) {
                        this.editor.setValue(result.debugged_code);
                        this.addAIMessage('ai', `**Debug Result:**\n\n${result.explanation}`);
                    } else {
                        this.showNotification(`Debug Error: ${result.error}`, 'error');
                    }
                    break;

                case 'optimize':
                    result = await window.electronAPI.optimizeCode(
                        selectedText || code,
                        language,
                        'performance'
                    );
                    if (result.success) {
                        this.editor.setValue(result.optimized_code);
                        this.addAIMessage('ai', `**Optimization Result:**\n\n${result.explanation}`);
                    } else {
                        this.showNotification(`Optimize Error: ${result.error}`, 'error');
                    }
                    break;

                case 'test':
                    result = await window.electronAPI.writeTests(
                        selectedText || code,
                        language
                    );
                    if (result.success) {
                        this.addAIMessage('ai', `**Tests Generated:**\n\n\`\`\`${language}\n${result.tests}\n\`\`\`\n\n${result.test_explanation}`);
                    } else {
                        this.showNotification(`Test Error: ${result.error}`, 'error');
                    }
                    break;

                case 'document':
                    result = await window.electronAPI.documentCode(
                        selectedText || code,
                        language
                    );
                    if (result.success) {
                        this.editor.setValue(result.documented_code);
                        this.addAIMessage('ai', `**Documentation added:**\n\n${result.documentation}`);
                    } else {
                        this.showNotification(`Document Error: ${result.error}`, 'error');
                    }
                    break;
                    break;
                case 'edit':
                    // Multi-file edit requested
                    // The backend should return a plan or list of edits
                    // We'll treat this differently - maybe call a different endpoint or handle 'task' param

                    // For now, let's assume specific endpoint usage if action is 'edit'
                    // Implementation below
                    break;
            }

        } catch (error) {
            console.error('AI action error:', error);
            this.showNotification(`AI Error: ${error.message}`, 'error');
        }
    }



    simulateProgress(elementId) {
        const phases = [
            "Analyzing context...",
            "Reading files...",
            "Planning changes...",
            "Designing solution...",
            "Generating code...",
            "Reviewing changes...",
            "Finalizing..."
        ];

        let phaseIndex = 0;
        const element = document.getElementById(elementId);

        const interval = setInterval(() => {
            const el = document.getElementById(elementId);
            if (el) {
                phaseIndex = (phaseIndex + 1) % phases.length;
                el.textContent = phases[phaseIndex];
                // Optional: Scroll to bottom if needed
                const messages = document.getElementById('ai-chat-messages');
                if (messages) messages.scrollTop = messages.scrollHeight;
            }
        }, 2000); // Update every 2 seconds

        return () => clearInterval(interval);
    }

    async openEditAsDiff(edit) {
        const filePath = edit.file_path;

        // ensure file is open (creates tab if needed)
        if (edit.is_new) {
            const fileName = this.getFileNameFromPath(filePath);
            if (!this.tabs.has(filePath)) {
                this.createTab(filePath, fileName);
            }
        } else {
            // Open existing file
            try {
                // We use openFile to ensure tab exists and content loaded
                await this.openFile(filePath, null, this.getFileNameFromPath(filePath));
            } catch (e) {
                console.warn("Could not open file from disk (maybe new?):", e);
            }
        }

        // hijacked tab for diff view
        if (this.tabs.has(filePath)) {
            const tabInfo = this.tabs.get(filePath);
            tabInfo.isDiff = true;
            tabInfo.editData = edit;

            // Force refresh to show diff
            this.setActiveTab(filePath);
        }
    }

    // Override/Extend setTabContent to handle diff editors?
    // Current architecture creates one editor `this.editor`.
    // We need to support swapping the editor instance or model.
    // simpler approach: When active tab is a Diff tab, dispose default editor (or hide) and show diff editor.

    // NOTE: For this step, I'll modify setActiveTab in a subsequent edit or assume I can inject logic here. 
    // Actually, `setActiveTab` logic is complex. Let's try to hook into the existing system by:
    // 1. Modifying `setActiveTab` to check for `isDiff` flag.
    // 2. If diff, render DiffEditor.



    setChatMode(mode) {
        this.currentMode = mode;

        // Update UI
        const chatBtn = document.getElementById('mode-chat');
        const agentBtn = document.getElementById('mode-agent');

        if (chatBtn && agentBtn) {
            if (mode === 'chat') {
                chatBtn.classList.add('active');
                chatBtn.style.background = '#007acc';
                chatBtn.style.color = 'white';

                agentBtn.classList.remove('active');
                agentBtn.style.background = 'transparent';
                agentBtn.style.color = '#858585';
            } else {
                agentBtn.classList.add('active');
                agentBtn.style.background = '#4ec9b0';
                agentBtn.style.color = '#1e1e1e';

                chatBtn.classList.remove('active');
                chatBtn.style.background = 'transparent';
                chatBtn.style.color = '#858585';
            }
        }
    }

    async sendAIMessage() {
        if (this.isProcessing) return;

        const input = document.getElementById('ai-input');
        if (!input) {
            console.error('AI input element not found');
            return;
        }

        const message = input.value.trim();

        if (!message) {
            this.showNotification('Please enter a message', 'warning');
            return;
        }

        // Detect if this is an explicit edit command
        if (message.toLowerCase().startsWith('/edit') || message.toLowerCase().includes('change current file')) {
            // For now, hook into chat, but ideally we parse intent
        }

        // Git Agent Commands
        if (message.match(/^(git\s+)?push(\s+code|\s+to\s+github)?/i)) {
            this.addAIMessage('user', message);
            input.value = '';
            this.showAITypingIndicator();

            this.addAIMessage('ai', 'Pushing changes to GitHub...');
            try {
                const result = await window.electronAPI.gitPush(this.workspacePath, null, this.ghToken);
                this.hideAITypingIndicator();
                if (result.success) {
                    this.addAIMessage('ai', '✅ Changes pushed successfully!');
                    this.loadGitHistory();
                } else {
                    this.addAIMessage('ai', `❌ Push failed: ${result.error}`);
                }
            } catch (e) {
                this.hideAITypingIndicator();
                this.addAIMessage('ai', `❌ Error: ${e.message}`);
            }
            return;
        }

        if (message.match(/^(git\s+)?pull(\s+code|\s+from\s+github)?/i)) {
            this.addAIMessage('user', message);
            input.value = '';
            this.showAITypingIndicator();

            this.addAIMessage('ai', 'Pulling changes from GitHub...');
            try {
                const result = await window.electronAPI.gitPull(this.workspacePath);
                this.hideAITypingIndicator();
                if (result.success) {
                    this.addAIMessage('ai', '✅ Changes pulled successfully!');
                    this.refreshFileTree();
                    this.loadGitHistory();
                } else {
                    if (result.is_conflict) {
                        this.addAIMessage('ai', `⚠️ Merge Conflict detected in:\nGUI-based resolution is recommended.\n\nConflicted files:\n- ${result.conflicts.join('\n- ')}`);
                    } else {
                        this.addAIMessage('ai', `❌ Pull failed: ${result.error}`);
                    }
                }
            } catch (e) {
                this.hideAITypingIndicator();
                this.addAIMessage('ai', `❌ Error: ${e.message}`);
            }
            return;
        }

        this.addAIMessage('user', message);

        input.value = '';

        this.showAITypingIndicator();

        try {
            console.log("DEBUG: sendAIMessage Mode:", this.currentMode);
            const messages = document.getElementById('ai-chat-messages');
            const history = [];
            if (messages) {
                const messageElements = messages.querySelectorAll('.message');
                messageElements.forEach(el => {
                    if (el.classList.contains('user-message')) {
                        history.push({
                            role: 'user',
                            content: el.querySelector('.message-text').textContent
                        });
                    } else if (el.classList.contains('ai-message')) {
                        history.push({
                            role: 'assistant',
                            content: el.querySelector('.message-text').textContent
                        });
                    }
                });
            }

            const code = this.editor ? this.editor.getValue() : '';
            const language = this.getLanguageFromExtension(this.currentFile || 'script.js');

            // Check for RAG toggle
            const useRag = !!this.workspacePath;

            const context = {
                current_code: code.substring(0, 1000),
                current_language: language,
                current_file: this.currentFile || 'Untitled',
                use_rag: useRag
            };

            // Check Mode
            this.isProcessing = true;
            this.updateSendButtonState(true);
            
            if (this.currentMode === 'agent') {
                // Agent Mode: Use Multi-File Workflow
                this.hideAITypingIndicator();
                await this.handleMultiFileEdit(message);
                this.isProcessing = false;
                this.updateSendButtonState(false);
                return;
            } else {
                // Chat Mode: Use Standard RAG Chat
                const response = await window.electronAPI.chat(message, history, context);
                this.hideAITypingIndicator();

                if (response.success) {
                    this.addAIMessage('ai', response.response);
                } else {
                    this.addAIMessage('ai', `**Error:** ${response.error}`);
                }
                this.isProcessing = false;
                this.updateSendButtonState(false);
                return;
            }



        } catch (error) {
            this.hideAITypingIndicator();
            this.isProcessing = false;
            this.updateSendButtonState(false);
            console.error('AI chat error:', error);
            this.addAIMessage('ai', `**Chat Error:** ${error.message}\n\nMake sure Flask backend is running: python app.py in backend directory`);
        }
    }

    updateSendButtonState(isProcessing) {
        const btn = document.getElementById('send-ai-message');
        if (btn) {
            btn.disabled = isProcessing;
            btn.style.opacity = isProcessing ? '0.5' : '1';
            btn.style.cursor = isProcessing ? 'not-allowed' : 'pointer';
        }
    }

    async handleMultiFileEdit(task) {
        try {
            // Maxwell's Demon: Sorting the fast (in memory) from the slow (needs fetching)
            // 1. Collect potential context files
            let contextFiles = [];

            // Add current file
            if (this.currentFile && !this.currentFile.startsWith('Untitled')) {
                contextFiles.push(this.currentFile);
            }

            // Add open tabs
            for (const [filePath, tab] of this.tabs.entries()) {
                if (filePath && !filePath.startsWith('Untitled')) {
                    contextFiles.push(filePath);
                }
            }

            // Add visible files in root (simple heuristic for now, RAG will handle deep search)
            if (this.fileTree && this.fileTree.children) {
                this.fileTree.children.forEach(child => {
                    if (child.type === 'file' && !contextFiles.includes(child.path)) {
                        contextFiles.push(child.path);
                    }
                });
            }

            contextFiles = [...new Set(contextFiles)]; // Dedupe


            console.log('Sending multi-file edit request:', { task, files: contextFiles });

            this.addAIMessage('ai', `Analyzing request...`);
            this.showAITypingIndicator();

            const result = await window.electronAPI.multiFileEdit(task, contextFiles);

            this.hideAITypingIndicator();

            if (result.success) {
                if (result.edits && result.edits.length > 0) {
                    const newFiles = result.edits.filter(e => e.is_new).map(e => this.getFileNameFromPath(e.file_path));
                    const modifiedFiles = result.edits.filter(e => !e.is_new).map(e => this.getFileNameFromPath(e.file_path));

                    let summary = '';

                    // Add File Summary
                    summary += `### Proposed Changes\n`;
                    if (newFiles.length > 0) summary += newFiles.map(f => `- **[NEW]** \`${f}\``).join('\n') + '\n';
                    if (modifiedFiles.length > 0) summary += modifiedFiles.map(f => `- **[MOD]** \`${f}\``).join('\n') + '\n';
                    
                    summary += `\n**Status:** Opening ${result.edits.length} files for review...`;
                    
                    this.addAIMessage('ai', summary);
                } else if (result.plan) {
                    this.addAIMessage('ai', result.plan);
                }

                // Cursor-like Review: Open tabs and set them to Diff Mode
                if (result.edits && result.edits.length > 0) {
                    // Message already sent above

                    // Store edits for review actions (Accept/Reject)
                    this.pendingEdits = result.edits;

                    for (const edit of result.edits) {
                        // PRE-FIX: Resolve path against workspace if it looks relative
                        let filePath = edit.file_path;
                        if (this.workspacePath && window.electronAPI.resolvePath && !filePath.includes(':') && !filePath.startsWith('/')) {
                            // It's likely relative, force it to be inside workspace
                            filePath = window.electronAPI.resolvePath(this.workspacePath, filePath);
                            console.log(`Resolved agent path ${edit.file_path} -> ${filePath}`);
                            edit.file_path = filePath; // Update the edit object itself
                        }

                        // Normalize path immediately to match tab system
                        filePath = this.normalizePath(filePath);
                        const fileName = this.getFileNameFromPath(filePath);

                        // 1. Ensure Original Content exists
                        if (!edit.is_new && !edit.original_content) {
                            try {
                                const fs = require('fs');
                                if (fs.existsSync(edit.file_path)) {
                                    edit.original_content = fs.readFileSync(edit.file_path, 'utf-8');
                                }
                            } catch (e) {
                                console.error('Error reading original content:', e);
                                edit.original_content = ''; // Fallback
                            }
                        }

                        // 1.5 Apply Hunks Client-Side (if applicable)
                        if (edit.hunks && edit.hunks.length > 0 && edit.original_content) {
                            console.log(`Applying ${edit.hunks.length} hunks to ${fileName}`);
                            let content = edit.original_content;
                            let success = true;

                            // Sort hunks? Usually they come in order. simple sequential replace should work 
                            // if search blocks are unique enough.
                            for (const hunk of edit.hunks) {
                                // Normalize newlines in search block to match file system content if needed?
                                // Or just rely on string replacement
                                if (content.includes(hunk.search)) {
                                    content = content.replace(hunk.search, hunk.replace);
                                } else {
                                    console.warn(`Hunk failed: Could not find search block in ${fileName}`, hunk.search);
                                    success = false;
                                    // TODO: Visual warning?
                                }
                            }

                            edit.new_content = content;
                            edit.patchSuccess = success;
                        } else if (!edit.new_content && !edit.is_new) {
                            // If no new_content and no hunks, maybe no changes?
                            edit.new_content = edit.original_content;
                        }

                        // 2. Pre-configure Tab State for Diff View
                        // We set this BEFORE openFile so that when openFile calls setActiveTab,
                        // it renders the Diff View directly, avoiding double-rendering/flashing.

                        if (!this.tabs.has(filePath)) {
                            this.createTab(filePath, fileName);
                        }

                        const tabInfo = this.tabs.get(filePath);
                        if (tabInfo) {
                            tabInfo.isDiff = true;
                            tabInfo.editData = edit;
                            tabInfo.element.classList.add('review-mode');
                        }

                        // 3. Open the file (updates content and activates tab)
                        const contentToLoad = edit.is_new ? '' : (edit.original_content || '');
                        await this.openFile(filePath, contentToLoad, fileName);

                        // Note: openFile -> setActiveTab will see isDiff=true and render the Diff Editor.
                    }

                    // activate the first one again to ensure focus on the list
                    if (result.edits.length > 0) {
                        this.setActiveTab(result.edits[0].file_path);
                    }

                    // Show Review Panel
                    this.showEditPreview(result.edits);

                } else {
                    this.addAIMessage('ai', `Analyzed context but found no code changes needed.`);
                }
            } else {
                this.addAIMessage('ai', `**Error executing workflow:** ${result.error}`);
            }

        } catch (error) {
            this.hideAITypingIndicator();
            console.error('Workflow error:', error);
            this.addAIMessage('ai', `**Workflow Error:** ${error.message}`);
        }
    }

    showEditPreview(edits) {
        this.pendingEdits = edits;

        // Remove existing review panel if any
        const existingPanel = document.querySelector('.review-panel');
        if (existingPanel) existingPanel.remove();

        const messages = document.getElementById('ai-chat-messages');

        const panel = document.createElement('div');
        panel.className = 'review-panel';

        let fileListHtml = '';
        edits.forEach((edit, index) => {
            const fileName = this.getFileNameFromPath(edit.file_path);
            const status = edit.is_new ? 'New' : 'Modified';
            const statusClass = edit.is_new ? 'status-new' : 'status-modified';

            fileListHtml += `
                <div class="review-file-item" onclick="codeEditor.showDiff(${index})">
                    <i class="fas ${this.getFileIcon(fileName)}"></i>
                    <span style="flex:1">${fileName}</span>
                    <span class="file-status ${statusClass}">${status}</span>
                </div>
            `;
        });

        panel.innerHTML = `
            <div class="review-header">
                <div class="review-title">
                    <i class="fas fa-edit"></i> Review Changes (${edits.length})
                </div>
            </div>
            <div class="review-files">
                ${fileListHtml}
            </div>
        `;

        messages.appendChild(panel);
        messages.scrollTop = messages.scrollHeight;
    }

    async showDiff(editIndex) {
        const edit = this.pendingEdits[editIndex];
        if (!edit) return;

        // 1. Get Original Content
        let originalContent = '';
        if (!edit.is_new) {
            try {
                // Try reading from file system
                const result = await window.electronAPI.readFileContent(edit.file_path);
                originalContent = result;
            } catch (e) {
                console.warn('Could not read original file for diff:', e);
            }
        }

        const modifiedContent = edit.new_content;
        const language = this.getLanguageFromExtension(this.getFileNameFromPath(edit.file_path));

        // 2. Setup Diff Editor UI
        let diffContainer = document.getElementById('diff-editor-container');
        if (!diffContainer) {
            diffContainer = document.createElement('div');
            diffContainer.id = 'diff-editor-container';
            diffContainer.className = 'diff-editor-container';
            diffContainer.innerHTML = `
                <div class="diff-editor-header">
                    <span style="font-weight:600; margin-right:10px;">Diff: ${this.getFileNameFromPath(edit.file_path)}</span>
                    <div class="diff-actions" style="display:flex; gap:10px; margin-right:auto; margin-left:20px;">
                        <button class="btn-review btn-accept" onclick="codeEditor.acceptSingleEdit(${editIndex})" style="padding: 4px 12px; font-size: 12px; background: #4caf50; border: none; color: white; border-radius: 4px; cursor: pointer;">Accept</button>
                        <button class="btn-review btn-reject" onclick="codeEditor.rejectSingleEdit(${editIndex})" style="padding: 4px 12px; font-size: 12px; background: #f44336; border: none; color: white; border-radius: 4px; cursor: pointer;">Reject</button>
                    </div>
                    <span class="diff-editor-close" onclick="codeEditor.closeDiffView()">
                        <i class="fas fa-times"></i>
                    </span>
                </div>
                <div id="diff-monaco" class="diff-editor-content"></div>
            `;
            document.body.appendChild(diffContainer);
        }

        diffContainer.style.display = 'flex';

        // 3. Initialize Monaco Diff Editor
        if (this.diffEditor) {
            this.diffEditor.dispose();
        }

        require(['vs/editor/editor.main'], () => {
            const originalModel = monaco.editor.createModel(originalContent, language);
            const modifiedModel = monaco.editor.createModel(modifiedContent, language);

            this.diffEditor = monaco.editor.createDiffEditor(document.getElementById('diff-monaco'), {
                theme: 'vs-dark',
                readOnly: true,
                originalEditable: false,
                automaticLayout: true
            });

            this.diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel
            });
        });
    }

    closeDiffView() {
        const diffContainer = document.getElementById('diff-editor-container');
        if (diffContainer) {
            diffContainer.style.display = 'none';
        }
        if (this.diffEditor) {
            this.diffEditor.dispose();
            this.diffEditor = null;
        }
    }

    async acceptEdits() {
        if (!this.pendingEdits || this.pendingEdits.length === 0) return;

        // Remove review panel
        const panel = document.querySelector('.review-panel');
        if (panel) panel.remove();

        this.closeDiffView();

        await this.applyAllEdits(this.pendingEdits);
        this.pendingEdits = [];
    }

    async acceptSingleEdit(index) {
        if (!this.pendingEdits || !this.pendingEdits[index]) return;
        const edit = this.pendingEdits[index];
        
        this.showNotification(`Accepting changes for ${this.getFileNameFromPath(edit.file_path)}...`, 'info');
        
        try {
            await this.applySingleEdit(edit);
            
            this.closeDiffView();
            
            // Explicitly hide the Tab-based diff container
            const diffContainerTab = document.getElementById('diff-editor-container-tab');
            if (diffContainerTab) diffContainerTab.style.display = 'none';

            // Remove from list
            this.pendingEdits.splice(index, 1);
            
            if (this.pendingEdits.length === 0) {
                 const panel = document.querySelector('.review-panel');
                 if (panel) panel.remove();
                 this.showNotification('All changes handled.', 'success');
                 this.indexCodebase();
            } else {
                 this.showEditPreview(this.pendingEdits);
            }
            
        } catch (e) {
             this.showNotification(`Error accepting edit: ${e.message}`, 'error');
        }
    }

    async rejectSingleEdit(index) {
        if (!this.pendingEdits || !this.pendingEdits[index]) return;
        const edit = this.pendingEdits[index];
        
        try {
            // Revert State
            if (edit.is_new) {
                // For new files, we just close the tab.
                // But first, ensure we don't try to "save" it when switching tabs in closeTab
                // (The setActiveTab fix handles this if isDiff is true, but let's be safe)
                this.closeTab(edit.file_path);
            } else {
                let filePath = edit.file_path;
                 if (!this.tabs.has(filePath)) filePath = this.normalizePath(filePath);
                 
                 if (this.tabs.has(filePath)) {
                     const tabInfo = this.tabs.get(filePath);
                     tabInfo.isDiff = false;
                     tabInfo.editData = null;
                     
                     // Restore original content
                     if (edit.original_content !== undefined) {
                         tabInfo.content = edit.original_content;
                     }
                     tabInfo.element.classList.remove('review-mode');
                     
                     // If this is the active tab, we MUST force the editor to show the original content
                     if (this.activeTab === filePath && this.editor) {
                         this.editor.setValue(tabInfo.content);
                     }
                 }
            }
            
            this.closeDiffView();

            // Explicitly hide the Tab-based diff container if it exists
            const diffContainerTab = document.getElementById('diff-editor-container-tab');
            if (diffContainerTab) diffContainerTab.style.display = 'none';
            
            this.pendingEdits.splice(index, 1);
            
            if (this.pendingEdits.length === 0) {
                 const panel = document.querySelector('.review-panel');
                 if (panel) panel.remove();
                 this.showNotification('All changes handled.', 'success');
            } else {
                 this.showEditPreview(this.pendingEdits);
            }
            
        } catch (e) {
             console.error(e);
             this.showNotification('Error rejecting edit', 'error');
        }
    }

    async applySingleEdit(edit) {
        console.log(`Applying edit for ${edit.file_path}`);
        
        if (edit.is_new) {
            await window.electronAPI.createFile({
                folderPath: this.workspacePath,
                fileName: this.getFileNameFromPath(edit.file_path)
            });
        }

        await window.electronAPI.saveFile({
            filePath: edit.file_path,
            content: edit.new_content
        });

        // Reset Tab State
        let filePath = edit.file_path;
        if (!this.tabs.has(filePath)) {
             filePath = this.normalizePath(filePath);
        }

        if (this.tabs.has(filePath)) {
            const tabInfo = this.tabs.get(filePath);
            tabInfo.isDiff = false;
            tabInfo.editData = null;
            tabInfo.content = edit.new_content; 

            tabInfo.element.classList.remove('review-mode');
            
            if (this.activeTab === filePath && this.editor) {
                this.editor.setValue(tabInfo.content);
            }
        }
    }

    async applyAllEdits(edits) {
        if (!edits || edits.length === 0) return;

        this.showNotification(`Applying ${edits.length} edits...`, 'info');

        for (const edit of edits) {
            await this.applySingleEdit(edit);
        }

        this.showNotification('All edits applied successfully', 'success');
        this.indexCodebase();
    }

    rejectEdits() {
        console.log('Rejecting edits...');
        this.showNotification('Rejecting changes...', 'info');
        
        try {
            if (this.pendingEdits && this.pendingEdits.length > 0) {
                console.log(`Processing rejection for ${this.pendingEdits.length} edits`);
                
                this.pendingEdits.forEach(edit => {
                    if (edit.is_new) {
                        // For new files, we just want to close the tab effectively cancelling creation
                        console.log(`Closing new file tab: ${edit.file_path}`);
                        this.closeTab(edit.file_path);
                    } else {
                        // For existing files, revert to original content and turn off diff mode
                        console.log(`Reverting existing file: ${edit.file_path}`);
                        const filePath = this.normalizePath(edit.file_path);
                        
                        if (this.tabs.has(filePath)) {
                            const tabInfo = this.tabs.get(filePath);
                            
                            // Reset Tab State
                            tabInfo.isDiff = false;
                            tabInfo.editData = null;
                            
                            // crucial: ensure we revert to original content
                            if (edit.original_content !== undefined) {
                                tabInfo.content = edit.original_content;
                            }
                            
                            // Update UI
                            tabInfo.element.classList.remove('review-mode');
                            
                            // If this is active tab, force refresh editor
                            if (this.activeTab === filePath) {
                                if (this.editor) {
                                    this.editor.setValue(tabInfo.content);
                                    
                                    // Hide Diff View
                                    const diffContainer = document.getElementById('diff-editor-container-tab');
                                    if (diffContainer) diffContainer.style.display = 'none';
                                }
                            }
                        }
                    }
                });
            } else {
                console.log('No pending edits found to reject');
            }

            // Cleanup UI
            const panel = document.querySelector('.review-panel');
            if (panel) panel.remove();
            
            // Clear pending edits
            this.pendingEdits = [];
            
            this.addAIMessage('ai', '❌ Changes rejected. Your files have been restored.');
            this.showNotification('Edits rejected successfully', 'success');
            
        } catch (error) {
            console.error('Error rejecting edits:', error);
            this.showNotification('Failed to reject edits', 'error');
        }
    }

    async indexCodebase() {
        if (!this.workspacePath) {
            this.showNotification('Please open a folder first', 'warning');
            const ragToggle = document.getElementById('rag-toggle');
            if (ragToggle) ragToggle.checked = false;
            return;
        }

        // Visual feedback on the toggle label or notification
        this.showNotification('Indexing codebase...', 'info');
        try {
            const result = await window.electronAPI.indexCodebase(this.workspacePath);

            if (result.success) {
                this.showNotification(`Indexed ${result.files} files`, 'success');
            } else {
                this.showNotification(`Indexing failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Indexing error: ${error.message}`, 'error');
        }
    }

    showAITypingIndicator() {
        const messages = document.getElementById('ai-chat-messages');
        if (!messages) return;

        const typingIndicator = document.createElement('div');
        typingIndicator.id = 'ai-typing-indicator';
        typingIndicator.className = 'message ai-message fade-in';
        typingIndicator.innerHTML = `
            <div class="message-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="message-content">
                <div class="message-sender">AI Assistant</div>
                <div class="message-text typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;

        messages.appendChild(typingIndicator);
        messages.scrollTop = messages.scrollHeight;
    }

    hideAITypingIndicator() {
        const typingIndicator = document.getElementById('ai-typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    addAIMessage(sender, content) {
        const messages = document.getElementById('ai-chat-messages');
        if (!messages) {
            console.error('AI chat messages element not found');
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message fade-in hover-lift`;

        messageDiv.innerHTML = `
            <div class="message-avatar">
                <i class="fas ${sender === 'ai' ? 'fa-robot' : 'fa-user'}"></i>
            </div>
            <div class="message-content">
                <div class="message-sender">${sender === 'ai' ? 'AI Assistant' : 'You'}</div>
                <div class="message-text">${this.formatAIContent(content)}</div>
            </div>
        `;

        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;

        if (sender === 'user') {
            this.aiChatHistory.push({ role: 'user', content: content });
        } else if (sender === 'ai') {
            this.aiChatHistory.push({ role: 'assistant', content: content });
        }
    }

    addChatAction(label, callback) {
        const messages = document.getElementById('ai-chat-messages');
        if (!messages) return;

        const actionDiv = document.createElement('div');
        actionDiv.className = 'chat-action fade-in';
        actionDiv.style.textAlign = 'center';
        actionDiv.style.margin = '10px 0';
        actionDiv.style.display = 'flex';
        actionDiv.style.justifyContent = 'center';

        const button = document.createElement('button');
        button.className = 'btn-primary';
        button.innerHTML = `<i class="fas fa-magic"></i> ${label}`;
        button.style.fontSize = '12px';
        button.style.padding = '8px 20px';
        button.style.borderRadius = '20px';
        button.style.border = 'none';
        button.style.boxShadow = '0 4px 15px rgba(0, 255, 255, 0.2)';
        button.style.transition = 'all 0.3s ease';

        button.onclick = async () => {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';
            await callback();
            button.innerHTML = '<i class="fas fa-check"></i> Done';
            button.style.backgroundColor = '#4caf50'; // Green
        };

        actionDiv.appendChild(button);
        messages.appendChild(actionDiv);
        messages.scrollTop = messages.scrollHeight;
    }

    configureMarked() {
        if (typeof marked === 'undefined') return;
        
        const renderer = new marked.Renderer();
        
        // Custom code block renderer
        renderer.code = (code, language) => {
            const validLanguage = Prism.languages[language] ? language : 'javascript';
            const highlighted = Prism.languages[validLanguage] ? 
                Prism.highlight(code, Prism.languages[validLanguage], validLanguage) : 
                this.escapeHtml(code);
                
            return `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span class="code-language">${validLanguage}</span>
                        <button class="copy-btn" onclick="codeEditor.copyToClipboard(this)">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                    </div>
                    <pre><code class="language-${validLanguage}">${highlighted}</code></pre>
                    <div class="code-content" style="display:none">${this.escapeHtml(code)}</div>
                </div>
            `;
        };

        marked.setOptions({
            renderer: renderer,
            highlight: function(code, lang) {
                if (Prism.languages[lang]) {
                    return Prism.highlight(code, Prism.languages[lang], lang);
                } else {
                    return code;
                }
            },
            pedantic: false,
            gfm: true,
            breaks: true,
            sanitize: false,
            smartLists: true,
            smartypants: false,
            xhtml: false
        });
    }

    formatAIContent(content) {
        if (typeof marked === 'undefined') {
            // Fallback if marked is not loaded
            return this.simpleFormat(content);
        }
        
        // Ensure marked is configured
        if (!this.markedConfigured) {
            this.configureMarked();
            this.markedConfigured = true;
        }
        
        try {
            return marked.parse(content);
        } catch (e) {
            console.error('Error parsing markdown:', e);
            return this.simpleFormat(content);
        }
    }

    simpleFormat(content) {
        let formatted = content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');

        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        formatted = formatted.replace(codeBlockRegex, (match, lang, code) => {
            const language = lang || 'javascript';
            return `<div class="code-block" data-language="${language}">${this.escapeHtml(code)}</div>`;
        });

        return formatted;
    }

    copyToClipboard(btn) {
        const wrapper = btn.closest('.code-block-wrapper');
        const content = wrapper.querySelector('.code-content').textContent;
        
        navigator.clipboard.writeText(content).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.classList.add('copied');
            
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('copied');
            }, 2000);
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearAIChat() {
        const messages = document.getElementById('ai-chat-messages');
        if (messages) {
            messages.innerHTML = `
                <div class="message ai-message">
                    <div class="message-avatar">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="message-content">
                        <div class="message-sender">AI Assistant</div>
                        <div class="message-text">
                            Hello! I'm your AI coding assistant powered by LangChain. I can help you generate, explain, debug, and optimize code. How can I assist you today?
                        </div>
                    </div>
                </div>
            `;
            this.aiChatHistory = [];
        }
    }

    attachFileToChat() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = false;

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    this.addAIMessage('user', `**Attached file:** ${file.name}\n\n\`\`\`\n${content.substring(0, 1000)}\n\`\`\``);
                };
                reader.readAsText(file);
            }
        };

        input.click();
    }

    showAISettings() {
        this.showNotification('AI settings feature coming soon!', 'info');
    }

    updateOutline() {
        const outlineContent = document.getElementById('outline-content');
        if (!outlineContent) return;

        if (!this.editor) return;

        const content = this.editor.getValue();
        outlineContent.innerHTML = '';

        const lines = content.split('\n');
        let hasContent = false;

        lines.forEach((line, index) => {
            const trimmed = line.trim();

            if (trimmed.startsWith('function ') || trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ') || trimmed.startsWith('class ')) {
                hasContent = true;
                const item = document.createElement('div');
                const type = trimmed.startsWith('function') ? 'function' :
                    trimmed.startsWith('class') ? 'class' : 'variable';

                item.className = `outline-item ${type} hover-lift`;
                const name = trimmed.split('(')[0].split('=')[0].replace(/function|const|let|var|class/g, '').trim();
                item.textContent = name || trimmed.substring(0, 30);
                item.title = `Line ${index + 1}: ${trimmed.substring(0, 50)}${trimmed.length > 50 ? '...' : ''}`;

                item.addEventListener('click', () => {
                    if (this.editor) {
                        this.editor.setPosition({ lineNumber: index + 1, column: 1 });
                        this.editor.focus();
                        this.editor.revealLineInCenter(index + 1);
                    }
                });

                outlineContent.appendChild(item);
            }
        });

        if (!hasContent) {
            outlineContent.innerHTML = '<div class="empty-outline">No symbols found</div>';
        }
    }

    updateTabStatus() {
        if (this.activeTab && this.tabs.has(this.activeTab)) {
            const tab = this.tabs.get(this.activeTab);
        }
    }

    getLanguageFromExtension(filename) {
        if (!filename) return 'plaintext';

        const ext = filename.split('.').pop().toLowerCase();
        const languageMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'html': 'html',
            'htm': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'py': 'python',
            'json': 'json',
            'md': 'markdown',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'cs': 'csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'sql': 'sql',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'vue': 'vue',
            'svelte': 'html'
        };
        return languageMap[ext] || 'plaintext';
    }

    getFileNameFromPath(path) {
        if (!path) return 'Untitled';
        const parts = path.split(/[\\/]/);
        return parts[parts.length - 1] || 'Workspace';
    }

    showFileContextMenu(e) {
        const contextMenu = document.getElementById('file-context-menu');
        if (!contextMenu) return;

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.add('glass');

        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.onclick = (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleContextMenuAction(action);
                contextMenu.style.display = 'none';
            };
        });
    }

    // showEditorContextMenu(e) {
    // }

    hideContextMenus() {
        const contextMenu = document.getElementById('file-context-menu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    }

    handleContextMenuAction(action) {
        const targetPath = this.getContextMenuTarget();
        if (!targetPath) return;

        switch (action) {
            case 'open':
                break;
            case 'rename':
                if (targetPath.startsWith('/')) {
                    this.showNotification('Cannot rename default files', 'warning');
                    return;
                }
                const currentName = targetPath.split(/[\\/]/).pop();
                this.showRenameDialog(targetPath, currentName);
                break;
            case 'delete':
                this.deleteFile(targetPath);
                break;
            case 'copy-path':
                navigator.clipboard.writeText(targetPath);
                this.showNotification('Path copied to clipboard', 'success');
                break;
            case 'reveal-in-explorer':
                this.showNotification('Reveal in explorer feature coming soon!', 'info');
                break;
        }
    }

    getContextMenuTarget() {
        const activeItem = document.querySelector('.file-item.active, .folder-item.active');
        return activeItem ? activeItem.dataset.path : null;
    }

    handleMenuAction(action) {
        switch (action) {
            case 'new-file':
                this.createNewFile();
                break;
            case 'new-folder':
                this.createNewFolder();
                break;
            case 'save-file':
                this.saveCurrentFile();
                break;
            case 'save-file-as':
                this.saveFileAs();
                break;
            case 'run-code':
                this.runCurrentFile();
                break;
            case 'find':
                if (this.editor) {
                    this.editor.getAction('actions.find').run();
                }
                break;
            case 'replace':
                if (this.editor) {
                    this.editor.getAction('editor.action.startFindReplaceAction').run();
                }
                break;
            case 'toggle-comment':
                if (this.editor) {
                    this.editor.getAction('editor.action.commentLine').run();
                }
                break;
            case 'format-document':
                if (this.editor) {
                    this.editor.getAction('editor.action.formatDocument').run();
                }
                break;
            case 'shortcuts':
                this.showKeyboardShortcuts();
                break;
            case 'about':
                this.showAboutDialog();
                break;
        }
    }

    handleWindowAction(action) {
        switch (action) {
            case 'toggle-sidebar':
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.toggle('collapsed');
                }
                break;
            case 'toggle-ai-panel':
                this.toggleAIPanel();
                break;
        }
    }

    handleTerminalAction(action) {
        switch (action) {
            case 'new-terminal':
                this.showTerminal();
                break;
            case 'run-current':
                this.runCurrentFile();
                break;
        }
    }

    handleKeyboardShortcuts(e) {
        if (!document.activeElement.closest('.monaco-editor')) {
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 's':
                    e.preventDefault();
                    this.saveCurrentFile();
                    break;
                case 'n':
                    e.preventDefault();
                    this.createNewFile();
                    break;
                case 'o':
                    e.preventDefault();
                    this.openFileDialog();
                    break;
                case 'f':
                    e.preventDefault();
                    if (this.editor) {
                        this.editor.getAction('actions.find').run();
                    }
                    break;
                case 'b':
                    e.preventDefault();
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar) {
                        sidebar.classList.toggle('collapsed');
                    }
                    break;
                case 'i':
                    e.preventDefault();
                    this.toggleAIPanel();
                    break;
                case '/':
                    e.preventDefault();
                    if (this.editor) {
                        this.editor.getAction('editor.action.commentLine').run();
                    }
                    break;
                case 'shift':
                    if (e.key === 'o' && e.ctrlKey) {
                        e.preventDefault();
                        this.openFolderDialog();
                        break;
                    }
            }
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type} fade-in glass`;
        notification.textContent = message;

        notification.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            padding: 14px 20px;
            background: ${type === 'success' ? '#27ca3f' :
                type === 'error' ? '#ff5f56' :
                    type === 'warning' ? '#ffbd2e' : '#007acc'};
            color: white;
            border-radius: 12px;
            z-index: 10000;
            box-shadow: var(--shadow-lg);
            font-size: 13px;
            max-width: 350px;
            word-wrap: break-word;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(20px)';
            notification.style.transition = 'all 0.3s ease';

            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    showKeyboardShortcuts() {
        const shortcuts = [
            { key: 'Ctrl+S', action: 'Save File' },
            { key: 'Ctrl+N', action: 'New File' },
            { key: 'Ctrl+O', action: 'Open File' },
            { key: 'Ctrl+Shift+O', action: 'Open Folder' },
            { key: 'Ctrl+B', action: 'Toggle Sidebar' },
            { key: 'Ctrl+Shift+I', action: 'Toggle AI Panel' },
            { key: 'F5', action: 'Run Code' },
            { key: 'Ctrl+F', action: 'Find' },
            { key: 'Ctrl+H', action: 'Replace' },
            { key: 'Ctrl+/', action: 'Toggle Comment' },
            { key: 'Shift+Alt+F', action: 'Format Document' }
        ];

        const message = shortcuts.map(s => `${s.key.padEnd(20)} ${s.action}`).join('\n');
        alert('Keyboard Shortcuts:\n\n' + message);
    }

    showAboutDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'dialog glass';
        dialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        dialog.innerHTML = `
            <div class="dialog-content" style="
                background: var(--glass-bg);
                backdrop-filter: blur(20px);
                border: 1px solid var(--glass-border);
                border-radius: 16px;
                padding: 30px;
                min-width: 400px;
                max-width: 500px;
                box-shadow: var(--shadow-lg);
            ">
                <h3 style="
                    margin: 0 0 20px 0;
                    color: var(--text-primary);
                    font-size: 24px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                ">
                    <i class="fas fa-code" style="color: var(--accent-blue);"></i>
                    AI Code Editor
                </h3>
                <div style="color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
                    <p><strong>Version:</strong> 1.0.0</p>
                    <p>A VS Code-like editor with AI assistance</p>
                    <p>Built with Electron, Monaco Editor, and Flask</p>
                </div>
                <div style="margin-bottom: 20px;">
                    <h4 style="color: var(--text-primary); margin-bottom: 10px;">Features:</h4>
                    <ul style="color: var(--text-secondary); padding-left: 20px; line-height: 1.6;">
                        <li>Code editing with syntax highlighting</li>
                        <li>File management with real-time watching</li>
                        <li>AI-powered code assistance</li>
                        <li>Terminal emulator</li>
                        <li>VS Code-like interface</li>
                        <li>Auto-save functionality</li>
                        <li>Modern glassmorphism design</li>
                    </ul>
                </div>
                <div style="text-align: center;">
                    <button class="btn-modern" onclick="this.closest('.dialog').remove()" style="padding: 10px 30px;">
                        Close
                    </button>
                </div>
            </div>
        `;

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                dialog.remove();
            }
        });

        document.body.appendChild(dialog);
    }

    splitEditor() {
        this.showNotification('Split editor feature coming soon!', 'info');
    }

    showMenu(menuName, target) {
        switch (menuName) {
            case 'file':
                this.showNotification('File menu - Use submenu items', 'info');
                break;
            case 'edit':
                this.showNotification('Edit menu - Use submenu items', 'info');
                break;
            case 'view':
                this.showNotification('View menu - Use submenu items', 'info');
                break;
            case 'ai':
                this.toggleAIPanel();
                break;
            case 'terminal':
                this.showTerminal();
                break;
            case 'help':
                this.showAboutDialog();
                break;
        }
    }

    openFileDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.js,.ts,.jsx,.tsx,.html,.css,.py,.json,.md,.txt,.xml,.yaml,.yml,.java,.c,.cpp,.h,.cs,.php,.rb,.go,.rs,.sql,.vue,.svelte';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    this.openFile(file.path, content, file.name);
                    this.showNotification(`Opened file: ${file.name}`, 'success');
                };
                reader.readAsText(file);
            }
        };

        input.click();
    }

    async openFolderDialog() {
        try {
            const result = await window.electronAPI.showOpenFolderDialog();
            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                const folderPath = result.filePaths[0];
                await this.openFolderFromPath(folderPath);
            }
        } catch (error) {
            console.error('Error opening folder:', error);
            this.showNotification(`Error opening folder: ${error.message}`, 'error');
        }
    }

    updateWorkspaceInfo(folderPath) {
        let workspaceInfo = document.getElementById('workspace-info');
        if (!workspaceInfo) {
            workspaceInfo = document.createElement('div');
            workspaceInfo.id = 'workspace-info';
            workspaceInfo.className = 'workspace-indicator glass';

            const workspaceElement = document.getElementById('workspace');
            if (workspaceElement) {
                workspaceElement.insertBefore(workspaceInfo, workspaceElement.firstChild);
            }
        }

        const folderName = this.getFileNameFromPath(folderPath);
        workspaceInfo.innerHTML = `
            <i class="fas fa-folder-open" style="color: var(--accent-blue);"></i>
            <span style="margin-left: 8px; font-weight: 500;">${folderName}</span>
            <span style="margin-left: 8px; font-size: 10px; opacity: 0.7;">(${folderPath})</span>
            <div style="margin-left: auto; display: flex; gap: 8px;">
                <i class="fas fa-sync-alt" style="cursor: pointer; font-size: 11px;" 
                   onclick="codeEditor.refreshFileTree()" title="Refresh"></i>
                <i class="fas fa-times" style="cursor: pointer; font-size: 11px;" 
                   onclick="codeEditor.closeWorkspace()" title="Close Workspace"></i>
            </div>
        `;
    }

    updateFileInfo(filePath) {
        if (filePath && !filePath.startsWith('/')) {
            try {
                const fs = require('fs');
                const stats = fs.statSync(filePath);
                const size = this.formatFileSize(stats.size);
                const modified = new Date(stats.mtime).toLocaleString();

                const fileInfoElement = document.createElement('div');
                fileInfoElement.className = 'status-item';
                fileInfoElement.innerHTML = `<i class="fas fa-info-circle"></i><span>${size} • ${modified}</span>`;

                const statusRight = document.querySelector('.status-right');
                if (statusRight) {
                    const existingInfo = statusRight.querySelector('.file-info-status');
                    if (existingInfo) {
                        existingInfo.replaceWith(fileInfoElement);
                    } else {
                        fileInfoElement.classList.add('file-info-status');
                        statusRight.prepend(fileInfoElement);
                    }
                }
            } catch (error) {
                console.error('Error getting file info:', error);
            }
        }
    }

    closeWorkspace() {
        this.workspacePath = null;
        this.fileTree = { children: [] };

        this.fileWatchers.forEach(watcher => watcher.close());
        this.fileWatchers.clear();

        this.renderFileTree();

        const workspaceInfo = document.getElementById('workspace-info');
        if (workspaceInfo) {
            workspaceInfo.remove();
        }

        const fileInfoStatus = document.querySelector('.file-info-status');
        if (fileInfoStatus) {
            fileInfoStatus.remove();
        }

        this.showNotification('Workspace closed', 'info');
    }

    // Cleanup method
    cleanup() {
        this.fileSystemWatchers.forEach(watcher => watcher.close());
        this.fileSystemWatchers.clear();

        this.fileWatchers.forEach(watcher => watcher.close());
        this.fileWatchers.clear();

        if (this.editor) {
            this.editor.dispose();
        }
    }
    addToExplorer(filePath, fileName) {
        console.log(`Adding to explorer: ${fileName} (${filePath})`);
        if (!this.fileTree) {
            this.fileTree = {
                name: 'Files',
                path: '/',
                type: 'folder',
                open: true,
                children: []
            };
        }

        if (this.isFileInTree(this.fileTree, filePath)) {
            console.log(`File already in tree: ${filePath}`);
            return;
        }

        console.log(`Adding new file to tree root: ${filePath}`);
        const newFile = {
            name: fileName,
            path: filePath,
            type: 'file'
        };

        if (!this.fileTree.children) {
            this.fileTree.children = [];
        }

        this.fileTree.children.push(newFile);
        this.renderFileTree();
    }

    isFileInTree(node, filePath) {
        // Normalize paths for comparison (handle Windows/Unix separators)
        const normalize = (p) => p ? p.replace(/\\/g, '/').toLowerCase() : '';
        const nodePath = normalize(node.path);
        const targetPath = normalize(filePath);

        if (nodePath === targetPath) return true;

        if (node.children) {
            return node.children.some(child => this.isFileInTree(child, filePath));
        }
        return false;
    }
}

window.addEventListener('beforeunload', () => {
    if (window.codeEditor) {
        window.codeEditor.cleanup();
    }
});

// Initialize CodeEditor
window.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing CodeEditor...');
        window.codeEditor = new CodeEditor();
        console.log('CodeEditor initialized and assigned to window.codeEditor');
    } catch (error) {
        console.error('Failed to initialize CodeEditor:', error);
    }
});