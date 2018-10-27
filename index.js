const BobaosSdk = require("./lib/bobaosSdk");
const IPC = require("./lib/ipc");

const config = require("./config");

// init logger

console.log("Starting bobaos.pub");

let ipc;
let ipcReady = false;

// TODO: params => { self = new EE(); return self; }

let sdk = BobaosSdk();
let sdkReady = false;

let onSdkReady = async _ => {
  console.log("sdk ready");

  sdkReady = true;
  if (ipcReady) {
    await ipc.broadcast({ method: "sdk state", payload: "ready" });
  } else {
    initIPC();
    setTimeout(onSdkReady, 5000);
  }
};
sdk.on("ready", async _ => {
  console.log("Connected to BAOS. SDK ready.");
  await onSdkReady();
});

let onSdkStop = async _ => {
  sdkReady = false;
  if (ipcReady) {
    await ipc.broadcast({ method: "sdk state", payload: "stop" });
  } else {
    setTimeout(onSdkStop, 5000);
  }
};
sdk.on("stop", async _ => {
  console.log("SDK has stopped");
  await onSdkStop();
});

sdk.on("datapoint value", async payload => {
  if (ipcReady) {
    await ipc.broadcast({ method: "datapoint value", payload: _formatDatapointValue(payload) });
  }
});

sdk.on("server item", async payload => {
  if (ipcReady) {
    await ipc.broadcast({ method: "server item", payload: payload });
  }
});

// format result.
// JSON.stringify(Buffer) returns {type: Buffer, value: []}
// but we want just array of bytes instead
const _formatDatapointValue = payload => {
  const _formatSingleValue = data => {
    return {
      id: (data.id),
      value: (data.value),
      raw: Array.prototype.slice.call(data.raw)
    };
  };
  if (Array.isArray(payload)) {
    return payload.map(_formatSingleValue);
  }

  return _formatSingleValue(payload);
};
const initIPC = _ => {
ipc = IPC();
ipcReady = false;
ipc.setMaxListeners(0);

ipc.on("ready", _ => {
  console.log("IPC ready");
  ipcReady = true;
});

ipc.on("error", e => {
  console.log(`Error with ipc: ${e.message}`);
  ipcReady = false;
});

// debugger
ipc.on("request", (req, res) => {
  console.log(`Incoming request: `);
  console.log(`method: ${req.method}`);
  console.log(`payload: ${JSON.stringify(req.payload)}`);
});

// ping
ipc.on("request", (req, res) => {
  if (req.method === "ping") {
    res.method = "success";
    res.payload = true;
    res.send();
  }
});

ipc.on("request", (req, res) => {
  if (req.method === "get sdk state") {
    res.method = "success";
    res.payload = sdkReady ? "ready" : "stop";
    res.send();
  }
});

ipc.on("request", async (req, res) => {
  if (req.method === "reset") {
    try {
      await sdk.reset();
      res.method = "success";
      res.payload = null;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
});


ipc.on("request", async (req, res) => {
  if (req.method === "get description") {
    try {
      let result = await sdk.getDescription(req.payload);
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "get value") {
    try {
      let result = await sdk.getValue(req.payload);
      res.method = "success";
      res.payload = _formatDatapointValue(result);
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "get stored value") {
    try {
      let result = await sdk.getStoredValue(req.payload);
      res.method = "success";
      res.payload = _formatDatapointValue(result);
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "set value") {
    try {
      let result = await sdk.setValue(req.payload);
      res.method = "success";
      res.payload = _formatDatapointValue(result);
      res.send();
      // TODO: broadcast changed values
      ipc.broadcast({ method: "datapoint value", payload: _formatDatapointValue(result) });
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "read value") {
    try {
      let result = await sdk.readValue(req.payload);
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "get server item") {
    try {
      let result = await sdk.getServerItem(req.payload);
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "set programming mode") {
    try {
      let result = await sdk.setProgrammingMode(req.payload);
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "get programming mode") {
    try {
      let result = (await sdk.getServerItem("ProgrammingMode")).value;
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
  if (req.method === "get parameter byte") {
    try {
      let result = await sdk.getParameterByte(req.payload);
      res.method = "success";
      res.payload = result;
      res.send();
    } catch (e) {
      res.method = "error";
      res.payload = e.message;
      res.send();
    }
  }
});

};
