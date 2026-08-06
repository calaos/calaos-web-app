'use strict';

/*
 * Shared helpers for the build (tools/build.js) and dev server (tools/serve.js).
 * The app is plain ES5 AngularJS loaded through <script> tags — no module
 * system. These tools only replicate the old gulp pipeline semantics.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');
var DIST = path.join(ROOT, 'dist');
var NODE_MODULES = path.join(ROOT, 'node_modules');

// Content of the production dev_config.js (empty host: the app derives the
// WebSocket URL from window.location). Never ship a non-empty host.
var DEV_CONFIG_JS = "var calaosDevConfig = { calaosServerHost: '' };";

/*
 * Runtime libraries synced from node_modules into src/libs/ (gitignored),
 * so the dev server can serve them and the build can read them via the
 * paths referenced in src/index.html. This replaces src/bower_components.
 * angular-farbtastic has no npm package and is vendored in src/vendor/.
 */
var VENDOR_FILES = [
    ['jquery/dist/jquery.js', 'jquery/jquery.js'],
    ['angular/angular.js', 'angular/angular.js'],
    ['angular-sanitize/angular-sanitize.js', 'angular-sanitize/angular-sanitize.js'],
    ['@uirouter/angularjs/release/angular-ui-router.js', 'angular-ui-router/angular-ui-router.js'],
    ['ng-dialog/js/ngDialog.min.js', 'ng-dialog/js/ngDialog.min.js'],
    ['ng-dialog/css/ngDialog.min.css', 'ng-dialog/css/ngDialog.min.css'],
    ['ng-dialog/css/ngDialog-theme-default.min.css', 'ng-dialog/css/ngDialog-theme-default.min.css'],
    ['ng-dialog/css/ngDialog-theme-plain.min.css', 'ng-dialog/css/ngDialog-theme-plain.min.css'],
    ['@fortawesome/fontawesome-free/css/all.css', 'fontawesome/css/all.css'],
    ['font-awesome-animation/dist/font-awesome-animation.min.css', 'font-awesome-animation/font-awesome-animation.min.css'],
    ['magnific-popup/dist/magnific-popup.css', 'magnific-popup/magnific-popup.css'],
    ['es5-shim/es5-shim.js', 'es5-shim/es5-shim.js'],
    ['json3/lib/json3.js', 'json3/json3.js'],
];

// Directories copied verbatim (Font Awesome css references ../webfonts/).
var VENDOR_DIRS = [
    ['@fortawesome/fontawesome-free/webfonts', 'fontawesome/webfonts'],
];

function copyFile(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

// Recursive copy, skipping dotfiles (same as gulp.src default).
function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from, { withFileTypes: true }).forEach(function (ent) {
        if (ent.name.charAt(0) === '.') {
            return;
        }
        var src = path.join(from, ent.name);
        var dst = path.join(to, ent.name);
        if (ent.isDirectory()) {
            copyDir(src, dst);
        } else {
            fs.copyFileSync(src, dst);
        }
    });
}

function syncVendorLibs() {
    var libs = path.join(SRC, 'libs');
    VENDOR_FILES.forEach(function (entry) {
        copyFile(path.join(NODE_MODULES, entry[0]), path.join(libs, entry[1]));
    });
    VENDOR_DIRS.forEach(function (entry) {
        copyDir(path.join(NODE_MODULES, entry[0]), path.join(libs, entry[1]));
    });
}

/*
 * Image preload manifest, same shape as the old gulp piclist task:
 * a JSON array of "images/<filename>" strings (dotfiles excluded).
 * Consumed by the preloader in src/scripts/controllers/main.js.
 */
function listImages() {
    var out = [];
    (function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
            if (ent.name.charAt(0) === '.') {
                return;
            }
            var p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(p);
            } else {
                out.push('images/' + ent.name);
            }
        });
    })(path.join(SRC, 'images'));
    return out.sort();
}

function writeAssetsJson(destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'assets.json'),
        JSON.stringify(listImages(), null, 2) + '\n');
}

module.exports = {
    ROOT: ROOT,
    SRC: SRC,
    DIST: DIST,
    DEV_CONFIG_JS: DEV_CONFIG_JS,
    copyDir: copyDir,
    syncVendorLibs: syncVendorLibs,
    writeAssetsJson: writeAssetsJson,
};
