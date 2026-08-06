'use strict';

/*
 * Dev server (replaces the old `gulp serve`): serves src/ on port 8000.
 *
 * On startup it:
 *  - syncs the npm runtime libs into src/libs/ (see tools/common.js)
 *  - generates src/scripts/assets.json (image preload manifest)
 *  - creates a default src/scripts/dev_config.js (empty host) if missing;
 *    point calaosServerHost at ws://host:5454/api to develop against a
 *    remote calaos_server (the file is gitignored)
 */

var fs = require('fs');
var http = require('http');
var path = require('path');
var common = require('./common');

var SRC = common.SRC;
var PORT = parseInt(process.env.PORT || '8000', 10);

var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8',
};

common.syncVendorLibs();
common.writeAssetsJson(path.join(SRC, 'scripts'));

var devConfig = path.join(SRC, 'scripts', 'dev_config.js');
if (!fs.existsSync(devConfig)) {
    fs.writeFileSync(devConfig, common.DEV_CONFIG_JS + '\n');
    console.log('created default ' + devConfig + ' (empty host)');
}

http.createServer(function (req, res) {
    var urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
    }

    var file = path.normalize(path.join(SRC, urlPath));
    if (!file.startsWith(SRC + path.sep) && file !== SRC) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, 'index.html');
    }

    fs.readFile(file, function (err, data) {
        if (err) {
            res.writeHead(404);
            res.end('Not found: ' + urlPath);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
}).listen(PORT, function () {
    console.log('dev server: http://localhost:' + PORT + ' (serving src/)');
});
