(function () {
  function decode(memory, pointer) {
    var bytes = new Uint8Array(memory.buffer);
    var end = pointer;
    while (bytes[end]) end += 1;
    return new TextDecoder("utf-8").decode(bytes.subarray(pointer, end));
  }

  function encode(exports, value) {
    var bytes = new TextEncoder().encode(value);
    var pointer = exports.malloc(bytes.length + 1);
    var memory = new Uint8Array(exports.memory.buffer, pointer, bytes.length + 1);
    memory.set(bytes);
    memory[bytes.length] = 0;
    return pointer;
  }

  function cwrap(exports, name, returnType, argumentTypes) {
    return function () {
      var values = [];
      var allocated = [];
      for (var index = 0; index < arguments.length; index += 1) {
        if (argumentTypes[index] === "string") {
          var pointer = encode(exports, String(arguments[index]));
          allocated.push(pointer);
          values.push(pointer);
        } else values.push(arguments[index]);
      }
      var returned = exports[name].apply(null, values);
      for (var at = 0; at < allocated.length; at += 1) exports.free(allocated[at]);
      return returnType === "string" ? decode(exports.memory, returned) : returned;
    };
  }

  var imports = { env: {} };
  var names = [
    "__wasm_socket",
    "__wasm_setsockopt",
    "__wasm_bind",
    "__wasm_listen",
    "__wasm_close",
    "__wasm_poll",
    "__wasm_accept",
    "__wasm_recv",
    "__wasm_send",
  ];
  for (var index = 0; index < names.length; index += 1) imports.env[names[index]] = self[names[index]];

  fetch(new URL("./management-socket.wasm", self.location.href))
    .then(function (response) {
      if (!response.ok && response.status !== 0) throw new Error("management module unavailable");
      return response.arrayBuffer();
    })
    .then(function (bytes) { return WebAssembly.instantiate(bytes, imports); })
    .then(function (loaded) {
      var exports = loaded.instance.exports;
      exports._initialize();
      Module.cwrap = function (name, returnType, argumentTypes) {
        return cwrap(exports, name, returnType, argumentTypes);
      };
      Module.onRuntimeInitialized();
    })
    .catch(function (error) {
      Module.onAbort(error && error.message ? error.message : error);
    });
})();
