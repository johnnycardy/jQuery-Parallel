/*
 * jQuery Parallel v0.2 plugin for jQuery.
 *
 * Allows easy use of Web Workers by wrapping them in a Deferred object.
 *
 * Copyright (c) 2011 Jonathan Cardy
 * Licensed under the MIT licenses.
 */

/* Tell jslint not to complain about the Function constructor. This is a valid use case.  */
/*jslint nomen: false, evil: true */
/*global window: false, jQuery: false, Worker: false, self: false, setTimeout: false */
 
/*
 * This plugin doubles up as the worker and executes different code. It needs to reference itself for this purpose.
 * NOTE!! when you minify this file, or rename it for whatever reason, this string needs to be updated in it.
 */
var currentFilename = "jquery.work.js"; 
 
/*
 * This is the Web Worker code. It is only executed when we are in the Web Worker context (ie. when Window is not defined).
 * The first thing it does is check whether jQuery is defined. This means the plugin code doesn't get run in the Worker context.
 */
if (typeof window === "undefined") {

	//A message event starts the worker.
	self.addEventListener('message', function (event) {
		//Get the action from the string-encoded arguments
		var action = self._getFunc(event.data.action);
		
		//Execute the newly-defined action and post result back to the callee
		var result = action(event.data.args, self);
		
		self._postResult(result);
	}, false);
	
	//Posts a progress object back to the UI thread
	self.notify = function (obj) {
		obj = obj || {};
		self.postMessage({notify: obj});
	};
	
	//Notify the UI thread that the worker function is complete
	self.complete = function (obj) {
		obj = obj || {};
		self.postMessage({complete: obj});
	};
	
	//Dummy function - in IE, when a function is run in a UI thread, this sets a timeout to allow UI messages.
	//In a real Web Worker, no timeout is set as it isn't needed.
	self.timeout = function (func, t) {
		func();
	};
	
	//Posts a result object back the UI thread
	self._postResult = function (result) {
		result = result || {};
		self.postMessage({result: result});
	};

	//Gets a Function given an input function string.
	self._getFunc = function (funcStr) {
		//Get the names of the arguments, between the first '(' and the first ')'.
		var argNames = funcStr.substring(funcStr.indexOf("(") + 1, funcStr.indexOf(")")).split(",");

		//Now get the function body - between the first '{' and the last '}'.
		funcStr = funcStr.substring(funcStr.indexOf("{") + 1, funcStr.lastIndexOf("}"));

		//Construct the new Function
		return new Function(argNames, funcStr);
	};
}
 
/*
 * This is the actual plugin.
 * The first thing it does is check whether jQuery is defined. This means the plugin code doesn't get run in the Worker context.
 */
if (typeof jQuery !== "undefined") {
	(function ($) {
		//Make sure the correct version of jQuery is loaded - must support Deferred.
		if (!$.Deferred) {
			throw "This plugin uses Deferred objects and jQuery >= 1.5 must be loaded.";
		}
		
		//Add a static function to the jQuery object.
		$.work = function (action, args, options) {
			var promise, 
				def = $.Deferred(), 
				callbacks = [], 
				notifications = [], 
				wrappedDef = {
					//This is an extended deferred object, that contains the additional function "notify"
					//that can be used to provide feedback to the UI thread in a long-running background operation.
					notify: function (obj) {
						var i;
						for (i = 0; i < callbacks.length; i++) {
							callbacks[i].call(this, obj);
						}
						notifications.push(obj);
					}
				};
			
			//extend the specialised deferred object with the original one.
			$.extend(def, wrappedDef);
			
			//Add the complete function that allows a background function to explicitly resolve the Deferred object.
			def.complete = function(obj) {
				def.resolve(obj);
			};
			
			//Apply default values to the options object. At the moment the only option is "debug" is supported.
			options = options || {};
			$.extend({ debug: false, awaitComplete: false }, options);
		
			//If workers are supported then construct a new Worker using the current filename.
			if (window.Worker && !options.debug) {
			
				//Make sure we are accessing via HTTP
				if (window.location.protocol === "file:") {
					throw "Web Workers only support access via HTTP.";
				}
			
				var worker = new Worker(currentFilename);
				worker.addEventListener('message', function (event) { 
					
					//If the message is a progress object, report it
					if (event.data.notify) {
						def.notify(event.data.notify);
					} else if (event.data.result) {
						//If it's the end result, resolve the Deferred object, but only if awaitDone is false.
						//awaitDone signals that the function has an asynchronous element that means it must manually
						//call the .complete function on the worker.
						if (!options.awaitComplete) {
							def.resolve(event.data.result);
						}
					} else if (event.data.complete) {
						//When the worker wants to explicitly notify that it is complete, then it calls
						//the .complete function on the worker. This results in the deferred object being deferred here.
						def.complete(event.data.complete);
					}
					
				}, false);
				worker.addEventListener('error', function (event) { 
					//Reject the Deferred object on worker error
					def.reject(event);
				}, false);
				
				//Start the worker by posting a message to it
				worker.postMessage({
					action: action.toString(),
					args: args
				});
			} else {
				//If the browser doesn't support workers then execute synchronously.
				setTimeout(function () {
					try {
						var result = action(args, {
							notify: function(obj) {
								def.notify(obj);
							},
							complete: function(obj) {
								def.complete(obj);
							},
							timeout: function(func, t) {
								//Actually do a setTimeout for older browsers (and IE)
								setTimeout(function(){
									func();
								}, t);
							}
						});
						if (!options.awaitComplete) {
							def.resolve(result);
						}
					} catch (e) {
						def.reject(e);
					}
				}, 0);
			}
			
			//Get the promise to do this work at some point
			promise = def.promise();
			
			//Add the progress function to the promise object
			promise.progress = function (callback) {
				var n;
				callbacks.push(callback);
				for (n = 0; n < notifications.length; n++) {
					//If there are notifications pending, call the callback immediately with them.
					callback.call(promise, notifications[n]);
				}
				//Return itself to maintian chainability
				return promise;
			};
			
			return promise; 
		};
	}(jQuery));
}