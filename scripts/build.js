const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const metadataReport = require('esbuild-metadata-report');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');


/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log(`[watch] build finished ${new Date().toISOString()}`);
        });
    }
};

async function main() {

    if (production) {
        fs.rmSync(path.resolve('./dist'), {
            force: true,
            recursive: true,
            maxRetries: 10
        });
    }

    const ctx = await esbuild.context({
        entryPoints: [
            'src/extension.js'
        ],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',

        metafile: true,

        plugins: [
            esbuildProblemMatcherPlugin,
            metadataReport({
                name: 'MCR VSCode Metadata Report',
                outputFile: './.temp/metadata-reports/index.html'
            })
        ]
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
