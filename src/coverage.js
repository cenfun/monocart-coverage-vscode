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

        const { subscriptions } = context;

        const coverageCommandId = 'monocart-coverage-vscode.coverage';
        const coverageCommand = commands.registerCommand(coverageCommandId, function() {
        // The code you place here will be executed every time your command is executed

            // Display a message box to the user
            window.showInformationMessage(coverageCommandId);
        });

        subscriptions.push(coverageCommand);

        const statusBar = window.createStatusBarItem(StatusBarAlignment.Left);
        statusBar.command = coverageCommandId;
        this.statusBar = statusBar;

        subscriptions.push(statusBar);

        subscriptions.push(window.onDidChangeActiveTextEditor(() => {
            this.updateStatusBar();
        }));

        this.updateStatusBar();

        const activeEditor = window.activeTextEditor;


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

        // setTimeout(() => {
        //     activeEditor.setDecorations(uncoveredGutter, []);
        // }, 10000);

        const pattern = '**/coverage-report.json';
        const fileChangedEmitter = new EventEmitter();
        fileChangedEmitter.event((uri) => {
            console.log('event', uri.path);
        });

        subscriptions.push(watchCoverageReports(fileChangedEmitter, pattern));
        initCoverageReports(fileChangedEmitter, pattern);

    }


    updateStatusBar() {
        // $(debug-coverage)
        // 🟢 🟡 🔴 🟠 ⚫ ⚪ 🟣 🔵

        this.statusBar.text = '🟢 Coverage 98%';

        // new vscode.ThemeColor('statusBarItem.warningBackground')
        // statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBar.color = new ThemeColor('statusBarItem.prominentForeground');
        this.statusBar.tooltip = new MarkdownString(`## My MCR Coverage Report
| Name | Coverage % | Covered | Uncovered | Total |
| :--- | ---------: | ------: | --------: | ----: |
| Bytes | 🟢 87.45 % | 292,967 |    42,056 | 335,023 |
| Statements | 🟢 85.24 % |   4,367 |       756 | 5,123 |
| Branches | 🟡 68.68 % |   1,351 |       616 | 1,967 |
| Functions | 🟢 87.75 % |     702 |        98 |   800 |
| Lines | 🟢 82.82 % |   7,465 |     1,549 | 9,014 |`);
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

    }
}


function watchCoverageReports(fileChangedEmitter, pattern) {

    const watcher = workspace.createFileSystemWatcher(pattern);

    watcher.onDidCreate((uri) => {
        fileChangedEmitter.fire(uri);
    });
    watcher.onDidChange((uri) => {
        fileChangedEmitter.fire(uri);
    });
    watcher.onDidDelete((uri) => {
        fileChangedEmitter.fire(uri);
    });

    return watcher;

}

async function initCoverageReports(fileChangedEmitter, pattern) {
    const files = await workspace.findFiles(pattern);
    for (const file of files) {
        fileChangedEmitter.fire(file);
    }
}


module.exports = MCRCoverage;
