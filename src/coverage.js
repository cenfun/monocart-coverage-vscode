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
    EventEmitter,
    OverviewRulerLane,
    languages,
    Hover
} = require('vscode');

const { Locator } = require('monocart-locator');
const EC = require('eight-colors');

const Util = require('./util.js');

const defaultColors = {
    covered: '#008000',
    uncovered: '#ff0000',
    partial: '#ffa500'
};

class MCRCoverage {
    constructor(context) {

        this.context = context;

        this.noCoverage = 'No Coverage';

        this.showDetails = true;
        this.hasCoverageReport = false;
        this.coverageCache = new Map();

        this.coverageCommandId = this.initCommand();
        this.statusBar = this.initStatusBar();

        this.fileChangedEmitter = this.initFileChangedEmitter();
        this.coverageFilePattern = '**/coverage-report.json';

        this.initCoverageWatcher();
        this.initCoverageReports();

        this.initTooltip();

        window.tabGroups.onDidChangeTabs((changedEvent) => {
            this.update('onDidChangeTabs');
        });

        workspace.onDidOpenTextDocument((doc) => {

            // ignore git event
            if (doc.uri.scheme === 'git') {
                return;
            }

            this.update('onDidOpenTextDocument');
        });

        // workspace.onDidCloseTextDocument((doc) => {
        // });

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
            this.update('coverageCommandId');
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
        const files = await workspace.findFiles(this.coverageFilePattern, '**/node_modules/**');
        for (const file of files) {
            this.fileChangedEmitter.fire(file);
        }
    }

    // ============================================================================================

    initTooltip() {

        const provideHover = (document, position, token) => {

            this.hideHoverRange();

            const locId = `${position.line}_${position.character}`;
            const hoverItem = this.hoverMap.get(locId);

            // console.log(locId, hoverItem);

            if (hoverItem) {

                if (hoverItem.range) {
                    this.showHoverRange(hoverItem.range);
                }

                if (hoverItem.tooltip) {
                    return new Hover(hoverItem.tooltip);
                }
            }

        };

        const tooltip = languages.registerHoverProvider({
            scheme: 'file'
        }, {
            provideHover
        });
        this.context.subscriptions.push(tooltip);
    }

    hideHoverRange() {
        if (this.bgHover) {
            this.bgHover.dispose();
            this.bgHover = null;
        }
    }

    showHoverRange(range) {
        this.hideHoverRange();

        const activeEditor = window.activeTextEditor;
        if (activeEditor) {

            this.bgHover = window.createTextEditorDecorationType({
                backgroundColor: `${defaultColors.covered}33`
            });

            activeEditor.setDecorations(this.bgHover, [{
                range: new Range(
                    activeEditor.document.positionAt(range.start),
                    activeEditor.document.positionAt(range.end)
                )
            }]);

        }
    }

    // ============================================================================================

    loadCoverage(uri) {
        const json = this.readJSONSync(uri.fsPath);
        if (!json) {
            return;
        }

        if (json.type !== 'v8' || !json.files || !json.files.length) {
            return;
        }

        console.log(`Found coverage report: ${EC.green(uri.fsPath)}`);

        json.files.forEach((file) => {
            // console.log(file.sourcePath);
            this.coverageCache.set(file.sourcePath, file);
        });

        this.hasCoverageReport = true;

        this.update('loadCoverage');
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
    update(by) {
        clearTimeout(this.timeout_update);
        this.timeout_update = setTimeout(() => {
            this.updateSync(by);
        }, 100);
    }

    updateSync(by) {

        console.log('Update by', by);

        if (!this.hasCoverageReport) {
            return;
        }

        if (this.hoverMap) {
            this.hoverMap.clear();
        }
        this.hoverMap = new Map();

        this.fileCoverage = this.getFileCoverage();
        this.showStatusBar();

    }

    // ============================================================================================

    getFileCoverage() {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor) {
            console.log('Not found activeEditor');
            return;
        }

        const fileName = activeEditor.document.fileName;
        const filePath = this.getRelativePath(fileName);

        const coverage = this.coverageCache.get(filePath);
        if (coverage) {
            console.log(`Found file coverage: ${EC.green(filePath)}`);
            return coverage;
        }

        console.log(`Not found file coverage: ${EC.red(filePath)}`);

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

    // ============================================================================================

    showStatusBar() {

        if (!this.fileCoverage) {
            this.hideStatusBar();
            return;
        }

        const { summary } = this.fileCoverage;
        const { bytes } = summary;

        const colors = {
            low: '🔴',
            medium: '🟡',
            high: '🟢'
        };

        let text = this.noCoverage;
        if (bytes.pct !== '') {
            const status = this.showDetails ? '$(debug-coverage) ' : '';
            const icon = colors[bytes.status] || '';
            text = `${status}${icon} Coverage ${bytes.pct}%`;
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

        const table = Util.markdownGrid({
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
        // console.log('Show status bar');

        clearTimeout(this.timeout_file_decorations);
        this.timeout_file_decorations = setTimeout(() => {
            this.showFileCoverage();
        }, 100);

    }

    hideStatusBar() {
        this.statusBar.hide();
        // console.log('Hide status bar');
    }

    // ============================================================================================

    showFileCoverage() {

        this.cleanFileDecorations();

        if (!this.fileCoverage) {
            return;
        }

        if (!this.showDetails) {
            return;
        }


        this.showGutterCoverage();
        this.showElseNoneCoverage();
        this.showBytesCoverage();

    }

    cleanFileDecorations() {
        if (this.fileDecorations) {
            this.fileDecorations.forEach((hd) => {
                hd.dispose();
            });
        }
        this.fileDecorations = [];
    }

    // ============================================================================================

    showGutterCoverage() {

        const activeEditor = window.activeTextEditor;
        const document = activeEditor.document;
        const { lines } = this.fileCoverage.data;

        const coveredLines = [];
        const uncoveredLines = [];
        const partialLines = [];

        Object.keys(lines).forEach((line) => {
            const hits = lines[line];
            const textLine = document.lineAt(line - 1);
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


        if (coveredLines.length) {
            const gutterCovered = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('covered'),
                overviewRulerColor: `${defaultColors.covered}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(gutterCovered, coveredLines);
            this.fileDecorations.push(gutterCovered);
        }

        if (uncoveredLines.length) {
            const gutterUncovered = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('uncovered'),
                overviewRulerColor: `${defaultColors.uncovered}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(gutterUncovered, uncoveredLines);
            this.fileDecorations.push(gutterUncovered);
        }

        if (partialLines.length) {
            const gutterPartial = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('partial'),
                overviewRulerColor: `${defaultColors.partial}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(gutterPartial, partialLines);
            this.fileDecorations.push(gutterPartial);
        }

    }

    showElseNoneCoverage() {

        const activeEditor = window.activeTextEditor;
        const document = activeEditor.document;

        const elseNoneBranches = [];
        const { branches } = this.fileCoverage.data;
        const uncoveredNoneBranches = branches.filter((it) => it.none && it.count === 0 && !it.ignored);
        uncoveredNoneBranches.forEach((it) => {
            const p = document.positionAt(it.start);
            const locId = this.getPrevLocId(p);
            this.hoverMap.set(locId, {
                tooltip: 'else path uncovered'
            });

            elseNoneBranches.push({
                range: new Range(p, p)
            });
        });

        if (elseNoneBranches.length) {
            const elseDecoration = window.createTextEditorDecorationType({
                overviewRulerColor: `${defaultColors.uncovered}99`,
                before: {
                    contentText: 'E',
                    color: '#ffffff',
                    backgroundColor: defaultColors.uncovered,
                    textDecoration: 'none; padding: 0 3px; cursor: default; border-radius: 3px; text-align: center'
                }
            });
            activeEditor.setDecorations(elseDecoration, elseNoneBranches);
            this.fileDecorations.push(elseDecoration);
        }
    }

    showBytesCoverage() {

        const activeEditor = window.activeTextEditor;
        const { lineMap, hitsRanges } = this.getLinesCoverageInfo(activeEditor, this.fileCoverage);

        this.showUncoveredRanges(activeEditor, lineMap);
        this.showHitsCoverage(activeEditor, hitsRanges);

    }

    showUncoveredRanges(activeEditor, lineMap) {

        const uncoveredRanges = [];

        lineMap.forEach((lineItem, line) => {
            const { uncoveredEntire, uncoveredPieces } = lineItem;

            if (uncoveredEntire) {

                uncoveredRanges.push({
                    range: new Range(
                        activeEditor.document.positionAt(lineItem.start + lineItem.indent),
                        activeEditor.document.positionAt(lineItem.end)
                    )
                });


            } else {

                if (uncoveredPieces.length) {
                    uncoveredPieces.forEach((p) => {
                        const { pieces } = p;
                        if (pieces) {
                            uncoveredRanges.push({
                                range: new Range(
                                    activeEditor.document.positionAt(lineItem.start + pieces.start),
                                    activeEditor.document.positionAt(lineItem.start + pieces.end)
                                )
                            });
                        }
                    });
                }
            }

        });

        if (uncoveredRanges.length) {
            const bgUncovered = window.createTextEditorDecorationType({
                backgroundColor: '#ff000033'
            });
            activeEditor.setDecorations(bgUncovered, uncoveredRanges);
            this.fileDecorations.push(bgUncovered);
        }

    }

    showHitsCoverage(activeEditor, hitsRanges) {

        hitsRanges.forEach((range) => {

            const { start, count } = range;

            const hits = Util.CF(count);
            const hitsDecoration = window.createTextEditorDecorationType({
                before: {
                    contentText: `x${hits}`,
                    color: '#ffffff',
                    backgroundColor: defaultColors.covered,
                    textDecoration: 'none; padding: 0 3px; cursor: default; border-radius: 3px; text-align: center'
                }
            });

            const p = activeEditor.document.positionAt(start);
            const locId = this.getPrevLocId(p);
            this.hoverMap.set(locId, {
                tooltip: `${Number(count).toLocaleString()} hits`,
                range
            });

            activeEditor.setDecorations(hitsDecoration, [{
                range: new Range(p, p)
            }]);

            this.fileDecorations.push(hitsDecoration);
        });

    }

    getLinesCoverageInfo(activeEditor, fileCoverage) {

        // const isJS = fileCoverage.js;
        const { bytes, extras } = fileCoverage.data;

        const lineMap = new Map();
        const hitsRanges = [];

        const source = activeEditor.document.getText();
        const locator = new Locator(source);
        locator.lines.forEach((lineItem) => {
            // line 1-base
            const line = lineItem.line + 1;
            // exclude blank,comment,ignored
            if (extras[line]) {
                return;
            }

            Util.initLineCoverage(lineItem);

            lineMap.set(line, lineItem);
        });

        bytes.forEach((range) => {
            const {
                start, end, count, ignored
            } = range;

            if (ignored) {
                return;
            }

            // uncovered line
            if (count === 0) {
                const sLoc = locator.offsetToLocation(start);
                const eLoc = locator.offsetToLocation(end);

                // update lines coverage
                const rangeLines = Util.getRangeLines(sLoc, eLoc);
                Util.updateLinesCoverage(rangeLines, count, lineMap);
                return;
            }

            // hits for count > 1
            if (count > 1) {
                hitsRanges.push(range);
            }

            // defaults to count 1, do nothing for count === 1

        });

        return {
            lineMap,
            hitsRanges
        };
    }

    // ============================================================================================

    getGutter(type) {

        const color = defaultColors[type];
        if (!color) {
            return '';
        }

        const svg = `<svg width="19" height="19" viewPort="0 0 19 19" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="0" width="8" height="19" fill="${color}" />
        </svg>`;
        const icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        return Uri.parse(icon);
    }

    getPrevLocId(p) {
        const column = p.character > 0 ? p.character - 1 : 0;
        const locId = `${p.line}_${column}`;
        // console.log(locId);

        return locId;
    }
    // ============================================================================================

    destroy() {
        clearTimeout(this.timeout_file_decorations);
        clearTimeout(this.timeout_update);
        this.coverageCache.clear();
        this.coverageCache = null;
        this.context = null;
    }
}

module.exports = MCRCoverage;
