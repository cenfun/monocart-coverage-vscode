const fs = require('fs');
const path = require('path');
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const {
    window,
    commands,
    StatusBarAlignment,
    ThemeColor,
    MarkdownString,
    Range,
    Uri,
    workspace,
    EventEmitter
} = require('vscode');

class MCRCoverage {
    constructor(context) {

        this.context = context;

        this.showDetails = true;
        this.coverageCache = new Map();

        this.coverageCommandId = this.initCommand();
        this.statusBar = this.initStatusBar();

        this.fileChangedEmitter = this.initFileChangedEmitter();
        this.coverageFilePattern = '**/coverage-report.json';

        this.initCoverageWatcher();
        this.initCoverageReports();


        window.tabGroups.onDidChangeTabs((changedEvent) => {
            // console.log('Tab group changed');
            this.update();
        });

        workspace.onDidCloseTextDocument((doc) => {
            this.update();
        });
        workspace.onDidOpenTextDocument((doc) => {
            this.update();
        });

    }

    initStatusBar() {
        const statusBar = window.createStatusBarItem(StatusBarAlignment.Left);
        statusBar.command = this.coverageCommandId;
        this.context.subscriptions.push(statusBar);
        return statusBar;
    }

    initCommand() {
        const coverageCommandId = 'monocart-coverage-vscode.coverage';
        const coverageCommand = commands.registerCommand(coverageCommandId, () => {
            this.showDetails = !this.showDetails;
            this.update();
        });
        this.context.subscriptions.push(coverageCommand);
        return coverageCommandId;
    }

    initFileChangedEmitter() {
        const fileChangedEmitter = new EventEmitter();
        fileChangedEmitter.event((uri) => {
            this.loadCoverage(uri);
        });
        return fileChangedEmitter;
    }

    initCoverageWatcher() {
        const watcher = workspace.createFileSystemWatcher(this.coverageFilePattern);
        watcher.onDidCreate((uri) => {
            this.fileChangedEmitter.fire(uri);
        });
        watcher.onDidChange((uri) => {
            this.fileChangedEmitter.fire(uri);
        });
        watcher.onDidDelete((uri) => {
            this.fileChangedEmitter.fire(uri);
        });
        this.context.subscriptions.push(watcher);
    }

    async initCoverageReports() {
        const files = await workspace.findFiles(this.coverageFilePattern);
        for (const file of files) {
            this.fileChangedEmitter.fire(file);
        }
    }
    // ============================================================================================

    loadCoverage(uri) {
        const json = this.readJSONSync(uri.fsPath);
        if (!json) {
            return;
        }

        if (json.type !== 'v8' || !json.files) {
            return;
        }

        json.files.forEach((file) => {
            // console.log(file.sourcePath);
            this.coverageCache.set(file.sourcePath, file);
        });

        this.update();
    }

    readJSONSync(filePath) {
        // do NOT use require, it has cache
        const content = this.readFileSync(filePath);
        if (content) {
            return JSON.parse(content);
        }
    }

    readFileSync(filePath) {
        if (fs.existsSync(filePath)) {
            // Returns: <string> | <Buffer>
            const buf = fs.readFileSync(filePath);
            if (Buffer.isBuffer(buf)) {
                return buf.toString('utf8');
            }
            return buf;
        }
    }

    // ============================================================================================
    update() {
        clearTimeout(this.timeout_update);
        this.timeout_update = setTimeout(() => {
            this.updateSync();
        }, 100);
    }

    updateSync() {

        // get current file coverage
        const activeEditor = window.activeTextEditor;
        if (activeEditor) {
            const coverage = this.getFileCoverage(activeEditor);
            if (coverage) {
                this.showFileCoverage(activeEditor, coverage);
                this.showStatusBar(coverage);
                return;
            }
        }

        this.hideStatusBar();
    }

    getFileCoverage(activeEditor) {
        const fileName = activeEditor.document.fileName;
        const filePath = this.getRelativePath(fileName);

        const coverage = this.coverageCache.get(filePath);
        if (coverage) {
            console.log(`Found file coverage: ${filePath}`);
            return coverage;
        }

        console.log(`Not found file coverage: ${filePath}`);

    }

    getRelativePath(fileName) {
        let workspacePath = '';
        if (workspace.workspaceFolders?.length) {
            workspacePath = workspace.workspaceFolders[0].uri.fsPath;
            workspacePath = path.normalize(workspacePath);
        }
        const relPath = path.relative(workspacePath, fileName);
        return relPath.replace(/\\/g, '/');
    }

    showFileCoverage(activeEditor, coverage) {

        const uncoveredDecoration = window.createTextEditorDecorationType({
            // backgroundColor: '#f88d8d4d'
            backgroundColor: '#cc000033'
        });
        const uncoveredRanges = [];
        uncoveredRanges.push({
            range: new Range(
                activeEditor.document.positionAt(50),
                activeEditor.document.positionAt(100)
            )
        });
        activeEditor.setDecorations(uncoveredDecoration, uncoveredRanges);

        const uncoveredGutter = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('uncovered')
            // overviewRulerColor: '#ff0000'
        });
        const uncoveredLines = [];
        uncoveredLines.push({
            range: new Range(
                activeEditor.document.positionAt(150),
                activeEditor.document.positionAt(150)
            )
        });
        activeEditor.setDecorations(uncoveredGutter, uncoveredLines);
    }


    showStatusBar(coverage) {

        const { summary } = coverage;

        const { bytes } = summary;

        // 🟢 🟡 🔴 🟠 ⚫ ⚪ 🟣 🔵
        const colors = {
            low: '🔴',
            medium: '🟡',
            high: '🟢'
        };

        let text = 'No Coverage';
        if (bytes.pct !== '') {
            const icon = colors[bytes.status] || '';
            text = `${icon} Coverage ${bytes.pct}%`;
        }
        this.statusBar.text = text;

        //         this.statusBar.tooltip = new MarkdownString(`## My MCR Coverage Report
        // | Name | Coverage % | Covered | Uncovered | Total |
        // | :--- | ---------: | ------: | --------: | ----: |
        // | Bytes | 🟢 87.45 % | 292,967 |    42,056 | 335,023 |
        // | Statements | 🟢 85.24 % |   4,367 |       756 | 5,123 |
        // | Branches | 🟡 68.68 % |   1,351 |       616 | 1,967 |
        // | Functions | 🟢 87.75 % |     702 |        98 |   800 |
        // | Lines | 🟢 82.82 % |   7,465 |     1,549 | 9,014 |`);


        this.statusBar.show();

    }

    hideStatusBar() {
        this.statusBar.hide();
    }


    getGutter(type) {

        const types = {
            covered: '#008000',
            uncovered: '#ff0000',
            partial: '#ffa500'
        };

        const color = types[type];
        if (!color) {
            return '';
        }

        const svg = `<svg width="32" height="48" viewPort="0 0 32 48" xmlns="http://www.w3.org/2000/svg">
        <polygon points="16,0 32,0 32,48 16,48" fill="${color}"/>
        </svg>`;
        const icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        return Uri.parse(icon);
    }


    destroy() {
        clearTimeout(this.timeout_update);
        this.coverageCache.clear();
        this.coverageCache = null;
        this.context = null;
    }
}

module.exports = MCRCoverage;
