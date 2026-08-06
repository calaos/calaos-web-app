Webapp for Calaos
-----------------

Requirements: Node.js >= 18.

Install dependencies:
```
npm install
```
Build the app (regenerates `dist/`, which is committed to git):
```
npm run build
```
To develop (serves `src/` on http://localhost:8000):
```
npm run dev
```
Don't forget to set the ws://xxx:5454/api URL in `src/scripts/dev_config.js`
(created with an empty host on first `npm run dev`) to develop against a
remote calaos_server.
