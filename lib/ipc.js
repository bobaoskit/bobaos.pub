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
    redis: config.ipc.redis,
    request_channel: config.ipc.request_channel,
    service_channel: config.ipc.service_channel,
    broadcast_channel: config.ipc.broadcast_channel
  };

  // passed params
  Object.assign(_params, params);

  // time sync
  let _timeSyncParams = {
    sync_enabled: false
  };
  if (Object.prototype.hasOwnProperty.call(config, "time_sync")) {
    Object.assign(_timeSyncParams, config["time_sync"]);
  }
  let _timeSyncInterval = null;

  const redisClient = Redis.createClient(_params.redis);

  // common function to process queue jobs
  // will process incoming job to queueToProcess
  // and in the end will emit emitEventName event
  const _processQueueJobs = (queueToProcess, emitEventName) => {
    queueToProcess.process((job, done) => {
      let parsed = job.data;
      let hasMethodField = Object.prototype.hasOwnProperty.call(parsed, "method");
      let hasPayloadField = Object.prototype.hasOwnProperty.call(parsed, "payload");
      let hasTimestamp = Object.prototype.hasOwnProperty.call(parsed, "timestamp");

      // request should have method and payload fields
      // otherwise there will be no response
      if (!hasMethodField) {
        return done(null, { method: "error", payload: "Request must have method field." });
      }
      if (!hasPayloadField) {
        return done(null, { method: "error", payload: "Request must have payload field." });
      }

      const _emitReqRes = _ => {
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

          // response has been sent, so,
          // emiting job again on reset will produce error
          queueToProcess._emitLatestJob = null;

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
        self.emit(emitEventName, requestProxy, responseProxy);
      };
      if (_timeSyncParams.sync_enabled) {
        if (_timeSyncParams.check_enabled) {
          if (!hasTimestamp) {
            return done(null, { method: "error", payload: "Request must have timestamp." });
          }

          // get timestamp from request
          let _timestamp = parsed.timestamp;

          // get timestamp(now) from redis
          return redisClient.get(_timeSyncParams.redis_key, (err, res) => {
            if (err) {
              let _res = {
                method: "error",
                payload: `Error while getting timestamp from redis: ${err.message}`
              };

              return done(null, _res);
            }

            // calculate  time difference
            let _difference = res - _timestamp;

            // if request was made long time ago, then return error
            if (_difference > _timeSyncParams.max_check_difference) {
              let _res = { method: "error", payload: "Task too old." };

              return done(null, _res);
            }

            queueToProcess._emitLatestJob = _ => {
              queueToProcess._emitLatestJob = null;
              _emitReqRes();
            };

            return _emitReqRes();
          });
        }
      } else {
        return _emitReqRes();
      }
    });
  };

  // init queue for bobaos requests
  const reqQ = new Queue(_params.request_channel, {
    redis: redisClient,
    isWorker: true,
    getEvents: true,
    stalledInterval: 30000,
    maxStalledCount: 10,
    storeJobs: false,
    removeOnSuccess: true,
    removeOnFailure: true
  });

  // queue for service functions
  // ping/state/reset
  const serviceQ = new Queue(_params.service_channel, {
    redis: redisClient,
    isWorker: true,
    getEvents: true,
    stalledInterval: 30000,
    maxStalledCount: 10,
    storeJobs: false,
    removeOnSuccess: true,
    removeOnFailure: true
  });

  _processQueueJobs(reqQ, "request");
  _processQueueJobs(serviceQ, "service request");

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

    return redisClient.publish(_params.broadcast_channel, JSON.stringify(data2send));
  };

  self.reset = async _ => {
    if (typeof reqQ._emitLatestJob === "function") {
      // throw an error to latest job, so queue will be free
      reqQ._emitLatestJob();
    }
  };
  reqQ.on("ready", _ => {
    if (_timeSyncParams.sync_enabled) {
      // init time sync:
      // with interval defined in config.json it will save current timestamp in redis key

      // at first, check for existing keys in config
      if (!Object.prototype.hasOwnProperty.call(_timeSyncParams, "sync_interval")) {
        throw new Error('Param "time_sync.sync_interval" cannot be found in config.json file');
      }
      if (typeof _timeSyncParams.sync_interval !== "number") {
        throw new Error('Param "time_sync.sync_interval" in config.json should be number');
      }
      if (!Object.prototype.hasOwnProperty.call(_timeSyncParams, "redis_key")) {
        throw new Error('Param "time_sync.redis_key" cannot be found in config.json file');
      }
      if (typeof _timeSyncParams.redis_key !== "string") {
        throw new Error('Param "time_sync.sync_interval" in config.json should be string');
      }

      if (!Object.prototype.hasOwnProperty.call(_timeSyncParams, "check_enabled")) {
        throw new Error('Param "time_sync.check_enabled" cannot be found in config.json file');
      }
      if (_timeSyncParams.check_enabled) {
        if (!Object.prototype.hasOwnProperty.call(_timeSyncParams, "max_check_difference")) {
          throw new Error('Param "time_sync.max_check_difference" cannot be found in config.json file');
        }
        if (typeof _timeSyncParams.max_check_difference !== "number") {
          throw new Error('Param "time_sync.max_check_difference" should be number');
        }
      }

      const _runTimeSync = cb => {
        if (_timeSyncInterval !== null) {
          clearTimeout(_timeSyncInterval);
        }

        // timestamp before saving to redis
        let _timeStampFirst = Number(new Date());
        redisClient.set(_timeSyncParams.redis_key, _timeStampFirst, (err, res) => {
          if (err) {
            if (typeof cb === "function") {
              return cb(err);
            }

            return console.log("Error while setting timestamp: ", err);
          }

          // timestamp after saving to redis
          let _timeStampSecond = Number(new Date());

          // calculate next  timeout to save value
          let _saveTime = _timeStampSecond - _timeStampFirst;
          let _nextTimeSyncTimeout = _timeSyncParams.sync_interval - _saveTime;

          _timeSyncInterval = setTimeout(_runTimeSync, _nextTimeSyncTimeout);
          if (typeof cb === "function") {
            return cb(null);
          }
        });
      };
      _runTimeSync((err, res) => {
        if (err) {
          return console.log("Calling _runTimeSync for the first time returned error: ", err);
        }

        return self.emit("ready");
      });
    } else {
      self.emit("ready");
    }
  });

  return self;
};

module.exports = IPC;
