//reading file system / file
import fs from "fs";
//var http = require('http');
import needle from 'needle';
//url parser
import url from 'url';
//Library for input sanitation
//Library for input sanitation
import validator from 'validator';
//jsonld library
import jsonld from 'jsonld';
//XML parsing library
import xml2js from 'xml2js';
//config library
import config from 'config';

var functionConfigs;
fs.readFile('./viewWorksets/config-hashed.json', function(err,data) {
	functionConfigs = JSON.parse(data);
});

function getParameters(req,function_name) {
	var requiredParam = functionConfigs[function_name]['required'];
	var optionalParam = functionConfigs[function_name]['optional'];
	var user_submitted_params = url.parse(req.url, true).query;
	var approved_params = {};

	//Make sure all required parameters are present
	for (var index = 0; index < requiredParam.length; index++) {
		if (!(requiredParam[index] in user_submitted_params)) {
			throw Error("parameter " + requiredParam[index] + " is missing");
		}
	}

	for (var key in user_submitted_params) {
		//Make sure no extranious parameters are present
		if (!requiredParam.includes(key) && !optionalParam.includes(key)) {
			throw Error("parameter " + key + " is not allowed");
		}

		//Make sure parameter value is of the correct type
		var verifyTypeFunction = undefined;
		if (functionConfigs[function_name][key]['type'] == 'url') {
			verifyTypeFunction = validator.isURL;
		}
		else if (functionConfigs[function_name][key]['type'] == 'integer') {
			verifyTypeFunction = validator.isInt;
		}
		else if (functionConfigs[function_name][key]['type'] == 'string') {
//			verifyTypeFunction = validator.isAlpha;
//			console.log(typeof user_submitted_params[key]);
			user_submitted_params[key] = validator.escape(user_submitted_params[key]);
		}
		else {
			throw Error("Input type " + functionConfigs[function_name][key]['type'] + " not implemented");
		}

		if (functionConfigs[function_name][key]['type'] != 'string') {
			if (verifyTypeFunction(user_submitted_params[key])) {
				approved_params[key] = user_submitted_params[key];
			}
			else {
				throw Error("Parameter " + key + " must be a " + functionConfigs[function_name][key]['type']);
			}
		}
		else {
			approved_params[key] = user_submitted_params[key];
		}
	}

	return approved_params;
}

function sendSPARQLQuery(query,serviceMethod,params,req,res) {
	needle.post(config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port') + '/' + config.get('Read-Only_Endpoint.path'),{
		'default-graph-uri': '',
		'query': query,
		'format': 'application/ld+json'
	}, function (er,rs,bd) {
		if (er) {
			res.write("ERROR IN SENDING REQUEST");
			res.write(er);
		}
		else {
			console.log("REQUEST WORKED");

			var promises = jsonld.promises;
			var promise = promises.compact(JSON.parse(bd),functionConfigs[serviceMethod]['context']);
			promise.then(function(compacted) {
				if (serviceMethod == 'getWorksetPage') {
					var target = undefined;
					var ext = undefined;
					for (var component in compacted['graph']) {
						if (compacted['graph'][component]['type'] == 'WorksetPage') {
							target = compacted['graph'][component];
						}
						else if (compacted['graph'][component]['type'] == 'Workset') {
							ext = compacted['graph'][component]['extent'];
						}
					}

					if (target['startIndex'] > 1) {
						target['first'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '&pageNo=1&pageSize=' + params['pageSize'];
					}

					if (params['pageNo'] > 1) {
						target['previous'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '&pageNo=' + (params['pageNo']-1) + '&pageSize=' + params['pageSize'];
					}

					if ((params['pageNo'])*params['pageSize'] < ext) {
						target['next'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '&pageNo=' + (parseInt(params['pageNo'])+1) + '&pageSize=' + params['pageSize'];

						var last_page = parseInt(params['pageNo']);
						while ((last_page-1)*params['pageSize'] < ext) {
							last_page++;
						}
						last_page = last_page - 1;
						target['last'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '&pageNo=' + last_page + '&pageSize=' + params['pageSize'];
					}
				}

				if (req['headers']['accept'].indexOf('application/ld+json') !== -1) {
					/*Return results as JSON-LD*/
					res.writeHead(200, {"Content-Type": "application/ld+json"});
					res.end(JSON.stringify(compacted));
				}
				else {
					/*Return results as HTML (not implemented yet, so still returning JSON-LD)*/
					res.writeHead(200, {"Content-Type": "application/ld+json"});
					res.end(JSON.stringify(compacted));
				}
				return;
			}, function(err) {
				res.write("ERROR IN PROMISE");
				res.end(err);
			});
		}
	});
}

function deleteWorkset(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = "deleteWorkset";

	var params = getParameters(req,method_name);
	var template_file = functionConfigs[method_name]['query'];
	fs.readFile('./viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE");
			console.log(err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				console.log(params['id']);
				if (params['id'].substring(0,config.get('Read-Write_Endpoint.domain').length+7) == config.get('Read-Write_Endpoint.domain') + '/graph/') {
					data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');
				}
				else {
					throw Error("Graph id must start with '" + config.get('Read-Write_Endpoint.domain') + "/graph/'");
				}

//				response = sendSPARQLQuery(data_string,method_name,params,req,res);
				needle.post(config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port') + '/' + config.get('Read-Only_Endpoint.path'),{
					'default-graph-uri': '',
					'query': data_string,
					'format': 'application/ld+json'
				}, function (er,rs,bd) {
					if (er) {
						res.write("ERROR IN SENDING REQUEST");
						res.write(er);
					}
					else {
						try {
							console.log("SELECTED WORKSET, CHECKING CREATOR TO CONFIRM DELETION");
//							params['creator'];

							var creator_varified = false;
							var parser = new xml2js.Parser();
							console.log(bd);
							parser.parseString(bd, function(err,result) {
								console.log(result);
								var creator_names = [];
								console.log('result' in result['sparql']['results'][0]);
								if ('result' in result['sparql']['results'][0]) {
									console.log("WRONG WAY");
									var results = result['sparql']['results'][0]['result'];
									for (var i = 0; i < results.length; i++) {
										console.log(results[i]['binding'][0]['literal'][0]);
										console.log(results[i]['binding'][0]['literal'][0] == params['creator']);
										if (results[i]['binding'][0]['literal'][0] == params['creator']) {
											fs.readFile('./viewWorksets/' + functionConfigs[method_name]['delete_query'], function(e,d) {
												if (e) {
													console.log("ERROR READING FILE");
													console.log(e);
												}
												else {
													var delete_query_string = d.toString('utf8');
													delete_query_string = delete_query_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');
													console.log(delete_query_string);

													needle.post(config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),{
														'default-graph-uri': '',
														'query': delete_query_string,
														'format': 'application/ld+json'
													},{
														username: config.get('Read-Write_Endpoint.username'),
														password: config.get('Read-Write_Endpoint.password'),
														auth: 'digest'
													}, function (e,r,b) {
														if (e) {
															res.write("ERROR IN SENDING REQUEST");
															res.write(e);
														}
														else {
															res.end("Workset deleted");
														}
													});
												}
											});
										}
									}
								}
								else {
									throw Error("Cannot delete workset that does not exist");
								}
							});
//							console.log(doc);
//							res.end(bd);
						}
						catch (err) {
							errorStatus.message = err.message;
							res.end(JSON.stringify(errorStatus));
							return;
						}
					}
				});

//				res.end(response);
			}
			catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	})
}

function getWorksetPage(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = 'getWorksetPage';

	var params = getParameters(req,method_name);
	if ('ar' in params) {
		var template_file = functionConfigs[method_name]['filterd_query'];
	}
	else {
		var template_file = functionConfigs[method_name]['query'];
	}
	fs.readFile('./viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE");
			console.log(err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');

				if (!('pageNo' in params)) {
					params['pageNo'] = functionConfigs['defaultPageNo'];
				}

				if (!('pageSize' in params)) {
					params['pageSize'] = functionConfigs['defaultPageSize'];
				}

				if (params['pageSize'] < 1) {
					throw Error(params['pageSize'] + " is an invalid page size");
				}

				var workset_page = '<' + params['id'] + '?pageNo=' + params['pageNo'] + '&pageSize=' + params['pageSize'] + '>';
				data_string = data_string.replace(/\$wsP\$/g,workset_page);
				data_string = data_string.replace(/\$limit\$/g,params['pageSize']);
				var offset = (params['pageNo']-1)*params['pageSize'];

				if (offset < 0) {
					throw Error(params['pageNo'] + " is an invalid page number");
				}

				data_string = data_string.replace(/\$offset\$/g,offset);
				var startIndex = offset+1;
				data_string = data_string.replace(/\$startIndex\$/g,startIndex);

				if ('ar' in params) {
					if (params['ar'] == 'pd' || params['ar'] == 'ic') {
						var workset_filtered = '<' + params['id'] + '?ar=' + params['ar'] + '>';
						data_string = data_string.replace(/\$wsF\$/g,workset_filtered);
					}
					else {
						throw Error(params['ar'] + " is not a valid ar value");
					}
				}

	//			res.end(data_string);
				sendSPARQLQuery(data_string,'getWorksetPage',params,req,res);
			} catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	});
}

function listWorksetsContaining(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = 'listWorksetsContaining';

	var params = getParameters(req,method_name);
	var volume_urls = params['id'].split(',');

	var template_file = functionConfigs[method_name]['query'];
	fs.readFile('./viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE");
			console.log(err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + volume_urls[0] + '>');

				if (volume_urls.length > 1) {
					var second_template = functionConfigs[method_name]['secondary_query'];
					fs.readFile('./viewWorksets/' + second_template, function(e,d) {
						if (e) {
							console.log("ERROR READING FILE");
							console.log(e);
						}
						else {
							try {
								var d_string = d.toString('utf8');
								for (var index = 1; index < volume_urls.length; index++) {
									data_string = data_string.substring(0,data_string.length-1) + d_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + volume_urls[index] + '>');
								}

								sendSPARQLQuery(data_string,'listWorksetsContaining',params,req,res);
							} catch (e) {
								errorStatus.message = e.message;
								res.end(JSON.stringify(errorStatus));
								return;
							}
						}
					});
				}
				else {
					sendSPARQLQuery(data_string,'listWorksetsContaining',params,req,res);
				}
			} catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	});
}

export function runSPARQLQuery(req,res) {
/*	var allowed_origins = ['analytics.hathitrust.org'];
	if ('origin' in req['headers']) {
		if (allowed_origins.includes(req['headers']['Origin'])) {
			res.header("Access-Control-Allow-Origin", req['headers']['Origin']);
			res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		}
	}*/
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

	var errorStatus = {
		errorcode: -1
	};

	try {
		var serviceMethod = req.params.serviceMethod;

		if (serviceMethod == 'getWorksetPage' || serviceMethod == 'listWorksetsContaining' || serviceMethod == 'getVolume' || serviceMethod == 'deleteWorkset' ) {
			if (serviceMethod == 'getWorksetPage') {
				getWorksetPage(req,res);
			}
			else if (serviceMethod == 'listWorksetsContaining') {
				listWorksetsContaining(req,res);
			}
			else if (serviceMethod == 'deleteWorkset') {
				deleteWorkset(req,res);
			}
		}
		else {
			throw Error(req.params.serviceMethod + " does not exist");
		}
	} catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
}