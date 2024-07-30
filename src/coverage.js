const fs = require('fs');
const path = require('path');

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const {
    window,
    commands,
    StatusBarAlignment,
    MarkdownString,
    Range,
    Uri,
    workspace,
    EventEmitter
} = require('vscode');

const { Locator } = require('monocart-locator');
const Util = require('monocart-coverage-reports/util');
const generateMarkdownGrid = require('./markdown.js');

class MCRCoverage {
    constructor(context) {

        this.context = context;

        this.noCoverage = 'No Coverage';

        this.showDetails = true;
        this.coverageCache = new Map();

        this.initDecorations();

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
        const statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 100);
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

    initDecorations() {
        const bgUncovered = window.createTextEditorDecorationType({
            // backgroundColor: '#f88d8d4d'
            backgroundColor: '#cc000033'
        });

        const gutterCovered = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('covered')
        });
        const gutterUncovered = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('uncovered')
        });
        const gutterPartial = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('partial')
        });

        this.decorations = {
            bgUncovered,
            gutterCovered,
            gutterUncovered,
            gutterPartial
        };

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
            const fileCoverage = this.getFileCoverage(activeEditor);
            if (fileCoverage) {
                this.showFileCoverage(activeEditor, fileCoverage);
                this.showStatusBar(fileCoverage);
                return;
            }
        }

        console.log('hide status bar');
        this.statusBar.hide();

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

    showFileCoverage(activeEditor, fileCoverage) {

        this.showBytesCoverage(activeEditor, fileCoverage);
        this.showGutterCoverage(activeEditor, fileCoverage);

    }

    showBytesCoverage(activeEditor, fileCoverage) {
        const uncoveredRanges = [];
        if (this.showDetails) {

            const {
                bytes, lines, extras
            } = fileCoverage.data;

            const source = activeEditor.document.getText();
            // console.log(source);
            const locator = new Locator(source);
            const lineMap = new Map();
            locator.lines.forEach((lineItem) => {
                // line 1-base
                const line = lineItem.line + 1;

                // exclude blank and comment
                if (extras[line]) {
                    return;
                }

                const hits = lines[line];
                if (typeof hits === 'string' || hits === 0) {
                    lineItem.uncoveredEntire = null;
                    lineItem.uncoveredPieces = [];
                    lineMap.set(line, lineItem);
                }

            });

            bytes.forEach((range) => {
                const {
                    start, end, count, ignored
                } = range;

                if (ignored) {
                    return;
                }
                if (count > 0) {
                    return;
                }

                const sLoc = locator.offsetToLocation(start);
                const eLoc = locator.offsetToLocation(end);

                // update lines coverage
                const rangeLines = Util.getRangeLines(sLoc, eLoc);
                Util.updateLinesCoverage(rangeLines, count, lineMap);

                // console.log(lines);

                // uncoveredRanges.push({
                //     range: new Range(
                //         activeEditor.document.positionAt(range.start),
                //         activeEditor.document.positionAt(range.end)
                //     )
                // });
            });

            console.log(lineMap);

        }
        activeEditor.setDecorations(this.decorations.bgUncovered, uncoveredRanges);
    }

    showGutterCoverage(activeEditor, fileCoverage) {
        const coveredLines = [];
        const uncoveredLines = [];
        const partialLines = [];

        if (this.showDetails) {

            const { lines } = fileCoverage.data;

            Object.keys(lines).forEach((line) => {
                const hits = lines[line];
                const textLine = activeEditor.document.lineAt(line - 1);
                // console.log(line, hits, textLine);
                if (typeof hits === 'number') {
                    if (hits > 0) {
                        coveredLines.push({
                            range: textLine.range
                        });
                    } else {
                        uncoveredLines.push({
                            range: textLine.range
                        });
                    }
                } else {
                    partialLines.push({
                        range: textLine.range
                    });
                }
            });
        }

        activeEditor.setDecorations(this.decorations.gutterCovered, coveredLines);
        activeEditor.setDecorations(this.decorations.gutterUncovered, uncoveredLines);
        activeEditor.setDecorations(this.decorations.gutterPartial, partialLines);
    }

    showStatusBar(fileCoverage) {

        const { summary } = fileCoverage;

        const { bytes } = summary;

        // 🟢 🟡 🔴 🟠 ⚫ ⚪ 🟣 🔵
        const colors = {
            low: '🔴',
            medium: '🟡',
            high: '🟢'
        };

        let text = this.noCoverage;
        if (bytes.pct !== '') {
            const icon = colors[bytes.status] || '';
            text = `${icon} Coverage ${bytes.pct}%`;
        }
        this.statusBar.text = text;

        const metrics = ['bytes', 'statements', 'branches', 'functions', 'lines'];
        const nFormatter = (v) => {
            if (typeof v === 'number') {
                return Util.NF(v);
            }
            return v;
        };
        const pFormatter = (v, row) => {
            if (typeof v === 'number') {
                // console.log(row);
                const icon = colors[row.status] || '';
                return `${icon} ${Util.PSF(v, 100, 2)}`;
            }
            return v;
        };

        // console.log(summary);

        const table = generateMarkdownGrid({
            columns: [{
                id: 'name',
                name: 'Name'
            }, {
                id: 'pct',
                name: 'Coverage %',
                align: 'right',
                formatter: pFormatter
            }, {
                id: 'covered',
                name: 'Covered',
                align: 'right',
                formatter: nFormatter
            }, {
                id: 'uncovered',
                name: 'Uncovered',
                align: 'right',
                formatter: nFormatter
            }, {
                id: 'total',
                name: 'Total',
                align: 'right',
                formatter: nFormatter
            }],
            rows: metrics.map((k) => {
                return {
                    ... summary[k],
                    name: Util.capitalizeFirstLetter(k)
                };
            })
        });

        // console.log(table);

        this.statusBar.tooltip = new MarkdownString(table);
        this.statusBar.show();
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
