'use strict';

/*
 * Production build: regenerates dist/ from src/ (replaces the old gulp build).
 *
 * - Parses the usemin-style build blocks in src/index.html
 *   (<!-- build:TYPE out/path --> ... <!-- endbuild -->), concatenates and
 *   minifies each block into one bundle, and rewrites dist/index.html.
 * - JS bundles: terser. The app bundle (build:js) is NOT name-mangled —
 *   AngularJS DI relies on function parameter names (no ng-annotate pass).
 *   Vendor bundles are mangled like before.
 * - CSS: clean-css, no URL rebasing (url()s like ../webfonts, ../fonts,
 *   ../images are kept literal — the dist/ layout makes them resolve).
 * - Views are minified into dist/views, images/fonts/webfonts copied,
 *   dist/scripts/dev_config.js generated with an EMPTY host, and
 *   dist/scripts/assets.json (image preload manifest) generated.
 */

var fs = require('fs');
var path = require('path');
var terser = require('terser');
var CleanCSS = require('clean-css');
var htmlMinifier = require('html-minifier-terser');
var common = require('./common');

var SRC = common.SRC;
var DIST = common.DIST;

var HTML_MINIFY_OPTS = {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    caseSensitive: true,
    keepClosingSlash: true,
    continueOnParseError: true,
};

function readSrc(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function writeDist(rel, content) {
    var p = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

async function minifyJsBundle(files, mangle) {
    var parts = [];
    for (var i = 0; i < files.length; i++) {
        var res = await terser.minify(readSrc(files[i]), {
            compress: { keep_fargs: true },
            mangle: mangle,
        });
        if (res.error) {
            throw new Error(files[i] + ': ' + res.error);
        }
        parts.push(res.code);
    }
    return parts.join(';\n');
}

function minifyCssBundle(files) {
    return files.map(function (f) {
        var res = new CleanCSS({ rebase: false, level: 1 }).minify(readSrc(f));
        if (res.errors.length) {
            throw new Error(f + ': ' + res.errors.join(', '));
        }
        return res.styles;
    }).join('\n');
}

// Parse "<!-- build:type out -->...<!-- endbuild -->" blocks like gulp-usemin.
function parseBuildBlocks(html) {
    var blocks = [];
    var re = /([ \t]*)<!--\s*build:(\w+)\s+(\S+)\s*-->([\s\S]*?)<!--\s*endbuild\s*-->/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var content = m[4];
        var refs = [];
        var refRe = /(?:src|href)="([^"]+)"/g;
        var r;
        while ((r = refRe.exec(content)) !== null) {
            refs.push(r[1]);
        }
        blocks.push({
            match: m[0],
            indent: m[1],
            type: m[2],
            out: m[3],
            refs: refs,
            // keep IE conditional comment wrappers (e.g. the oldie shim block)
            conditional: /\[if\s[^\]]*\]/.exec(content),
        });
    }
    return blocks;
}

async function buildIndexHtml() {
    var html = readSrc('index.html');
    var blocks = parseBuildBlocks(html);

    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var tag;
        if (b.type === 'css') {
            writeDist(b.out, minifyCssBundle(b.refs));
            tag = '<link rel="stylesheet" href="' + b.out + '">';
        } else {
            // js (app, un-mangled for AngularJS DI), jsvendor, jsoldie (mangled)
            writeDist(b.out, await minifyJsBundle(b.refs, b.type !== 'js'));
            tag = '<script src="' + b.out + '"></script>';
        }
        if (b.conditional) {
            tag = '<!--' + b.conditional[0] + '>' + tag + '<![endif]-->';
        }
        html = html.replace(b.match, b.indent + tag);
        console.log('bundle: ' + b.out + ' (' + b.refs.length + ' files)');
    }

    writeDist('index.html', await htmlMinifier.minify(html, HTML_MINIFY_OPTS));
}

async function buildViews() {
    var viewsDir = path.join(SRC, 'views');
    var files = fs.readdirSync(viewsDir, { recursive: true, withFileTypes: true });
    for (var i = 0; i < files.length; i++) {
        var ent = files[i];
        if (!ent.isFile() || !/\.html$/.test(ent.name)) {
            continue;
        }
        var abs = path.join(ent.parentPath, ent.name);
        var rel = path.relative(viewsDir, abs);
        var min = await htmlMinifier.minify(fs.readFileSync(abs, 'utf8'), HTML_MINIFY_OPTS);
        writeDist(path.join('views', rel), min);
    }
    console.log('views: done');
}

async function main() {
    // make sure src/libs is in sync with node_modules before reading bundles
    common.syncVendorLibs();

    fs.rmSync(DIST, { recursive: true, force: true });

    await buildIndexHtml();
    await buildViews();

    common.copyDir(path.join(SRC, 'images'), path.join(DIST, 'images'));
    common.copyDir(path.join(SRC, 'fonts', 'Source_Sans_Pro', 'fonts'), path.join(DIST, 'fonts'));
    common.copyDir(path.join(SRC, 'fonts', 'Ubuntu', 'fonts'), path.join(DIST, 'fonts'));
    common.copyDir(path.join(SRC, 'libs', 'fontawesome', 'webfonts'), path.join(DIST, 'webfonts'));

    // production dev_config.js: EMPTY host, the app derives the WS URL from
    // window.location — never ship a non-empty host here
    writeDist(path.join('scripts', 'dev_config.js'), common.DEV_CONFIG_JS);

    common.writeAssetsJson(path.join(DIST, 'scripts'));

    console.log('build: dist/ done');
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
