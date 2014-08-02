/** Upload API module */

"use strict";

var $Q = require('q');
var NoPg = require('nor-nopg');
var debug = require('nor-debug');
var is = require('nor-is');
var ref = require('nor-ref');
var multiparty = require('./multiparty.js');
var helpers = require('nor-api-helpers');

/** Returns nor-express based upload resource
 * @param opts.pg {string} The PostgreSQL configuration string for NoPG
 * @param opts.views.upload {object} The view object for upload resources
 * @param opts.views.attachment {object} The view object for attachment resources
 */
var upload_builder = module.exports = function upload_builder(opts) {
	opts = opts || {};

	debug.assert(opts.views).ignore(undefined).is('object');
	if(!is.obj(opts.views)) {
		opts.views = {};
	}

	debug.assert(opts.views.upload).is('object');
	debug.assert(opts.views.attachment).is('object');

	debug.assert(opts.pg).is('string');

	var routes = {};

	/** Returns user's uploaded files */
	routes.GET = function(req, res) {

		var params = ["OR"];
		if(req.user && req.user.$id) {
			params.push({'user': req.user.$id});
		} else {
			throw new TypeError("No user data!");
		}

		return $Q(NoPg.start(opts.pg).search("Upload", {"fields":["$id", '$type', "$created", "user"]})(params).commit().then(function(db) {
			var upload = db.fetch();
			return opts.views.upload.collection(req, res)(upload);
		}));
	};

	/** Upload new file to the system */
	routes.POST = function(req, res) {
		return multiparty(req).then(function(result) {

			//debug.log("fields = ", result.fields);
			//debug.log("files = ", result.files);

			debug.assert(result).is('object');
			debug.assert(result.files).is('object');

			var files;

			// Enable file name: image
			if(result.files.image) {
				files = result.files.image;
			}

			// Enable file name: background
			if(result.files.background) {
				files = result.files.background;
			}

			debug.assert(files).is('array');

			var data = {};
			if(req.user && req.user.$id) {
				data.user = req.user.$id;
			}

			////debug.log('req.user =', req.user);
			//debug.log('data =', data);

			return $Q(NoPg.start(opts.pg)
			  .create("Upload")(data)
			  .then(function(db) {
				var item = db.fetch();
				debug.assert(item).is('object');

				// FIXME: Save files as an attachment
				var promises = [];
				files.forEach(function(file) {
					//debug.log('file = ', file);
					debug.assert(file).is('object');
					debug.assert(file.path).is('string');

					if(file.ws) {
						delete file.ws;
					}

					var meta = {
						'name': file.originalFilename,
						'content-type': file.headers['content-type'] || 'application/octet-stream',
						'original': file
					};
					promises.push( $Q(db.createAttachment(item)( file.path, meta)) );
				});
				
				return $Q.all(promises).then(function() {
					return db.commit();
				}).then(function() {
					res.redirect(303, ref(req, 'api/upload', item.$id));
				}).fail(function(err) {
					debug.error('Rolling back because of ', err);
					db.rollback().fail(function(e) {
						debug.error('Rollback failed: ', e);
					}).done();
					throw err;
				});
			}));
		});
	};

	/** Root of single upload routes */
	routes[':uuid'] = {};

	/** Get single upload data */
	routes[':uuid'].GET = function(req, res) {
		var uuid = helpers.get_param(req, 'uuid');
	
		var upload;
	
		return $Q(NoPg.start(opts.pg)
		  .search("Upload")({'$id': uuid}, {"fields": ["$id", '$type', "$created"]}).then(function(db) {
			var files = db.fetch();
			debug.assert(files).typeOf('object').instanceOf(Array);
			if(files.length !== 1) {
				throw new TypeError("Too much or few upload records: ", files.length);
			}	

			upload = files.shift();
			debug.assert(upload).typeOf('object');
			return db.searchAttachments(upload)(undefined, {"fields":["$id", "$created", "content-type"]}).commit();
		  }).then(function(db) {
			var attachments = db.fetch();
	
			upload.attachments = attachments.map(function(a) {
				a.body = {
					$ref: ref(req, 'api/upload', upload.$id, 'attachments', a.$id, 'body'),
					'content-type': a['content-type'] || 'application/octet-stream'
				};
				return opts.views.attachment.element(req, res, {
					"path": ['api/upload', upload.$id, 'attachments']
				})(a);
			});

			return opts.views.upload.element(req, res)(upload);
		}));
	};

	/** Root of single upload routes */
	routes[':uuid'].attachments = {};
	routes[':uuid'].attachments[':uuid2'] = {};
	routes[':uuid'].attachments[':uuid2'].body = {};

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
		  .search("Upload")({'$id': upload_uuid}, {'fields':['$id', '$type', '$created', 'user']}).then(function(db) {
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

	// Returns the resource
	return routes;
}; // End of upload_builder

/* EOF */
