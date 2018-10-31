const EE = require("events");
const Redis = require("redis");
const Queue = require("bee-queue");
const config = require("../config.json");

let BobaosBQ = params => {
  let _params = {
    redis: null,
    request_channel: "bobaos_req",
    broadcast_channel: "bobaos_bcast"
  };

  let self = new EE();
  Object.assign(_params, params);
  const jqueue = new Queue(_params.request_channel,
    {
      redis: _params.redis,
      isWorker: false
    });

  let jobs = [];

  jqueue.on("job succeeded", (id, result) => {
    // TODO: try to find job in jobs
    const findById = t => t.id === id;
    let found = jobs.findIndex(findById);
    if (found > -1) {
      // TODO: resolve/reject
      let {method, payload} = result;
      if (method === "success") {
        jobs[found].callback(null, payload);
      }
      if (method === "error") {
        jobs[found].callback(new Error(payload));
      }
      jobs.splice(found, 1);
    }
  });

  // Never used?
  jqueue.on("job failed", (id, result) => {
    console.log(`Job ${id} failed with result: ${result}`);

  });

  self.commonRequest = (method, payload) => {
    return new Promise((resolve, reject) => {
      jqueue
        .createJob({method: method, payload: payload})
        .save()
        .then(job => {
          let {id} = job;
          let callback = (err, result) => {
            if (err) {
              return reject(err);
            }

            resolve(result);
          };
          jobs.push({id: id, callback: callback});
        })
        .catch(e => {
          reject(e);
        });
    });
  };

  // service
  self.ping = _ => {
    return self.commonRequest("ping", null);
  };
  self.getSdkState = _ => {
    return self.commonRequest("get sdk state", null);
  };
  self.reset = _ => {
    return self.commonRequest("reset", null);
  };

  // datapoints
  self.getDescription = payload => {
    return self.commonRequest("get description", payload);
  };
  self.getValue = payload => {
    return self.commonRequest("get value", payload);
  };
  self.getStoredValue = payload => {
    return self.commonRequest("get stored value", payload);
  };
  self.setValue = payload => {
    return self.commonRequest("set value", payload);
  };
  self.readValue = payload => {
    return self.commonRequest("read value", payload);
  };
  self.getServerItem = payload => {
    return self.commonRequest("get server item", payload);
  };
  self.setProgrammingMode = payload => {
    return self.commonRequest("set programming mode", payload);
  };
  self.getProgrammingMode = _ => {
    return self.commonRequest("get programming mode", null);
  };
  self.getParameterByte = payload => {
    return self.commonRequest("get parameter byte", payload);
  };

  // now events
  const redisSub = Redis.createClient(_params.redis);
  redisSub.on("message", function (channel, message) {
    try {
      let {method, payload} = JSON.parse(message);
      if (method === "datapoint value") {
        return self.emit("datapoint value", payload);
      }
      if (method === "server item") {
        return self.emit("server item", payload);
      }
    } catch(e) {
      console.log(`Error processing broadcast message: ${e.message}`);
    }
  });

  redisSub.subscribe(_params.broadcast_channel);
  return self;
};

const my = BobaosBQ();
// my.on("datapoint value", console.log);
// my.on("server item", console.log);
const init = async _ => {
  console.log("ping: ", await my.ping());
  console.log("state: ", await my.getSdkState());
  // console.log("reset: ", await my.reset());
  // console.log("get description: ", await my.getDescription(1));
  // console.log("get value: ", await my.getValue(1));
  // console.log("get stored: ", await my.getStoredValue(101));
  console.log("set value: ", await my.setValue([{id: 101, value: 0}, {id: 102, value: 0}, {id: 103, value: 0}]));
  // console.log("read value: ", await my.readValue(1));
  // console.log("get server item: ", await my.getServerItem(1));
  // console.log("set programming mode: ", await my.setProgrammingMode(true));
  // console.log("get programming mode: ", await my.getProgrammingMode());
  // console.log("get parameter byte: ", await my.getParameterByte(1));
  setInterval(async _ => {
    console.log(await my.readValue([1, 105, 106, 107]));
    console.log(await my.getValue([1, 105, 106, 107]));
  }, 1000)
};

init();
