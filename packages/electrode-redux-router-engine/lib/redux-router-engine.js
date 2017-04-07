"use strict";

/* eslint-disable max-params,indent,global-require */

const assert = require("assert");
const optionalRequire = require("optional-require")(require);
const Promise = optionalRequire("bluebird", { message: false, default: global.Promise });
const React = optionalRequire("react");
const ReactDomServer = optionalRequire("react-dom/server");
const ReactRouter = require("react-router");
const Provider = require("react-redux").Provider;
const Path = require("path");

class ReduxRouterEngine {
  constructor(options) {
    assert(options.routes, "Must provide react-router routes for redux-router-engine");
    assert(options.createReduxStore, "Must provide createReduxStore for redux-router-engine");

    this.options = options;

    this.options.withIds = !!options.withIds;

    if (!options.stringifyPreloadedState) {
      this.options.stringifyPreloadedState =
        (state) => `window.__PRELOADED_STATE__ = ${JSON.stringify(state)};`;
    }

    if (!this.options.logError) {
      this.options.logError = (req, err) =>
        console.log("Electrode ReduxRouterEngine Error:", err); //eslint-disable-line
    }

    if (this.options.renderToString) {
      this._renderToString = this.options.renderToString;
    }

    if (!this.options.routesHandlerPath) {
      // Default for Electrode app
      this.options.routesHandlerPath = Path.join(process.env.APP_SRC_DIR || "", "server/routes");
    }

    this.options.routesHandlerPath = Path.resolve(this.options.routesHandlerPath);

    this._handlers = {};
    
    if (!options.sheetsToString) {
      this.options.sheetsToString = (req) => '';
    }
  }

  render(req, options) {
    const location = req.path || (req.url && req.url.path);

    return this._matchRoute({ routes: this.options.routes, location })
      .then((match) => {
        if (match.redirectLocation) {
          return {
            status: 302,
            path: `${match.redirectLocation.pathname}${match.redirectLocation.search}`
          };
        }

        if (!match.renderProps) {
          return {
            status: 404,
            message: `redux-router-engine: Path ${location} not found`
          };
        }
        const routes = match.renderProps.routes;
        const route = routes[routes.length - 1];
        const methods = route.methods || "get";

        if (methods.toLowerCase().indexOf(req.method.toLowerCase()) < 0) {
          throw new Error(
            `redux-router-engine: ${location} doesn't allow request method ${req.method}`);
        }

        return this._handleRender(req, match, route, options || {});
      })
      .catch((err) => {
        this.options.logError.call(this, req, err);
        return {
          status: err.status || 500, // eslint-disable-line
          message: err.message,
          path: err.path,
          _err: err
        };
      });
  }

  //
  // options: { routes, location: url_path }
  //
  _matchRoute(options) {
    return new Promise((resolve, reject) => {
      ReactRouter.match(options, (err, redirectLocation, renderProps) => {
        if (err) {
          reject(err);
        } else {
          resolve({ redirectLocation, renderProps });
        }
      });
    });
  }

  _handleRender(req, match, route, options) {
    const withIds = options.withIds !== undefined ? options.withIds : this.options.withIds;
    const stringifyPreloadedState =
      options.stringifyPreloadedState || this.options.stringifyPreloadedState;
    const sheetsToString =
      options.sheetsToString || this.options.sheetsToString;

    return this._getReduxStoreInitializer(route, options).call(this, req, match)
      .then((store) => {
        return {
          status: 200,
          html: this._renderToString(req, store, match, withIds),
          prefetch: stringifyPreloadedState(store.getState()),
          css: sheetsToString(req)
        };
      });
  }

  _renderToString(req, store, match, withIds) { // eslint-disable-line
    if (req.app && req.app.disableSSR) {
      return "";
    } else {
      assert(React, "Can't do SSR because React module is not available");
      assert(ReactDomServer, "Can't do SSR because ReactDomServer module is not available");
      return (withIds ? ReactDomServer.renderToString : ReactDomServer.renderToStaticMarkup)(
        React.createElement(
          Provider, { store },
          React.createElement(ReactRouter.RouterContext, match.renderProps)
        )
      );
    }
  }

  _getReduxStoreInitializer(route, options) {
    let h = this._handlers[route.path];
    if (h) {
      return h;
    }

    switch (route.init) {
      case undefined:
        h = options.createReduxStore || this.options.createReduxStore;
        break;
      case true:
        h = require(Path.join(this.options.routesHandlerPath, route.path));
        break;
      default:
        assert(typeof route.init === "string", "route init prop must be a string");
        h = require(Path.join(this.options.routesHandlerPath, route.init));
        break;
    }

    this._handlers[route.path] = h;

    return h;
  }

}

module.exports = ReduxRouterEngine;
