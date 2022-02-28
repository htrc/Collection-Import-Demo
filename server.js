//author: nnp2

//reading file system / file
import fs from "fs";
//http and rest nodejs library
import http from 'http';
import https from 'https';
var privateKey = fs.readFileSync('sslcert/worksethtrc.key','utf8');
var certificate = fs.readFileSync('sslcert/worksets.hathitrust.org.cert','utf8');
var credentials = {key: privateKey, cert: certificate};
import express from 'express';
var app = express();
app.use(express.static('public'));

//var request = require("request");
//module for fetchCollection
import * as fetchCollection from './fetchCollection.js';
import * as dcWSfetch from './dcWSfetch.js';
import * as viewWorksets from './viewWorksets.js';

//Run the server
var httpServer = http.createServer(app);
var httpsServer = https.createServer(credentials,app);

httpServer.listen(8080, function() {
	var host = httpServer.address().address;
	var port = httpServer.address().port;
        console.log("HTTP server listening on " + host + " port " + port);
	httpServer.maxConnections = 100;
})
httpsServer.listen(8443, "localhost", function() {
	var host = httpsServer.address().address;
	var port = httpsServer.address().port;
        console.log("HTTPS server listening on " + host + " port " + port);
	httpsServer.maxConnections = 100;
})

/*try {
	request({
		method: 'HEAD',
		uri: 'http://worksets.hathitrust.org:80',
		port: '80'
	}, function(error,response,body) {
		if (error) {
			console.log("HTTP REQUEST ERROR");
			console.log(error);
		}
		else {
			console.log("SUCCESS");
			console.log(response);
		}
	});
}
catch (error) {
	console.log("TRY FAILED");
	console.log(error);
}*/

function requireHTTPS(req, res, next) {
	if (!req.secure) {
		var host_string = req.get('host');
//		return res.redirect('https://' + req.get('host') + req.url);
		return res.redirect('https://' + host_string.substring(0,host_string.indexOf(':')) + req.url);
	}
	next();
}

//handle calls to fetchCollection
app.get('/fetchCollection', requireHTTPS, function(req,res) {
	fetchCollection.displayForm(res);
})

app.post('/fetchCollection', requireHTTPS, function(req,res) {
	fetchCollection.respondToPOST(req,res);
})

app.get("/dcWSfetch/:serviceMethod", function(req, res) {
	dcWSfetch.runSPARQLQuery(req,res);
})

app.get('/viewWorksets/:serviceMethod', function(req, res) {
	viewWorksets.runSPARQLQuery(req,res);
})
