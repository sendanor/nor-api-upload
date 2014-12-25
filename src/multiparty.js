/* Upload API module */

"use strict";

var $Q = require('q');
var multiparty = require('multiparty');

/** */
function do_multiparty_form_parse_(req) {
	var defer = $Q.defer();

	function do_multiparty_form_parse_2(err, fields, files) {
		if(err) {
			defer.reject(err);
			return;
		}
		defer.resolve({"fields": fields, "files": files});
	}

	var form = new multiparty.Form();
	form.parse(req, do_multiparty_form_parse_2);
	return defer.promise;
}

/** Promise Multiparty Implementation */
module.exports = function do_multiparty_form_parse(req) {
	return $Q.fcall(function() {
		return do_multiparty_form_parse_(req);
	});
};

/* EOF */
