//url parser to
//serialize querystring parameter
//thenRequest is a library to make sync request call
//async is a library to call async request
//_ is an array, collection and text library
//jsonld library
//Q for promises
var url = require('url');
var querystring = require('querystring');
var thenRequest = require('then-request');
var async = require('async');
var _ = require('underscore');
var jsonld = require('jsonld');
var Q = require('q');
var config = require('config');

//load jsonConfig
var jsonConfig = {};

console.time("loadconfig");
//init json config from url
resourceRoot = "http://worksets.hathitrust.org/dcWSfetch_resources/"
jsonConfigFile = "config-hashed.json"
//load configuration
async.series([
	function() {
		result = thenRequest('GET', resourceRoot + jsonConfigFile);
		result.then(function(res) {
			jsonConfig = JSON.parse(res.getBody('UTF-8'));
			//parse json Config, find any resource configuration url
			Object.keys(jsonConfig.services).forEach(function(keyConfig) {
				var configService = jsonConfig.services[keyConfig];
				Object.keys(configService).forEach(function(key) {
					var methodConfig = configService[key];
					//parse Sparql definition
					if (_.isObject(methodConfig)) {
						console.time("getSparqlResource");
						if (methodConfig['query'] !== undefined) {
							result = thenRequest('GET', methodConfig['query']);
							result.then(function(resSparql) {
								console.timeEnd("getSparqlResource");
								data = resSparql.getBody('UTF-8');
								methodConfig['resQuery'] = data;
							});
						}
						if (methodConfig['paging'] !== undefined) {
							result = thenRequest('GET', methodConfig['paging']['query']);
							result.then(function(resSparql) {
								data = resSparql.getBody('UTF-8');
								methodConfig['resPaging'] = data;
							});
						}
						if (methodConfig['context'] !== undefined) {
							console.time("getContextResource");
							resultContext = thenRequest('GET', methodConfig['context']);
							resultContext.then(function(resSparql) {
								console.timeEnd("getContextResource");
								data = resSparql.getBody('UTF-8');
								methodConfig['resContext'] = JSON.parse(data);
							});
						}
					}
				})
			})
			console.timeEnd("loadconfig");
		})
	}
])

//Used to load results where the number of triples is greater than the set limit
function tracePage(serviceConfig,pOffset,pLimit) {
	var tracePagePromise = Q.defer();
	pageQuery = serviceConfig.resPaging;
	pOffset = pOffset + pLimit + 1;
	pageQuery = pageQuery + " OFFSET " + pOffset + " LIMIT " + pLimit;
	sqlParser = new SqlParser(pageQuery, params, serviceConfig);
	sqlParser.replace();
	pageQuery = sqlParser.getRdfSql();
								
	pagedSqlPoster = new PostCode(host, defaultGraphUrl, pageQuery, shouldSponge, format, timeout, debug);
	pagedBody = pagedSqlPoster.postQuery();
	pagedBody.then(function(resPaged) {
		jsonPaged = JSON.parse(resPaged.getBody('UTF-8'));
		if (jsonPaged["@graph"]!==undefined&&jsonPaged["@graph"][0][serviceConfig.paging.field] !== undefined) {
			var objectPaged = jsonPaged["@graph"][0][serviceConfig.paging.field];
			nextPage = tracePage(serviceConfig,pOffset,pLimit);
			nextPage.then(function(resPage){						
				objectPaged.push.apply(objectPaged,resPage);
				tracePagePromise.resolve(objectPaged);
			});										
		} else {
			tracePagePromise.resolve([]);
		}
	},function(err){
		tracePagePromise.resolve([]);
	});
	return tracePagePromise.promise;
}

exports.runSPARQLQuery = function(req,res) {
	// set content-type based on output parameter
	var serviceName = "dcWSfetch";
	var serviceMethod = req.params.serviceMethod;
	//Define object for error return value
	var errorStatus = {
		errorcode: -1
	};
	var limit = jsonConfig.services[serviceName]['limit'];


	//Trap for unconfig servicename
	try {
		//Trap for unconfig servicemethod

		if (jsonConfig.services[serviceName][serviceMethod] == undefined) {
			throw Error("service method " + serviceMethod + " for " + serviceName + " is undefined");
		}


		var queryString = url.parse(req.url, true).query;

		requiredParam = jsonConfig.services[serviceName][serviceMethod]["required"];
		optionalParam = jsonConfig.services[serviceName][serviceMethod]["optional"];
		optionalParam.push("offset");
		optionalParam.push("limit");

		format = "application/x-json+ld";
		output = "application/ld+json"
		params = {};
		var serviceConfig = jsonConfig.services[serviceName][serviceMethod];
		//Parse url parameters , check if there is some parameters that is not allowed
		console.time("parseparam");
		Object.keys(queryString).forEach(function(key) {
			if (!_.contains(requiredParam, key) && !_.contains(optionalParam, key)) {
				throw Error("parameter " + key + " is not allowed");
			}
			var val = queryString[key];
			if (serviceConfig[key] !== undefined && serviceConfig[key]['type'] !== undefined) {
				switch (serviceConfig[key]['type']) {
					case "url":
						urlRegex = /^(https?:\/\/(?:www\.|(?!www))[^\s\.]+\.[^\s]{2,}|www\.[^\s]+\.[^\s]{2,})\w$/;
						result = val.match(urlRegex);
						val = '<'+val+'>';

						if (result === null) {
							throw Error("Parameter " + key + " must be a URL, example http://hathitrust.org/id/123");
						}
						break;
					case "number":
						numberRegex = /^[0-9]*/;
						result = val.match(numberRegex);

						if (result === null) {
							throw Error("Parameter " + key + " must be a number");
						}
						break;
				}
			}
			//Change to params[key] only
			params[key] = val;
		});
		console.timeEnd("parseparam");

		//Set response / result header into requested format
		res.setHeader('content-type', output);

		host = config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port');
		defaultGraphUrl = "";
		shouldSponge = "";
		timeout = 0;
		debug = "off";
		query = "";

		var body = {};

		//get sparql query
		try {
			var result = {};
			var query = serviceConfig['resQuery'];

			//Get SPARQL Query as text
			if (serviceConfig.customized) {
				//Custom query function
				customQuery = new CustomQuery();
				query = customQuery[serviceConfig['function']](serviceConfig, params, query);
			} else {
				//Parse the rdfSql first and inject parameters:query:
				sqlParser = new SqlParser(query, params, serviceConfig);
				sqlParser.replace();
				query = sqlParser.getRdfSql();
			}

			var offset = 0;
			if (params['offset'] !== undefined) {
				offset = params['offset'];
				query = query + " OFFSET " + params['offset'];
			}
			if (params['limit'] !== undefined) {
				query = query + " LIMIT " + params['limit'];
			}/* else if (params['pageNo'] !== undefined && params['pageSize'] !== undefined) {
				var pageSize = Number(params['pageSize']);
				var pageNo = Number(params['pageNo']) - 1;
				query = query + " ORDER BY ?vols";
				query = query + " LIMIT " + pageSize;
				query = query + " OFFSET " + (pageNo * pageSize);
			}*/ else {
				query = query + " LIMIT " + limit;
			}

			sqlPorter = new PostCode(host, defaultGraphUrl, query, shouldSponge, format, timeout, debug);
			console.time("postQuery");
			body = sqlPorter.postQuery();
			body.then(function(resBody) {
				//parse result into jsonConfig
				console.timeEnd("postQuery");

				var jsonldBody = JSON.parse(resBody.getBody('UTF-8'));
				postPagingDefer = Q.defer();

				//Paging handler
				if (serviceConfig.paging !== undefined) {				
					if (jsonldBody["@graph"]!==undefined&&jsonldBody["@graph"][0][serviceConfig.paging.field].length === limit) {
						tracePage(serviceConfig,offset,limit).then(function(resPage) {
							jsonldBody["@graph"][0][serviceConfig.paging.field].push.apply(jsonldBody["@graph"][0][serviceConfig.paging.field],resPage);
							postPagingDefer.resolve(jsonldBody);
						})
					} else{
						postPagingDefer.resolve(jsonldBody);
					}
					
				} else{
					postPagingDefer.resolve(jsonldBody);
				}
				
				postPagingDefer.promise.then(function(resPage) {
					if (serviceConfig['context'] !== undefined) {
						//do flatten and compacting jsonld
						promises = jsonld.promises;
						console.time("compactandcontext");
						promise = promises.compact(resPage, serviceConfig['context']);
						promise.then(function(compacted) {
							console.timeEnd("compactandcontext");
							res.end(JSON.stringify(compacted));
							return;
						}, function(err) {
							throw err;
						});
					} else {
						res.end(JSON.stringify(resPage));
						return;
					}
				})
			})
		} catch (err) {
			errorStatus.message = err.message;
			res.end(JSON.stringify(errorStatus));
			return;
		}
	} catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
}

//pre defined custom function
function CustomQuery() {

}

CustomQuery.prototype.listCustom = function(config, param, query) {
	if (param['vis'] == undefined) {
		throw Error("parameter vis is missing");
	}
	condition = " VALUES ( ";
	values = "{ ( ";
	condition += " ?vis ";
	values += " \"" + param['vis'] + "\" ";
	if (param['creator'] !== undefined) {
		condition += " ?cre ";
		values += " \"" + param['creator'] + "\" ";
	}
	if (param['group'] !== undefined) {
		condition += " ?group ";
		values += " \"" + param['group'] + "\" ";
	}
	condition += " ) "
	values += " ) }"
	return query + condition + values + " }"
}

//SqlParser class
//class to parse sql query and replace particular tags with given parameters set
function SqlParser(rdfSql, params, config) {
	this.beginTag = ':=';
	this.endTag = '=:';
	this.rdfSql = rdfSql;
	this.params = params;
	this.config = config;
}

SqlParser.prototype.tagit = function(myString) {
	return this.beginTag + myString + this.endTag;
}

SqlParser.prototype.getRdfSql = function() {
	return this.rdfSql;
}

SqlParser.prototype.replace = function() {
	self = this;
	Object.keys(this.params).forEach(function(key) {
		value = self.params[key];
		if (self.config[key] !== undefined) {
			transform = self.config[key]['transform'];
			self.rdfSql = self.rdfSql.replace(transform, value)
		}
	});

}

//PostCode class
//class to post request into virtuoso api
function PostCode(host, defaultGraphUrl, query, shouldSponge, format, timeout, debug) {
	this.host = host;
	this.defaultGraphUrl = defaultGraphUrl;
	this.query = query;
	this.shouldSponge = shouldSponge;
	this.format = format;
	this.timeout = timeout;
	this.debug = debug;
}

PostCode.prototype.postQuery = function() {
	// Build the post string from an object
	post_data = querystring.stringify({
		'default-graph-uri': this.defaultGraphUrl,
		'query': this.query,
		'should-sponge': this.shouldSponge,
		'format': this.format,
		'timeout': this.debug
	});


	queryString = {
		'default-graph-uri': this.defaultGraphUrl,
		'query': this.query,
		//		'should-sponge': this.shouldSponge,
		'format': this.format,
		'timeout': this.timeout,
		'debug': this.debug
	}

	// An object of options to indicate where to post to

	post_options = {
		host: this.host,
		path: '/' + config.get('Read-Only_Endpoint.path'),
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	}

	get_options = {
		url: this.host + '/' + config.get('Read-Only_Endpoint.path'),
		qs: queryString,
	};

	// Synchronous get request
	localThenRequest = require('then-request');
	return localThenRequest('POST', this.host + config.get('Read-Only_Endpoint.path'), {
		qs: queryString
	});

}