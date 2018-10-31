const EE = require("events");
const Redis = require("redis");
const Queue = require("bee-queue");

const config = require("../config");

let IPC = params => {
  let self = new EE();

  // default parameters
  // name to identify this module
  // channel to subscribe to
  let _params = {
    request_channel: config.ipc.request_channel,
    broadcast_channel: config.ipc.broadcast_channel
  };
  // passed params
  Object.assign(_params, params);

  const redisClient = Redis.createClient(config.ipc.redis);

  const reqQ = new Queue(config.ipc.request_channel, {
    redis: config.ipc.redis,
    isWorker: true,
    getEvents: true,
    stalledInterval: 0,
    maxStalledCount: 0,
    removeOnSuccess: true,
    removeOnFailure: true
  });

  reqQ.process((job, done) => {
    let parsed = job.data;
    let hasMethodField = Object.prototype.hasOwnProperty.call(parsed, "method");
    let hasPayloadField = Object.prototype.hasOwnProperty.call(parsed, "payload");
    // request should have request_id, response_channel, method and payload fields
    // otherwise there will be no response
    if (hasMethodField && hasPayloadField) {
      // request id, request obj, request proxy to expose
      let request = {
        method: parsed.method,
        payload: parsed.payload
      };
      let requestProxy = new Proxy(request, {
        ownKeys: target => {
          return ["method", "payload"];
        },
        get: (obj, prop, receiver) => {
          if (prop === "method" || prop === "payload") {
            return obj[prop];
          }

          return null;
        }
      });

      let response = {};

      let sendResponse = _ => {
        let dataToSend = {};
        dataToSend["method"] = response["method"];
        dataToSend["payload"] = response["payload"];

        return done(null, dataToSend);
      };

      let responseProxy = new Proxy(response, {
        ownKeys: target => {
          return ["method", "payload"];
        },
        get: (obj, prop, receiver) => {
          // res.send(data);
          if (prop === "send") {
            return sendResponse;
          }
          if (prop === "method" || prop === "payload") {
            return obj[prop];
          }

          // we don't want to return other props and methods yet
          return null;
        },
        set: (obj, prop, value, receiver) => {
          if (prop === "method" || prop === "payload") {
            obj[prop] = value;
          }
        }
      });
      self.emit("request", requestProxy, responseProxy);
    } else {
      // TODO: send error response? but where to?
      done(new Error("Request must have required parameters."));
    }
  });

  self.broadcast = data => {
    if (!Object.prototype.hasOwnProperty.call(data, "method")) {
      throw new Error("data should have method field");
    }
    if (!Object.prototype.hasOwnProperty.call(data, "payload")) {
      throw new Error("data should have payload field");
    }
    let data2send = {};
    data2send.method = data.method;
    data2send.payload = data.payload;

    return redisClient.publish(config.ipc.broadcast_channel, JSON.stringify(data2send));
  };

  reqQ.on("ready", _ => {
    self.emit("ready");
  });

  return self;
};

module.exports = IPC;
