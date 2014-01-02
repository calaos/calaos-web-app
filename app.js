var fs = require("fs");
var host = "127.0.0.1";
var port = 3001;
var express = require("express");

var app = express();

app.use(express.static(__dirname + "/app")); //use static files in ROOT/public folder
app.use(express.static(__dirname + "/app/css")); //use static files in ROOT/public folder
app.use(express.static(__dirname + "/app/js")); //use static files in ROOT/public folder
app.use(express.static(__dirname + "/app/img")); //use static files in ROOT/public folder



app.listen(port, host);
