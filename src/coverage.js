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
        this.coverageCache = new Map();

        this.initDecorations();

        this.coverageCommandId = this.initCommand();
        this.statusBar = this.initStatusBar();

        this.fileChangedEmitter = this.initFileChangedEmitter();
        this.coverageFilePattern = '**/coverage-report.json';

        this.initCoverageWatcher();
        this.initCoverageReports();

        this.initTooltip();

        window.tabGroups.onDidChangeTabs((changedEvent) => {
            // console.log('Tab group changed');
            this.update('onDidChangeTabs');
        });

        // workspace.onDidCloseTextDocument((doc) => {
        //     this.update('onDidCloseTextDocument');
        // });
        // workspace.onDidOpenTextDocument((doc) => {
        //     this.update('onDidOpenTextDocument');
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

    initDecorations() {
        const alpha = '99';
        const gutterCovered = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('covered'),
            overviewRulerColor: defaultColors.covered + alpha,
            overviewRulerLane: OverviewRulerLane.Left
        });
        const gutterUncovered = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('uncovered'),
            overviewRulerColor: defaultColors.uncovered + alpha,
            overviewRulerLane: OverviewRulerLane.Left
        });
        const gutterPartial = window.createTextEditorDecorationType({
            gutterIconPath: this.getGutter('partial'),
            overviewRulerColor: defaultColors.partial + alpha,
            overviewRulerLane: OverviewRulerLane.Left
        });


        const bgUncovered = window.createTextEditorDecorationType({
            backgroundColor: '#ff000033'
        });

        const elseDecoration = window.createTextEditorDecorationType({
            before: {
                contentText: 'E',
                color: '#ffffff',
                backgroundColor: '#ff0000',
                textDecoration: 'none; font-family: Helvetica,Arial,sans-serif; font-size: 11px; padding: 2px 3px; cursor: default; border: 1px solid #c00; border-radius: 3px; text-align: center'
            }
        });

        this.decorations = {
            gutterCovered,
            gutterUncovered,
            gutterPartial,
            bgUncovered,
            elseDecoration
        };

    }

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

        if (json.type !== 'v8' || !json.files) {
            return;
        }

        console.log(`Found coverage report: ${EC.green(uri.fsPath)}`);

        json.files.forEach((file) => {
            // console.log(file.sourcePath);
            this.coverageCache.set(file.sourcePath, file);
        });

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
            console.log('Update by', by);

            try {
                this.updateSync();
            } catch (e) {
                console.log(e);
            }

        }, 100);
    }

    updateSync() {

        this.hoverMap = new Map();

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

        this.hideStatusBar();

    }

    getFileCoverage(activeEditor) {
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

    showFileCoverage(activeEditor, fileCoverage) {

        this.showGutterCoverage(activeEditor, fileCoverage);
        this.showBytesCoverage(activeEditor, fileCoverage);
        this.showElseNoneCoverage(activeEditor, fileCoverage);

    }

    getPrevLocId(p) {
        const column = p.character > 0 ? p.character - 1 : 0;
        const locId = `${p.line}_${column}`;
        // console.log(locId);

        return locId;
    }

    showElseNoneCoverage(activeEditor, fileCoverage) {
        const elseNoneBranches = [];
        if (this.showDetails) {
            const { branches } = fileCoverage.data;
            const uncoveredNoneBranches = branches.filter((it) => it.none && it.count === 0 && !it.ignored);
            uncoveredNoneBranches.forEach((it) => {
                const p = activeEditor.document.positionAt(it.start);
                const locId = this.getPrevLocId(p);
                this.hoverMap.set(locId, {
                    tooltip: 'else path uncovered'
                });

                elseNoneBranches.push({
                    range: new Range(p, p)
                });
            });
        }
        activeEditor.setDecorations(this.decorations.elseDecoration, elseNoneBranches);
    }

    showBytesCoverage(activeEditor, fileCoverage) {

        if (this.hitsDecorations) {
            this.hitsDecorations.forEach((hd) => {
                hd.dispose();
            });
            this.hitsDecorations = null;
        }

        const uncoveredRanges = [];
        if (this.showDetails) {
            const { lineMap, hitsRanges } = this.getLinesCoverageInfo(activeEditor, fileCoverage);
            this.updateUncoveredRages(lineMap, uncoveredRanges, activeEditor);
            this.showHitsCoverage(activeEditor, hitsRanges);
        }
        activeEditor.setDecorations(this.decorations.bgUncovered, uncoveredRanges);
    }

    updateUncoveredRages(lineMap, uncoveredRanges, activeEditor) {
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
    }

    showHitsCoverage(activeEditor, hitsRanges) {

        const hitsDecorations = [];

        hitsRanges.forEach((range) => {

            const { start, count } = range;

            const hits = Util.CF(count);
            const hitsDecoration = window.createTextEditorDecorationType({
                before: {
                    contentText: `x${hits}`,
                    color: '#333',
                    backgroundColor: '#e6f5d0',
                    textDecoration: 'none; font-family: Helvetica,Arial,sans-serif; font-size: 11px; padding: 0 2px; cursor: default; border: 1px solid #4eb62f; border-radius: 3px; text-align: center'
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
            hitsDecorations.push(hitsDecoration);
        });

        this.hitsDecorations = hitsDecorations;

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
    }

    hideStatusBar() {
        this.statusBar.hide();
        // console.log('Hide status bar');
    }

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

    destroy() {
        clearTimeout(this.timeout_update);
        this.coverageCache.clear();
        this.coverageCache = null;
        this.context = null;
    }
}

module.exports = MCRCoverage;
