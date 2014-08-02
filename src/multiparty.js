/* Upload API module */

"use strict";

var $Q = require('q');
var debug = require('nor-debug');
var multiparty = require('multiparty');

/** Promise Multiparty Implementation */
module.exports = function do_multiparty_form_parse(req) {
	var defer = $Q.defer();
	try {
		var form = new multiparty.Form();
		form.parse(req, function(err, fields, files) {
			try {
				if(err) {
					defer.reject(err);
					return;
				}
				defer.resolve({"fields": fields, "files": files});
			} catch(e) {
				defer.reject(e);
			}
		});
	} catch(err) {
		defer.reject(err);
	}
	return defer.promise;
};

/* EOF */
