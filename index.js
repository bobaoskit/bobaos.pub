const BobaosSdk = require("./lib/bobaosSdk");
const IPC = require("./lib/ipc");

const config = require("./config");

// init logger

let start, end;
start = new Date();
console.log(start);
console.log("Starting bobaos.pub.");

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
    // let rawBuff = Buffer.from(data.raw, "base64");
    // raw is base64 encoded
    return {
      id: data.id,
      value: data.value,
      raw: data.raw
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

  ipc.on("ready", async _ => {
    end = new Date();
    console.log("IPC ready");
    console.log(`Ready to use. Started in: ${end - start}ms`);
    ipcReady = true;

    if (sdkReady) {
      await ipc.broadcast({ method: "sdk state", payload: "ready" });
    }
  });

  ipc.on("error", e => {
    console.log(`Error with ipc: ${e.message}`);
    ipcReady = false;
  });

  // debugger
  //   ipc.on("request", (req, res) => {
  //     console.log(`Incoming request: `);
  //     console.log(`method: ${req.method}`);
  //     console.log(`payload: ${JSON.stringify(req.payload)}`);
  //   });

  ipc.on("request", async (req, res) => {
    const processError = e => {
      res.method = "error";
      res.payload = e.message;
      console.log(e);
      return res.send();
    };

    if (req.method === "ping") {
      res.method = "success";
      res.payload = true;
      return res.send();
    }
    if (req.method === "get sdk state") {
      res.method = "success";
      res.payload = sdkReady ? "ready" : "stop";
      return res.send();
    }
    if (req.method === "reset") {
      try {
        await sdk.reset();
        res.method = "success";
        res.payload = null;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get description") {
      try {
        let result = await sdk.getDescription(req.payload);
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get value") {
      try {
        let result = await sdk.getValue(req.payload);
        res.method = "success";
        res.payload = _formatDatapointValue(result);
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get stored value") {
      try {
        let result = await sdk.getStoredValue(req.payload);
        res.method = "success";
        res.payload = _formatDatapointValue(result);
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "set value") {
      try {
        let result = await sdk.setValue(req.payload);
        res.method = "success";
        res.payload = _formatDatapointValue(result);
        ipc.broadcast({ method: "datapoint value", payload: _formatDatapointValue(result) });
        return res.send();
        // TODO: broadcast changed values
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "read value") {
      try {
        let result = await sdk.readValue(req.payload);
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get server item") {
      try {
        let result = await sdk.getServerItem(req.payload);
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "set programming mode") {
      try {
        let result = await sdk.setProgrammingMode(req.payload);
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get programming mode") {
      try {
        let result = await sdk.getProgrammingMode();
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }
    if (req.method === "get parameter byte") {
      try {
        let result = await sdk.getParameterByte(req.payload);
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }

    if (req.method === "poll values") {
      try {
        console.log("poll values start");
        let result = await sdk.pollValues();
        console.log("poll valuess success");
        res.method = "success";
        res.payload = result;
        return res.send();
      } catch (e) {
        return processError(e);
      }
    }

    return processError(new Error("Unknown method"));
  });
};
