/*
 * Canonical JSON serialization
 * Recursively sorts object keys alphabetically, arrays preserve order.
 * Sets window.canonicalJSON(obj) -> string
 */
(function (global) {
  'use strict';

  function canonicalJSON(obj) {
    if (obj === null) {
      return 'null';
    }
    if (obj === undefined) {
      return 'null';
    }
    if (typeof obj === 'boolean') {
      return obj ? 'true' : 'false';
    }
    if (typeof obj === 'number') {
      if (!isFinite(obj)) {
        return 'null';
      }
      return String(obj);
    }
    if (typeof obj === 'string') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      var items = [];
      for (var i = 0; i < obj.length; i++) {
        items.push(canonicalJSON(obj[i]));
      }
      return '[' + items.join(',') + ']';
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj).sort();
      var pairs = [];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        pairs.push(JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
      }
      return '{' + pairs.join(',') + '}';
    }
    return 'null';
  }

  global.canonicalJSON = canonicalJSON;

}(typeof window !== 'undefined' ? window : this));
