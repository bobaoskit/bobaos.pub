const Redis = require("redis");
const DPTS = require("knx-dpts-baos");

const config = require("../config.json");

const redisClient = Redis.createClient(config.ipc.redis);

const prefix = `${config.ipc.key_prefix}:datapoints`;

const MAX_DATAPOINTS_NUM = 1000;

// TODO:
const getDatapointsCount = _ => {
  return new Promise((resolve, reject) => {
    // return _datapoints.length;
    redisClient.keys(`${prefix}:*`, (err, res) => {
      if (err) {
        return reject(err);
      }

      return resolve(res.length);
    });
  });
};

const getDescription = id => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}:${id}`;
    redisClient.hgetall(key, (err, result) => {
      if (err) {
        return reject(err);
      }

      return resolve(result);
    });
  });
};

const getAllDescriptions = _ => {
  return new Promise((resolve, reject) => {
    redisClient.keys(`${prefix}:*`, async (err, res) => {
      if (err) {
        return reject(err);
      }

      let descrs = await Promise.all(res.map(t => {
        return getDescription(t.split(":")[2])
      }).map(p => p.catch(e => undefined)));

      return resolve(descrs);
    });
  });
};

const clearAllDatapoints = _ => {
  return new Promise((resolve, reject) => {
    redisClient.keys(`${prefix}:*`, async (err, res) => {
      if (err) {
        return reject(err);
      }

      let _delete = key => {
        return new Promise((resolve, reject) => {
          redisClient.del(key, (err, result) => {
            if (err) {
              return reject(err);
            }

            return resolve(result);
          });
        });
      };
      let del = await Promise.all(res.map(_delete).map(p => p.catch(e => undefined)));

      return resolve(del);
    });
  });
};


const processRawValue = (id, raw) => {
  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(raw)) {
      throw new Error(`Raw value isn't instance of Buffer`);
    }
    let rawValue = raw.slice();
    // bobaos:datapoints:1
    let key = `${prefix}:${id}`;
    redisClient.hgetall(key, (err, res) => {
      if (err) {
        return reject(err);
      }

      let {dpt} = res;
      let jsValue = DPTS[dpt].toJS(raw);
      let formattedRaw = JSON.stringify(Array.prototype.slice.call(rawValue));
      let obj2set = [
        "value", jsValue,
        "raw", raw
      ];
      redisClient.hmset(key, obj2set, (err, res) => {
        if (err) {
          return reject(err);
        }

        return getDescription(id)
          .then(data => resolve(data))
          .catch(err => reject(err));
      });
    });
  });
};

const convert2raw = (id, value) => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}:${id}`;
    redisClient.hgetall(key, (err, res) => {
      if (err) {
        return reject(err);
      }

      let {dpt} = res;
      let raw = DPTS[dpt].fromJS(value);
      return resolve(raw);
    });
  });
};

const pushDatapoint = (item) => {
  return new Promise((resolve, reject) => {
    let {id, length, flags, dpt} = item;
    // process flags
    let flag_priority = flags.priority;
    let flag_communication = flags.communication;
    let flag_read = flags.read;
    let flag_write = flags.write;
    let flag_readOnInit = flags.readOnInit;
    let flag_update = flags.update;
    let key = `${prefix}:${id}`;
    let obj = ["id", id, "length", length, "dpt", dpt, "flag_priority", flag_priority,
      "flag_communication", flag_communication, "flag_read", flag_read, "flag_write", flag_write,
      "flag_readOnInit", flag_readOnInit, "flag_update", flag_update];
    redisClient.hmset(key, obj, (err, res) => {
        if (err) {
          return reject(err);
        }

        return resolve(res);
      }
    )
  });
};

module.exports = {
  pushDatapoint: pushDatapoint,
  convert2raw: convert2raw,
  processRawValue: processRawValue,
  clearAllDatapoints: clearAllDatapoints,
  getAllDescriptions: getAllDescriptions,
  getDescription: getDescription,
  getDatapointsCount: getDatapointsCount
};