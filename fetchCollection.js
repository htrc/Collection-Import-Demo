//reading file system / file
var fs = require("fs");
//var http = require('http');
var request = require("request");
//Library to handle forms
var formidable = require("formidable");
//Library for input sanitation
var sanitizer = require('validator');
//uuid library
const uuidv1 = require('uuid/v1');
//config library
var config = require('config');

function extractCollectionIDFromURL(url) {
	return url.substring(url.indexOf('c=')+2);
}

function addPageSynchronously(query_index,queries) {
	request({
		method: 'POST',
		uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
		port: config.get('Read-Write_Endpoint.port'),
		form: {
			'default-graph-uri': '',
			'query': queries[query_index],
			'format': 'text/html'
		},
		auth: {
			user: config.get('Read-Write_Endpoint.username'),
			password:  config.get('Read-Write_Endpoint.password'),
			sendImmediately: false
		},
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		}
	}, function (er,rs,bd) {
		if (er) {
			console.log("ERROR IN ADDING VOLUMES TO WORKSET");
			console.log(er);
		}
		else {
			if (query_index+1 < queries.length) {
				addPageSynchronously(query_index+1,queries);
			}
		}
	});
}

function gathersPaging(workset,page_size,graph_url,target_url) {
	var base_text = 'PREFIX rdf:	<http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n';
	base_text += 'PREFIX ns1:	<http://wcsa.htrc.illinois.edu/>\n';
	base_text += 'PREFIX ns2:	<http://purl.org/dc/terms/>\n';
	base_text += 'PREFIX ns4:	<http://hdl.handle.net/2027/uc2.ark:/13960/>\n';
	base_text += 'PREFIX ns3:	<http://www.europeana.eu/schemas/edm/>\n';
	base_text += 'PREFIX fabio:	<http://purl.org/spar/fabio/>\n\n';
	base_text += 'INSERT INTO ' + graph_url + '\n';
	base_text += '{\n';

	queries = []

	for (var volume_counter = page_size; volume_counter < workset['gathers'].length; volume_counter++) {
		if (volume_counter % page_size == 0) {
			var new_query = base_text;
		}

		new_query += target_url + '\tns3:gathers\t<http://hdl.handle.net/2027/' + workset['gathers'][volume_counter]['htitem_id'] + '> .\n';

		if (volume_counter % page_size == page_size-1 || volume_counter == workset['gathers'].length-1) {
			new_query += '}';
			queries.push(new_query);
		}
	}

	addPageSynchronously(0,queries);
}

/*
 * Generic Workset Object should be able to be built from any of our input sources. Once they have all been normalized to this format, this format
 * can be used to build the SPARQL queries that we use to submit the Workset to Virtuoso. It should also be usable to create the public domain version
 * of the Workset that will be sent to the Registry.
 * 	REQUIRED FIELDS:
 *		- created: Date the workset was created
 *		- extent: Number of volumes in the workset
 *		- primary_creator: Person creating workset who will be able to edit it in the future. Presumably the person who is logged in to the Portal.
 *		- title: Workset title
 *		- abstract: Description of the workset
 *		- gathers: List of volumes in the workset
 *	OPTIONAL FIELDS:
 *		- origin: URL of collection workset was derived from
 *		- additional_creators: List of other people to credit with creation of workset. Won't be able to edit. Last one is the collection creator.
 *		- research_motivation: Reason for creating the workset
 *		- criteria: Why these specific volumes are included
 *	GENERATED FIELDS:
 *		- id: ID of workset we can use to retrieve it
 *
 *	NON-SUBMITED FIELDS THAT NEED TO BE GENERATED (To Do)
 *		- temporal_coverage: Use the volume-level created field to find this. This field needs to be revised across all volumes to make it clear its a date
 *		- language: Collect all language codes from all volumes. Volume-level metadata still needs laguage info added.
 */
function buildWorksetObject(fields) {
	var workset = {};

	if ('source_data' in fields && typeof fields.source_data == 'string' && sanitizer.isJSON(fields.source_data)) {
		var collection = JSON.parse(fields.source_data);
	}
	else {
		return undefined;
	}

	workset['id'] = uuidv1();

	var today = new Date();
	var dd = today.getDate();
	var mm = today.getMonth() + 1;
	var yyyy = today.getFullYear();
	if (dd<10) {
		dd = '0' + dd;
	}
	if (mm<10) {
		mm = '0' + mm;
	}

	workset['created'] = yyyy + '-' + mm + '-' + dd;

	if ('extent' in collection && typeof collection.extent == 'string' && sanitizer.escape(collection['extent']).length > 0) {
		workset['extent'] = sanitizer.escape(collection['extent']);
	}
	else if (Number.isInteger(collection.extent)) {
		workset['extent'] = collection['extent'];
	}
	else {
		return undefined;
	}

	if ('workset_creator_name' in fields && typeof fields.workset_creator_name == 'string' && sanitizer.escape(fields['workset_creator_name']).length > 0) {
		workset['primary_creator'] = sanitizer.escape(fields['workset_creator_name']);
	}
	else if ('created' in collection && typeof collection.created == 'string' && sanitizer.escape(collection['created']).length > 0) {
		workset['primary_creator'] = sanitizer.escape(collection['created']);
	}
	else {
		return undefined;
	}

	if ('htrc_workset_title' in fields && typeof fields.htrc_workset_title == 'string' && sanitizer.escape(fields['htrc_workset_title']).length > 0) {
		workset['title'] = sanitizer.escape(fields['htrc_workset_title']);
	}
	else if ('title' in collection && typeof collection.title == 'string' && sanitizer.escape(collection['title']).length > 0) {
		workset['title'] = sanitizer.escape(collection['title']);
	}
	else {
		return undefined;
	}

	if ('abstract' in fields && typeof fields.abstract == 'string' && sanitizer.escape(fields['abstract']).length > 0) {
		workset['abstract'] = sanitizer.escape(fields['abstract']);
	}
	else if ('description' in collection && typeof collection.description == 'string' && sanitizer.escape(collection['description']).length > 0) {
		workset['abstract'] = sanitizer.escape(collection['description']);
	}
	else {
		return undefined;
	}

	if ('gathers' in collection && Array.isArray(collection.gathers)) {
		workset['gathers'] = collection['gathers'];
	}
	else {
		return undefined;
	}

/*
	OPTIONAL FIELDS
*/

	if ('source_url' in fields && typeof fields.source_url == 'string' && sanitizer.isURL(fields.source_url)) {
		workset['origin'] = fields.source_url;
	}
	
	if ('additional_creator_name' in fields) {
		console.log(typeof fields['additional_creator_name']);
		console.log(fields['additional_creator_name']);
	}

	workset['additional_creators'] = []
	for (var index = 1; index < 10; index++) {
		if (('additional_creator_name'+index) in fields && typeof fields['additional_creator_name'+index] == 'string' && sanitizer.escape(fields['additional_creator_name'+index]).length > 0) {
			workset['additional_creators'].push(sanitizer.escape(fields['additional_creator_name'+index]));
		}
	}

	if ('created' in collection && typeof collection.created == 'string' && sanitizer.escape(collection['created']).length > 0 && collection['created'] != workset['primary_creator']) {
		workset['additional_creators'].push(sanitizer.escape(collection['created']));
	}

	if ('research_motivation' in fields && typeof fields.research_motivation == 'string' && sanitizer.escape(fields['research_motivation']).length > 0) {
		workset['research_motivation'] = sanitizer.escape(fields.research_motivation);
	}

	if ('criteria' in fields && typeof fields.criteria == 'string' && sanitizer.escape(fields.criteria).length > 0) {
		workset['criteria'] = sanitizer.escape(fields.criteria);
	}

	return workset;
}

function submitWorksetToVirtuoso(workset,res,return_html) {
	console.log(workset);

	var graph_url = '<http://worksets.hathitrust.org/graph/' + workset['id'] + '>';
	var target_url = '<http://worksets.hathitrust.org/wsid/' + workset['id'] + '>';

	console.log("SUCESS");
	if (return_html) {
		res.write('<head><link href="//fonts.googleapis.com/css?family=Open+Sans+Condensed:300,300italic,700" rel="stylesheet" type="text/css"><link href="//fonts.googleapis.com/css?family=Lora:400,700" rel="stylesheet" type="text/css"></head>');
		res.write('<div id="top_line"><img src="http://lgimages.s3.amazonaws.com/data/imagemanager/34307/htrc.jpg" height="50" style=" vertical-align: middle;"> <span id="htrc" style=" font-family: \'Open Sans Condensed\', sans-serif; font-size: 2em; font-weight: bold; color: #333; vertical-align: middle;">HathiTrust Research Center</span></div>');
		res.write('<div id="title" style=" font-family: \'Lora\', serif; color: #c31; font-size: 1.7em; font-weight: bold; margin-top: 0px; margin-bottom: 5px;">Create a new Workset from a HathiTrust Collection</div>');
		res.write('<div id="footer" style=" position: absolute; bottom: 10px; left 15px; font-family: sans-serif; font-size: 0.5em;"><a href="https://analytics.hathitrust.org">Home</a></div>');
	}

	var query = 'PREFIX rdf:	<http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n';
	query += 'PREFIX ns1:	<http://wcsa.htrc.illinois.edu/>\n';
	query += 'PREFIX ns2:	<http://purl.org/dc/terms/>\n';
	query += 'PREFIX ns4:	<http://hdl.handle.net/2027/uc2.ark:/13960/>\n';
	query += 'PREFIX ns3:	<http://www.europeana.eu/schemas/edm/>\n';
	query += 'PREFIX fabio:	<http://purl.org/spar/fabio/>\n\n';

	query += 'INSERT INTO ' + graph_url + '\n';
	query += '{\n' + target_url + '	rdf:type	ns1:Workset ;\n';

	query += '\tns2:created\t"' + workset['created'] + '" ;\n';
	query += '\tns2:extent\t' + workset['extent'] + ' ;\n';
	query += '\tns2:creator\t"' + workset['primary_creator'] + '" ;\n';

	if (workset['additional_creators'].length > 0) {
		for (var index = 0; index < workset['additional_creators'].length; index++) {
			query += '\tns2:creator\t"' + workset['additional_creators'][index] + '" ;\n';
		}
	}

	query += '\tns2:title\t"' + workset['title'] + '" ;\n';

	query += '\tns2:abstract\t"' + workset['abstract'] + '" ;\n';

	if ('research_motivation' in workset) {
		query += '\tns1:hasResearchMotivation\t"' + workset['research_motivation'] + '" ;\n';
	}

	if ('criteria' in workset) {
		query += '\tns1:hasCriterion\t"' + workset['criteria'] + '" ;\n';
	}

/*	Old language and temporal coverage code. Keeping for reference, will need to replace after data has been added to Virtuoso

	var language_index = 0;
	while ( 'language' + language_index.toString() in fields && fields['language' + language_index.toString()] != '') {
		query += '\tns2:language\t"' + fields['language' + language_index.toString()] + '" ;\n';
		language_index += 1;
	}

	var temporal_index = 0;
	while ('temporal_coverage' + temporal_index.toString() in fields && sanitizer.escape(fields['temporal_coverage' + temporal_index.toString()]) != '') {
		query += '\tns2:temporal\t"' + sanitizer.escape(fields['temporal_coverage' + temporal_index.toString()]) + '" ;\n';
		temporal_index += 1;
	}*/

	if ('origin' in workset) {
		query += '\tns2:isVersionOf\t<' + workset['origin'] + '> ;\n';
	}

	query += '\tns1:intendedForUse\t<http://example.org/htrc.algorithm> ;\n';
	query += '\tns1:hasVisibility\t"public" .\n';

	var max = workset['gathers'].length < 10000 ? workset['gathers'].length : 10000;
	for (var item = 0; item < max; item ++) {
		query += target_url + '\tns3:gathers\t<http://hdl.handle.net/2027/' + workset['gathers'][item]['htitem_id'] + '> .\n';
	}

	query += '}';

	console.log("ABOUT TO SEND TURTLE FILE");

	res.write("CANNOT SAVE WORKSET FOR DEMO");
	res.end();

	//Build collection
/*	request({
		method: 'POST',
		uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
		port: config.get('Read-Write_Endpoint.port'),
		form: {
			'default-graph-uri': '',
			'query': query,
			'format': 'text/html'
		},
		auth: {
			user: config.get('Read-Write_Endpoint.username'),
			password: config.get('Read-Write_Endpoint.password'),
			sendImmediately: false
		},
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		}
	}, function (er,rs,bd) {
		if (er) {
			res.write("ERROR IN ADDING WORKSET TO VIRTUOSO");
			res.write(er)
		}
		else {
			if (return_html) {
				res.write("Imported Collection <span style='font-weight:bold'>" + workset['title'] + "</span> from Hathi Trust with " + workset['extent'] + " volumes in collection<br>");
				res.write('Workset saved as: <a href=' + target_url.replace('<','').replace('>','') + '>' + target_url.replace('<','').replace('>','') + '</a><br>');
				res.end();
			}
			else {
				var pd_query = 'prefix dcterms: <http://purl.org/dc/terms/>\nprefix edm: <http://www.europeana.eu/schemas/edm/>\nprefix htrc: <http://wcsa.htrc.illinois.edu/> \nprefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nprefix xsd: <http://www.w3.org/2001/XMLSchema#>\n\nCONSTRUCT {\n  ?wsid\n	  rdf:type htrc:Workset ;\n	  dcterms:title ?title ;\n	  dcterms:creator ?cre ; \n	  dcterms:created ?dat ;\n	  dcterms:extent  ?ext ;\n	  edm:gathers ?vols .} \n\nwhere {\n  ?wsid \n	  rdf:type htrc:Workset ;\n	  dcterms:title ?title ;\n	  dcterms:creator ?cre ; \n	  dcterms:created ?dat ;\n	  dcterms:extent  ?ext ;\n	  edm:gathers ?vols . \n	  { select ?vols\n				where {\n				  ?wsid edm:gathers ?vols.\n				  ?vols dcterms:accessRights ?ar\n				  filter ( ?ar = "pd" ) .\n				}\n			  }\n  VALUES ( ?wsid ) \n	 { \n	   ( ' + target_url + ' ) \n	 }	  	   \n}';
				
				request({
					method: 'POST',
					uri: config.get('Read-Only_Endpoint.domain') + '/' + config.get('Read-Only_Endpoint.path'),
					port: config.get('Read-Only_Endpoint.port'),
					form: {
						'default-graph-uri': '',
						'query': pd_query,
						'format': 'text/html'
					},
					headers: {
						'Content-Type': 'application/x-www-form-unencoded',
					}
				}, function (e,r,b) {
					if (e) {
						res.write("ERROR GETTING PD WORKSET");
						res.write(e);
						res.end();
					}
					else {
						console.log("GOT PD WORKSET");

						var start_index = b.indexOf('n4:gathers');
						var shorter_string = b.substring(start_index);
						console.log(shorter_string);
						var slices = shorter_string.split('"');
						console.log(slices);
						var pd_volumes = [];
						for (var i = 0; i < slices.length; i++) {
							if (slices[i].substring(0,27) == 'http://hdl.handle.net/2027/') {
								pd_volumes.push(slices[i]);
							}
						}

						res.write(JSON.stringify({
							result_title: workset['title'],
							result_creator_name: workset['primary_creator'],
							result_extent: workset['extent'],
							result_url: target_url.replace('<','').replace('>',''),
							result_volumes: pd_volumes
						}));

						res.end();
					}
				});
			}
//			res.end();
		}
	});

	if (max < workset['gathers'].length) {
		gathersPaging(workset,10000,graph_url,target_url);
	}

	console.log("Created Workset");*/
}

function getCollectionFromURL(collection_id,res) {
	console.log("COLLECTION ID");
	console.log(collection_id);
	request({
		method: 'POST',
		uri: 'https://babel.hathitrust.org/cgi/mb',
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
			'Accept': 'application/json'
		},
		form: {
			c: collection_id,
			a: 'download',
			format: 'json'
		}
	}).pipe(res);
}

function saveWorkset(fields,res,return_html) {
	console.log("Reached saveWorkset")
	console.log(fields)
	var workset = buildWorksetObject(fields);
	if (workset) {
		if (return_html) {
			res.writeHead(200, {
				'content-type': 'text/html'
			});
		}
		else {
			res.writeHead(200, {
				'content-type': 'application/json'
			});
		}
		submitWorksetToVirtuoso(workset,res,return_html);
	}
	else {
		res.writeHead(400,{
			'content-type': 'text/html'
		});
		res.end("Bad Request");
	}
}

exports.respondToPOST = function(req,res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Content-type", "application/json");

	var form = new formidable.IncomingForm();

	console.log("READ FORM");
	console.log(req.get('Content-Type'));

	form.parse(req, function(err, fields, files) {
		if (err) {
			console.log(err);
			res.end(err);
		}
		else {
			console.log(fields);
			if ('function' in fields) {
				console.log("First Call");
				getCollectionFromURL(extractCollectionIDFromURL(decodeURIComponent(fields['source_url'])),res);
			}
			else {
				console.log("Second Call");
				if (req.accepts('html')) {
					var return_html = true;
				}
				else if (req.accepts('json')) {
					var return_html = false;
				}
				else {
					var return_html = true;
				}
				saveWorkset(fields,res,return_html);
			}
		}
	});
}

exports.displayForm = function(res) {
	fs.readFile('collection_input.html', function(err,data) {
		res.writeHead(200, {
			'Content-Type': 'text/html',
			'Content-Length': data.length
		});
		res.write(data);
		res.end();
	});
}
