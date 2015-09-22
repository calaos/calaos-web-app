Webapp for Calaos
-----------------

To build, install nodejs, and:
```
npm install -g bower gulp
```
Then install dependencies:
```
npm install
bower install
```
Then to build the app:
```
gulp
```
To develop with livereload:
```
gulp serve
```
Don't forget to set the ws://xxx/api URL in src/scripts/dev_config.js
