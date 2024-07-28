
const MCRCoverage = require('./coverage.js');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let mcrCoverage;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('MCR is now active!');

    mcrCoverage = new MCRCoverage(context);

}


// This method is called when your extension is deactivated
function deactivate() {

    if (mcrCoverage) {
        mcrCoverage.destroy();
    }

    console.log('MCR is now deactivate!');
}

module.exports = {
    activate,
    deactivate
};
