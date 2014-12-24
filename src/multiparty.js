/* Upload API module */

"use strict";

var $Q = require('q');
//var debug = require('nor-debug');
var multiparty = require('multiparty');

/** */
function do_multiparty_form_parse_form_parse(defer, err, fields, files) {
	if(err) {
		defer.reject(err);
		return;
	}
	defer.resolve({"fields": fields, "files": files});
}

/** */
function do_multiparty_form_parse_(defer, req) {
	var form = new multiparty.Form();
	form.parse(req, function do_multiparty_form_parse_2(err, fields, files) {
		try {
			do_multiparty_form_parse_form_parse(defer, err, fields, files);
		} catch(e) {
			defer.reject(e);
		}
	});
}

/** Promise Multiparty Implementation */
module.exports = function do_multiparty_form_parse(req) {
	var defer = $Q.defer();
	try {
		do_multiparty_form_parse_(defer, req);
	} catch(err) {
		defer.reject(err);
	}
	return defer.promise;
};

/* EOF */
