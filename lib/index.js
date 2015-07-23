var Module = require('module');
var join = require('path').join;
var debug = require('debug')('injective');

module.exports = exports = Injective;

var injectiveProp = '_injective';
var typeProp = 'type';
var depsProp = 'deps';
var singletonProp = 'singleton';
var injectProp = 'inject';
var injectedProp = 'injected';

function Injective(config, cache) {
    this._config = config || {
        paths: {}
    };
    this._cache = cache || {};
}

Injective.isInjectable = function(module) {
    return injectProp in module && typeof module[injectProp] === 'function';
};

Injective.isInstantiable = function(module) {
    return typeProp in module;
};

Injective.install = function(config) {
    Module._extensions['.js'] = function(func, module, filename) {
        module[injectiveProp] = Injective[injectiveProp];
        func(module, filename);
        if (Injective.isInjectable(module)) {
            Injective[injectiveProp]._inject(module, filename);
        }
    }.bind(Module, require.extensions['.js']);
    Injective[injectiveProp] = new Injective(config);
    return Injective[injectiveProp];
};

Injective.prototype.create = function() {
    debug('Creating new context');
    Injective[injectiveProp] = new Injective(this._config, Object.create(this._cache));
    return Injective[injectiveProp];
};

Injective.prototype.define = function(id, obj) {
    debug('Defining instance for ' + id);
    this._cache[id] = obj;
};

/**
 * (Array)
 * (String)
 * (Array, Function)
 * (String, Function)
 */
Injective.prototype.require = function(module, deps, callback) {
    var self = this;
    Injective[injectiveProp] = this;
    deps = Array.isArray(deps) ? deps : [deps];
    var resolvedDeps = deps.map(function(dep) {
        return self._load(module, dep);
    });

    if (typeof callback === 'function') {
        return callback.apply(null, resolvedDeps);
    }
};

// upgrade path if necessary
Injective.prototype._resolvePath = function(path) {
    if (path in this._config.paths) {
        path = this._config.paths[path];
    }

    if (path[0] === '/') {
        path = join(process.cwd(), path);
    }

    return path;
};

Injective.prototype._inject = function(module, filename) {
    var self = this;
    debug('Injecting dependency into ' + filename);
    var injectDeps = depsProp in module[injectProp] ? module[injectProp][depsProp].map(function(dep) {
        return self._load(module, dep);
    }) : [];
    module[injectProp].apply(module, injectDeps);
    module[injectedProp] = true;
    return module.exports;
};

/**
 * Inject dependency and/or create (singleton) instance
 */
Injective.prototype._instantiate = function(module, filename) {
    debug('Creating new instance for ' + filename);
    var self = this;
    var deps = depsProp in module ? module[depsProp].map(function(dep) {
        return self._load(module, dep);
    }) : [];
    var instance;
    var type = module[typeProp];

    switch (type) {
        case 'factory':
            instance = module.exports.apply(module.exports, deps);
            break;
        case 'service':
            instance = new(Function.prototype.bind.apply(module.exports, [null].concat(deps)));
            break;
        default:
            throw new Error('Unknown type ' + type + ' defined in ' + filename);
    }

    if (module[singletonProp]) {
        this.define(filename, instance);
    }

    return instance;
};

/**
 * Turn require id and its dependencies into instance
 * path path of dep
 * module the module that requiring the dep
 */
Injective.prototype._load = function(module, path) {
    debug('Loading ' + path + ' from module ' + module.id);

    // user-defined object
    if (path in this._cache) {
        debug('Pre-defined instance exists, using cache: ' + path);
        return this._cache[path];
    }

    var filename = Module._resolveFilename(this._resolvePath(path), module);

    debug('Resolved ' + path + ' -> ' + filename);

    // singleton
    if (filename in this._cache) {
        debug('Instance exists, using cache: ' + filename);
        return this._cache[filename];
    }

    // Make sure it is loaded by node and got injected
    var mod = module.require(filename);
    var cachedModule = Module._cache[filename];

    // non-singleton
    if (Injective.isInstantiable(cachedModule)) {
        return this._instantiate(cachedModule, filename);
    }

    debug('Rely on native require() to load: ' + filename);

    return mod;
};