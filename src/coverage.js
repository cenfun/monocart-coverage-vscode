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

        this.initLog();

        this.coverageCommandId = 'mcv.coverage';
        this.initCommand();

        this.statusBar = this.initStatusBar();

        this.fileChangedEmitter = this.initFileChangedEmitter();
        this.coverageFilePattern = '**/coverage-report.json';

        this.initCoverageWatcher();
        this.initCoverageReports();

        this.tooltipMap = new Map();
        this.initTooltip();

        // visible decorations, cache by line index
        this.decorationMap = new Map();

        window.tabGroups.onDidChangeTabs((changedEvent) => {
            this.update('onDidChangeTabs');
        });

        window.onDidChangeTextEditorVisibleRanges((e) => {
            this.update('onDidChangeTextEditorVisibleRanges');
        });

        workspace.onDidOpenTextDocument((doc) => {
            // ignore git event
            if (doc.uri.scheme === 'file') {
                this.update('onDidOpenTextDocument');
            }
        });

        workspace.onDidCloseTextDocument((doc) => {
            this.fileCoverage = null;
        });

    }

    initLog() {
        this.logChannel = window.createOutputChannel('Monocart Coverage');
        this.context.subscriptions.push(this.logChannel);
        this.logChannel.clear();
    }

    output(str) {
        this.logChannel.appendLine(EC.remove(str));
    }

    initStatusBar() {
        const statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 100);
        statusBar.command = this.coverageCommandId;
        this.context.subscriptions.push(statusBar);
        return statusBar;
    }

    initCommand() {
        const coverageCommand = commands.registerCommand(this.coverageCommandId, () => {
            this.showDetails = !this.showDetails;
            // force to update
            this.fileCoverage = null;
            this.update('showDetails');
        });
        this.context.subscriptions.push(coverageCommand);
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
            const hoverItem = this.tooltipMap.get(locId);

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

        const log = `Found coverage report: ${EC.green(uri.fsPath)}`;
        console.log(log);
        this.output(log);


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
        console.log(`Update by ${EC.magenta(by)}`);
        clearTimeout(this.timeout_update);
        this.timeout_update = setTimeout(() => {
            this.updateSync();
        }, 100);
    }

    updateSync() {

        if (!this.hasCoverageReport) {
            return;
        }

        const activeEditor = window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        // current file path
        this.filePath = this.getRelativePath(activeEditor.document.fileName);

        const fileCoverage = this.coverageCache.get(this.filePath);
        if (fileCoverage !== this.fileCoverage) {
            this.fileCoverage = fileCoverage;

            const color = fileCoverage ? EC.green : EC.red;
            const log = `${fileCoverage ? '' : 'Not '}Found file coverage: ${color(this.filePath)}`;
            console.log(log);
            this.output(log);

            // update context value
            commands.executeCommand('setContext', 'mcv.hasCoverage', Boolean(fileCoverage));

            this.tooltipMap.clear();
            this.tooltipMap = new Map();

            this.updateStatusBar();
            this.updateGutter();
            this.updateE();

            this.updateVisibleData();
        }

        this.renderVisibleCoverage();

    }


    // ============================================================================================

    updateStatusBar() {

        if (!this.fileCoverage) {
            this.statusBar.hide();
            // console.log('Hide status bar');
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

    }

    // ============================================================================================

    updateGutter() {

        this.cleanGutter();

        if (!this.showDetails || !this.fileCoverage) {
            return;
        }

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
            this.gutterCoveredDecoration = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('covered'),
                overviewRulerColor: `${defaultColors.covered}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(this.gutterCoveredDecoration, coveredLines);
        }

        if (uncoveredLines.length) {
            this.gutterUncoveredDecoration = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('uncovered'),
                overviewRulerColor: `${defaultColors.uncovered}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(this.gutterUncoveredDecoration, uncoveredLines);
        }

        if (partialLines.length) {
            this.gutterPartialDecoration = window.createTextEditorDecorationType({
                gutterIconPath: this.getGutter('partial'),
                overviewRulerColor: `${defaultColors.partial}99`,
                overviewRulerLane: OverviewRulerLane.Left
            });
            activeEditor.setDecorations(this.gutterPartialDecoration, partialLines);
        }

    }

    cleanGutter() {
        if (this.gutterCoveredDecoration) {
            this.gutterCoveredDecoration.dispose();
            this.gutterCoveredDecoration = null;
        }

        if (this.gutterUncoveredDecoration) {
            this.gutterUncoveredDecoration.dispose();
            this.gutterUncoveredDecoration = null;
        }

        if (this.gutterPartialDecoration) {
            this.gutterPartialDecoration.dispose();
            this.gutterPartialDecoration = null;
        }
    }

    // ============================================================================================

    updateE() {

        if (this.eDecoration) {
            this.eDecoration.dispose();
            this.eDecoration = null;
        }

        if (!this.showDetails || !this.fileCoverage) {
            return;
        }

        let uncoveredNoneBranches = this.fileCoverage.uncoveredNoneBranches;
        if (!uncoveredNoneBranches) {
            const { branches } = this.fileCoverage.data;
            uncoveredNoneBranches = branches.filter((it) => it.none && it.count === 0 && !it.ignored);
            this.fileCoverage.uncoveredNoneBranches = uncoveredNoneBranches;
        }

        if (!uncoveredNoneBranches.length) {
            return;
        }

        const activeEditor = window.activeTextEditor;
        const document = activeEditor.document;
        const eBranches = [];
        uncoveredNoneBranches.forEach((it) => {
            const p = document.positionAt(it.start);
            const locId = this.getPrevLocId(p);
            this.tooltipMap.set(locId, {
                tooltip: 'else path uncovered'
            });
            eBranches.push({
                range: new Range(p, p)
            });
        });

        this.eDecoration = window.createTextEditorDecorationType({
            overviewRulerColor: `${defaultColors.uncovered}99`,
            before: {
                contentText: 'E',
                color: '#ffffff',
                backgroundColor: defaultColors.uncovered,
                textDecoration: 'none; padding: 0 3px; cursor: default; border-radius: 3px; text-align: center'
            }
        });
        activeEditor.setDecorations(this.eDecoration, eBranches);

    }

    // ============================================================================================

    updateVisibleData() {

        if (this.uncoveredDecorationMap) {
            this.uncoveredDecorationMap.forEach((item) => {
                item.dispose();
            });
            this.uncoveredDecorationMap.clear();
            this.uncoveredDecorationMap = null;
        }

        if (this.hitsDecorationMap) {
            this.hitsDecorationMap.forEach((list) => {
                list.forEach((item) => {
                    item.dispose();
                });
            });
            this.hitsDecorationMap.clear();
            this.hitsDecorationMap = null;
        }

        if (!this.showDetails || !this.fileCoverage) {
            return;
        }

        this.uncoveredDecorationMap = new Map();
        this.hitsDecorationMap = new Map();

        if (this.fileCoverage.hitsMap) {
            // console.log('hitsMap already done');
            return;
        }

        const { hitsMap, lineMap } = this.getLinesCoverageInfo();

        this.fileCoverage.hitsMap = hitsMap;

        const uncoveredLineMap = new Map();
        lineMap.forEach((lineItem, line) => {
            const list = [];
            const { uncoveredEntire, uncoveredPieces } = lineItem;
            if (uncoveredEntire) {
                list.push({
                    start: lineItem.start + lineItem.indent,
                    end: lineItem.end
                });
            } else {
                if (uncoveredPieces.length) {
                    uncoveredPieces.forEach((p) => {
                        const { pieces } = p;
                        if (pieces) {
                            list.push({
                                start: lineItem.start + pieces.start,
                                end: lineItem.start + pieces.end
                            });
                        }
                    });
                }
            }
            if (list.length) {
                uncoveredLineMap.set(line, list);
            }
        });

        this.fileCoverage.uncoveredLineMap = uncoveredLineMap;

    }

    // ============================================================================================

    renderVisibleCoverage() {

        if (!this.showDetails || !this.fileCoverage) {
            return;
        }

        // update visible lines
        const visibleRanges = window.activeTextEditor.visibleRanges;
        const { start, end } = visibleRanges[0];

        // reduce blink when scrolling slowly
        const cacheLineSize = 50;

        // to 1-base
        const lineStart = start.line + 1 - cacheLineSize;
        const lineEnd = end.line + 1 + cacheLineSize;
        console.log('visible ranges', EC.yellow(`${lineStart} ~ ${lineEnd}`));

        this.renderUncoveredDecorations(lineStart, lineEnd);
        this.renderHitsDecorations(lineStart, lineEnd);

    }

    renderUncoveredDecorations(lineStart, lineEnd) {

        // one line on decoration (multiple ranges)

        const activeEditor = window.activeTextEditor;
        this.fileCoverage.uncoveredLineMap.forEach((list, line) => {
            // line 1-base
            if (line < lineStart || line > lineEnd) {
                // console.log(line, start, end);

                // remove
                if (this.uncoveredDecorationMap.has(line)) {
                    this.uncoveredDecorationMap.get(line).dispose();
                    this.uncoveredDecorationMap.delete(line);
                }

                return;
            }

            if (this.uncoveredDecorationMap.has(line)) {
                return;
            }

            const uncoveredRanges = [];
            list.forEach((item) => {
                uncoveredRanges.push({
                    range: new Range(
                        activeEditor.document.positionAt(item.start),
                        activeEditor.document.positionAt(item.end)
                    )
                });
            });
            const decoration = window.createTextEditorDecorationType({
                backgroundColor: '#ff000033'
            });
            activeEditor.setDecorations(decoration, uncoveredRanges);
            this.uncoveredDecorationMap.set(line, decoration);
            // console.log(line);

        });

        console.log(`visible uncovered: ${EC.yellow(this.uncoveredDecorationMap.size)}`);

    }

    renderHitsDecorations(lineStart, lineEnd) {

        // one line could be multiple decorations (single range)

        const activeEditor = window.activeTextEditor;
        this.fileCoverage.hitsMap.forEach((list, line) => {
            // line 1-base
            if (line < lineStart || line > lineEnd) {
                // console.log(line, start, end);

                // remove
                if (this.hitsDecorationMap.has(line)) {
                    const hits = this.hitsDecorationMap.get(line);
                    hits.forEach((item) => {
                        item.dispose();
                    });
                    this.hitsDecorationMap.delete(line);
                }

                return;
            }

            if (this.hitsDecorationMap.has(line)) {
                return;
            }

            const hits = [];
            list.forEach((range) => {

                const { start, count } = range;

                const hitsValue = Util.CF(count);
                const decoration = window.createTextEditorDecorationType({
                    before: {
                        contentText: `x${hitsValue}`,
                        color: '#ffffff',
                        backgroundColor: defaultColors.covered,
                        textDecoration: 'none; padding: 0 3px; cursor: default; border-radius: 3px; text-align: center'
                    }
                });

                const p = activeEditor.document.positionAt(start);
                const locId = this.getPrevLocId(p);
                this.tooltipMap.set(locId, {
                    tooltip: `${Number(count).toLocaleString()} hits`,
                    range
                });

                activeEditor.setDecorations(decoration, [{
                    range: new Range(p, p)
                }]);


                hits.push(decoration);
            });

            this.hitsDecorationMap.set(line, hits);
            // console.log(line);

        });

        console.log(`visible hits: ${EC.yellow(this.hitsDecorationMap.size)}`);

    }

    // ============================================================================================

    getLinesCoverageInfo() {

        // const isJS = fileCoverage.js;
        const { bytes, extras } = this.fileCoverage.data;

        const lineMap = new Map();
        const hitsMap = new Map();

        const source = window.activeTextEditor.document.getText();
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
                const sLoc = locator.offsetToLocation(start);
                const line = sLoc.line;
                if (hitsMap.has(line)) {
                    hitsMap.get(line).push(range);
                } else {
                    hitsMap.set(line, [range]);
                }
            }

            // defaults to count 1, do nothing for count === 1

        });

        return {
            lineMap,
            hitsMap
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

    destroy() {
        clearTimeout(this.timeout_update);
        this.coverageCache.clear();
        this.coverageCache = null;
        this.context = null;
    }
}

module.exports = MCRCoverage;
