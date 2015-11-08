/** Upload API module */

"use strict";

var $Q = require('q');
var NoPg = require('nor-nopg');
var debug = require('nor-debug');
var copy = require('nor-data').copy;
var is = require('nor-is');
var fs = require('nor-fs');
var ref = require('nor-ref');
var multiparty = require('./multiparty.js');
var helpers = require('nor-api-helpers');
var easyimage = require('easyimage');
var ARRAY = require('nor-array');
var FUNCTION = require('nor-function');

/** Returns nor-express based upload resource
 * @fixme Implement param opts.path to change the default /api/upload
 * @param opts.pg {string} The PostgreSQL configuration string for NoPG
 * @param opts.upload_type {string} Optional. The NoPG object type as string for file uploads.
 * @param opts.views.upload {object} The view object for upload resources
 * @param opts.views.attachment {object} The view object for attachment resources
 * @param opts.image {boolean} Enable image features. Tries to get meta information about the uploaded file using easyimage module.
 * @param opts.resize {object} Enable image resizing. This will also turn on `opts.image`.
 * @param opts.resize.w {number} Optional. Resize to spesific width.
 * @param opts.resize.h {number} Optional. Resize to spesific height.
 */
module.exports = function upload_builder(opts) {
	opts = opts || {};
	debug.assert(opts).is('object');

	debug.assert(opts.views).ignore(undefined).is('object');

	if(!is.obj(opts.views)) {
		opts.views = {};
	}

	debug.assert(opts.views.upload).is('object');
	debug.assert(opts.views.attachment).is('object');
	debug.assert(opts.pg).is('string');

	if(!opts.upload_type) {
		opts.upload_type = "Upload";
	}

	debug.assert(opts.upload_type).is('string');

	debug.assert(opts.image).ignore(undefined).is('boolean');

	debug.assert(opts.resize).ignore(undefined).is('object');
	opts.resize = copy(opts.resize);

	if(is.obj(opts.resize)) {
		opts.image = true;

		debug.assert(opts.resize.w).ignore(undefined).is('number');
		debug.assert(opts.resize.h).ignore(undefined).is('number');

		if( is.undef(opts.resize.w) && is.undef(opts.resize.h) ) {
			delete opts.resize;
		}
	}

	// 
	var routes = {};

	/** Returns user's uploaded files 
	 * 
	 */
	routes.GET = function upload_get(req, res) {

		var params = ["OR"];
		if(req.user && req.user.$id) {
			params.push({'user': req.user.$id});
		} else {
			throw new TypeError("No user data!");
		}

		return $Q(NoPg.start(opts.pg).search(opts.upload_type, {"fields":["$id", '$type', "$created", "user"]})(params).commit().then(function(db) {
			var upload = db.fetch();
			return opts.views.upload.collection(req, res)(upload);
		}));
	};

	/** Upload new file to the system */
	routes.POST = function upload_post(req, res) {
		return multiparty(req).then(function(result) {

			//debug.log("fields = ", result.fields);
			//debug.log("files = ", result.files);

			debug.assert(result).is('object');
			debug.assert(result.files).is('object');

			var enabled_names = ['image', 'background'];

			var files = [];

			// Enable file names
			ARRAY(enabled_names).forEach(function(name) {
				if(is.array(result.files[name])) {
					FUNCTION(files.push).apply(files, result.files[name]);
				}
			});

			debug.assert(files).is('array').prop('length').is('number').range(1);

			var data = {};
			if(req.user && req.user.$id) {
				data.user = req.user.$id;
			}

			return $Q.fcall(function() {

				/* Get basic information about the original uploaded image */
				if( opts.image ) {
					return ARRAY(files).map(function(file) {
						debug.assert(file).is('object');
						debug.assert(file.path).is('string');

						return function step() {
							return easyimage.info(file.path).then(function(data) {
								//debug.log('info = ', data);
								debug.assert(data).is('object');
								file.orig_info = data;
							});
						};
					}).reduce($Q.when, $Q());
				}

			}).then(function() {

				/* Optionally resize uploaded images */
				//debug.log('opts.resize = ', opts.resize);
				if( is.obj(opts.resize) && (is.defined(opts.resize.w) || is.defined(opts.resize.h)) ) {

					return ARRAY(files).map(function(file) {
						debug.assert(file).is('object');
						debug.assert(file.path).is('string');

						return function step() {
							file.path_orig = file.path + '.orig';
							return fs.rename(file.path, file.path_orig).then(function() {
								var resize_opts = {
									'src': file.path_orig,
									'dst': file.path
								};

								if(opts.resize.w) { resize_opts.width = opts.resize.w; }
								if(opts.resize.h) { resize_opts.height = opts.resize.h; }

								if( (!resize_opts.width) && resize_opts.height && file.orig_info && file.orig_info.width && file.orig_info.height ) {
									resize_opts.width = Math.round( file.orig_info.width * resize_opts.height / file.orig_info.height );
								}

								if( (!resize_opts.height) && resize_opts.width && file.orig_info && file.orig_info.width && file.orig_info.height ) {
									resize_opts.height = Math.round( file.orig_info.height * resize_opts.width / file.orig_info.width );
								}

								//debug.log("resize_opts = ", resize_opts);

								return easyimage.resize(resize_opts);
							});
						};
					}).reduce($Q.when, $Q());
				}

			}).then(function() {

				/* Get basic information about the possibly resized image files */
				if( opts.image ) {
					return ARRAY(files).map(function(file) {
						debug.assert(file).is('object');
						debug.assert(file.path).is('string');
						return function step() {
							return easyimage.info(file.path).then(function(data) {
								//debug.log('info = ', data);
								debug.assert(data).is('object');
								file.info = data;
							});
						};
					}).reduce($Q.when, $Q());
				}

			}).then(function() {

				/* Create upload resource in the database */
				return $Q(NoPg.start(opts.pg)
				  .create(opts.upload_type)(data)
				  .then(function(db) {
					var item = db.fetch();
					debug.assert(item).is('object');

					/* Save files as an attachment in to the database */
					return ARRAY(files).map(function(file) {
						debug.assert(file).is('object');
						debug.assert(file.path).is('string');

						if(file.ws) {
							delete file.ws;
						}

						var meta = {
							'name': file.originalFilename,
							'content-type': file.headers['content-type'] || 'application/octet-stream',
							'original': file,
							'info': is.obj(file.info) ? file.info : {}
						};

						return function step() {
							return db.createAttachment(item)( file.path, meta);
						};
					}).reduce($Q.when, $Q()).then(function() {

						/* Commit changes */

						return db.commit();

					/* Redirect the user to the upload resource */
					}).then(function() {
						res.redirect(303, ref(req, 'api/upload', item.$id));

					/* Handle errors */
					}).fail(function(err) {
						debug.error('Rolling back because of ', err);
						return db.rollback().then(function() {
							return $Q.reject(err);
						}).fail(function(e) {
							debug.error('Rollback failed: ', e);
							return $Q.reject(err);
						});
					});

				})); // End of return $Q(NoPg.start(opts.pg) ...

			}); // End of return $Q.fcall(function() {

		}); // End of return multiparty(req).then(function(result) { ...
	}; // End of routes.POST = function(req, res) {

	/** Root of single upload routes */
	routes[':uuid'] = {};

	/** Get single upload data */
	routes[':uuid'].GET = function(req, res) {
		var uuid = helpers.get_param(req, 'uuid');
		var upload;
		return $Q(NoPg.start(opts.pg).search(opts.upload_type)({'$id': uuid}, {"fields": ["$id", '$type', "$created"]}).then(function(db) {
			var files = db.fetch();
			debug.assert(files).is('array').length(1);
			upload = files.shift();
			debug.assert(upload).is('object');
			return db.searchAttachments(upload)(undefined, {"fields":["$id", "$created", "content-type", "info"]}).commit();
		  }).then(function(db) {
			var attachments = db.fetch();
			debug.assert(attachments).is('array').prop('length').range(1);

			var results = [];

			return ARRAY(attachments).map(function(a) {
				return function step() {
					a.body = {
						$ref: ref(req, 'api/upload', upload.$id, 'attachments', a.$id, 'body'),
						'content-type': a['content-type'] || 'application/octet-stream'
					};
					//debug.log('attachment = ', a);
					return $Q.when(opts.views.attachment.element(req, res, {
						"path": ['api/upload', upload.$id, 'attachments']
					})(a)).then(function(result) {
						results.push(result);
					});
				};
			}).reduce($Q.when, $Q()).then(function() {
				return results;
			});

		}).then(function(attachments) {
			debug.assert(attachments).is('array').prop('length').range(1);

			upload.attachments = attachments;

			//debug.log('upload = ', upload);

			return opts.views.upload.element(req, res)(upload);
		}));
	};

	/** Root of single upload routes */
	routes[':uuid'].attachments = {};
	routes[':uuid'].attachments[':uuid2'] = {};
	routes[':uuid'].attachments[':uuid2'].body = {};
	routes[':uuid'].attachments.first = {};
	routes[':uuid'].attachments.first.body = {};

	/** Get single upload data */
	routes[':uuid'].attachments[':uuid2'].body.GET = function(req, res) {

		var upload_uuid = helpers.get_param(req, 'uuid');
		var attachment_uuid = helpers.get_param(req, 'uuid2');

		//debug.log('upload_uuid =', upload_uuid);
		//debug.log('attachment_uuid =', attachment_uuid);

		debug.assert(upload_uuid).typeOf('string');
		debug.assert(attachment_uuid).typeOf('string');

		var body;

		return $Q(NoPg.start(opts.pg)
		  .search(opts.upload_type)({'$id': upload_uuid}, {'fields':['$id', '$type', '$created', 'user']}).then(function(db) {
			var files = db.fetch();
			debug.assert(files).typeOf('object').instanceOf(Array);
			if(files.length !== 1) {
				throw new TypeError("Too much or few upload records: ", files.length);
			}

			body = files.shift();
			debug.assert(body).typeOf('object');
			return db.searchAttachments(body)({'$id': attachment_uuid }).commit();
		  }).then(function(db) {
			var attachments = db.fetch();

			if(attachments.length !== 1) {
				throw new TypeError("Too much or few upload records: ", attachments.length);
			}

			var a = attachments.shift();
			debug.assert(a).typeOf('object');
			var buffer = a.getBuffer();
			debug.assert(buffer).typeOf('object').instanceOf(Buffer);
			var content_type = a['content-type'] || 'application/octet-stream';
			//debug.log('content_type = ', content_type);

			res.writeHead(200, {'Content-Type': content_type});
			res.write(buffer);
			res.end();

		}));

	};

	/** Get single upload data */
	routes[':uuid'].attachments.first.body.GET = function(req, res) {
		var upload_uuid = helpers.get_param(req, 'uuid');
		debug.assert(upload_uuid).typeOf('string');
		var body;
		return $Q(NoPg.start(opts.pg)
		  .search(opts.upload_type)({'$id': upload_uuid}, {'fields':['$id', '$type', '$created', 'user']}).then(function(db) {
			var files = db.fetch();
			debug.assert(files).typeOf('object').instanceOf(Array);
			if(files.length !== 1) {
				throw new TypeError("Too much or few upload records: ", files.length);
			}

			body = files.shift();
			debug.assert(body).typeOf('object');

			return db.searchAttachments(body)(undefined, {
				'order': ['$created'],
				'limit':1
			}).commit();
		  }).then(function(db) {
			var attachments = db.fetch();
			if(attachments.length !== 1) {
				throw new TypeError("Too much or few upload records: ", attachments.length);
			}
			var a = attachments.shift();
			debug.assert(a).typeOf('object');
			var buffer = a.getBuffer();
			debug.assert(buffer).typeOf('object').instanceOf(Buffer);
			var content_type = a['content-type'] || 'application/octet-stream';
			res.writeHead(200, {'Content-Type': content_type});
			res.write(buffer);
			res.end();

		}));

	};

	// Returns the resource
	return routes;
}; // End of upload_builder

/* EOF */
